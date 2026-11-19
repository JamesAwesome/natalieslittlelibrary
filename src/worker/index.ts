import { Hono } from "hono";
import type { Context } from "hono";
import type { Member, Rejection } from "../shared/types";
import { createBookLookup, type BookLookup } from "./booklookup";
import { createLedger, type Ledger } from "./ledger";
import { createMembership, googleProvider, type Identified, type Membership } from "./membership";

type Services = { membership: Membership; ledger: Ledger; lookup: BookLookup["lookup"] };
type Vars = { services: Services; identified: Identified };
type AppContext = Context<{ Bindings: Env; Variables: Vars }>;

// The one place the modules are wired together; built once per request.
function servicesFor(env: Env): Services {
  const membership = createMembership({
    db: env.DB,
    provider: googleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      siteUrl: env.SITE_URL,
    }),
    config: { siteUrl: env.SITE_URL, allowlist: env.ALLOWLIST_EMAILS, admins: env.ADMIN_EMAILS },
  });
  const { lookup } = createBookLookup({ db: env.DB });
  const ledger = createLedger({ db: env.DB, siteUrl: env.SITE_URL, lookup });
  return { membership, ledger, lookup };
}

const STATUS: Record<Rejection["rejected"], 400 | 403 | 404 | 409> = {
  invalid: 400,
  "not-allowed": 403,
  "not-found": 404,
  "label-unknown": 404,
  "book-not-found": 404,
  "label-in-use": 409,
};

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// Responses here differ per person (cookies, current member); never let a cache keep them.
app.use("/api/*", async (c, next) => { await next(); c.res.headers.set("cache-control", "no-store"); });
app.use("/auth/*", async (c, next) => { await next(); c.res.headers.set("cache-control", "no-store"); });

app.onError((_err, c) => {
  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    return c.json({ rejected: "unavailable" }, 503, { "cache-control": "no-store" });
  }
  return c.text("Internal Server Error", 500, { "cache-control": "no-store" });
});

app.use("*", async (c, next) => { c.set("services", servicesFor(c.env)); await next(); });

// State-changing requests must come from this site. A request with neither header is not a browser.
async function sameSite(c: AppContext, next: () => Promise<void>) {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    const fetchSite = c.req.header("sec-fetch-site");
    const foreignOrigin = origin !== undefined && origin !== new URL(c.env.SITE_URL).origin;
    const foreignSite = fetchSite === "cross-site" || fetchSite === "same-site";
    if (foreignOrigin || foreignSite) return c.json({ rejected: "not-allowed" }, 403);
  }
  await next();
}
app.use("/api/*", sameSite);
app.use("/auth/*", sameSite);

// The member is resolved once per request, here, and read from the context everywhere else.
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();
  const identified = await c.var.services.membership.identify(c.req.raw);
  if (identified.status === "unavailable") return c.json({ rejected: "unavailable" }, 503);
  c.set("identified", identified);
  await next();
});

const viewer = (c: AppContext): Member | null => {
  const identified = c.var.identified;
  return identified.status === "member" ? identified.member : null;
};

// Runs a member-only handler, or answers 401.
function member(handler: (c: AppContext, who: Member) => Promise<Response>) {
  return async (c: AppContext) => {
    const who = viewer(c);
    if (!who) return c.json({ rejected: "signed-out" }, 401);
    return handler(c, who);
  };
}

function answer(c: AppContext, result: object) {
  if ("rejected" in result) return c.json(result, STATUS[(result as Rejection).rejected]);
  return c.json(result);
}

async function objectBody(c: AppContext): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const invalid = (c: AppContext) => c.json({ rejected: "invalid" }, 400);

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/me", (c) => c.json({ member: viewer(c) }));

app.get("/api/labels/:code", async (c) => c.json(await c.var.services.ledger.view(c.req.param("code"), viewer(c))));

app.post("/api/labels", member(async (c, who) => {
  const body = await objectBody(c);
  if (!body) return invalid(c);
  const result = await c.var.services.ledger.mintLabels(who, body.count as number);
  return Array.isArray(result) ? c.json({ labels: result }) : answer(c, result);
}));

app.get("/api/books/lookup", member(async (c) => {
  const isbn = c.req.query("isbn");
  if (isbn === undefined) return invalid(c);
  return c.json({ book: await c.var.services.lookup(isbn) });
}));

app.post("/api/copies", member(async (c, who) => {
  const body = await objectBody(c);
  if (!body) return invalid(c);
  const book = body.isbn !== undefined ? { isbn: body.isbn } : { title: body.title, authors: body.authors };
  return answer(c, await c.var.services.ledger.add(who, { code: body.code, book } as Parameters<Ledger["add"]>[1]));
}));

app.post("/api/labels/:code/claim", member(async (c, who) =>
  answer(c, await c.var.services.ledger.act(who, { type: "claim", code: c.req.param("code") ?? "" }))));

app.post("/api/copies/:id/return", member(async (c, who) =>
  answer(c, await c.var.services.ledger.act(who, { type: "return", copyId: c.req.param("id") ?? "" }))));

app.get("/auth/login", (c) => c.var.services.membership.beginLogin(c.req.query("returnTo") ?? null));
app.get("/auth/callback", (c) => c.var.services.membership.completeLogin(c.req.raw));
app.post("/auth/logout", (c) => c.var.services.membership.logout(c.req.raw));

export default app;
