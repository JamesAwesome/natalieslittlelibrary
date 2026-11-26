import { Hono } from "hono";
import type { Context } from "hono";
import type { ImportRow, Member, Rejection, RejectionReason } from "../shared/types";
import { createBookLookup, lookupSources, type BookLookup } from "./booklookup";
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
  const { lookup, lookupMany } = createBookLookup({
    db: env.DB,
    sources: lookupSources((env as { GOOGLE_BOOKS_API_KEY?: unknown }).GOOGLE_BOOKS_API_KEY),
  });
  const ledger = createLedger({ db: env.DB, siteUrl: env.SITE_URL, lookup, lookupMany });
  return { membership, ledger, lookup };
}

const STATUS: Record<Rejection["rejected"], 400 | 401 | 403 | 404 | 409 | 503> = {
  invalid: 400,
  "signed-out": 401,
  unavailable: 503,
  "not-allowed": 403,
  "not-found": 404,
  "label-unknown": 404,
  "book-not-found": 404,
  "label-in-use": 409,
  "name-taken": 409,
};

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// Responses here differ per person (cookies, current member); never let a cache keep them.
app.use("/api/*", async (c, next) => { await next(); c.res.headers.set("cache-control", "no-store"); });
app.use("/auth/*", async (c, next) => { await next(); c.res.headers.set("cache-control", "no-store"); });

// c.req.path is the path Hono routed on (decoded), so an encoded /api cannot dodge this.
const isApi = (path: string) => path === "/api" || path.startsWith("/api/");

app.onError((_err, c) => {
  if (isApi(c.req.path)) {
    return c.json({ rejected: "unavailable" satisfies RejectionReason }, STATUS.unavailable, { "cache-control": "no-store" });
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
  if (identified.status === "unavailable") return c.json({ rejected: "unavailable" satisfies RejectionReason }, STATUS.unavailable);
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
    if (!who) return c.json({ rejected: "signed-out" satisfies RejectionReason }, STATUS["signed-out"]);
    return handler(c, who);
  };
}

function answer(c: AppContext, result: object) {
  if ("rejected" in result) return c.json(result, STATUS[(result as Rejection).rejected]);
  return c.json(result);
}

const MAX_BODY_BYTES = 16 * 1024;

// The body's text, or null when it is, or turns out to be, longer than the limit.
async function boundedText(request: Request): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function objectBody(c: AppContext): Promise<Record<string, unknown> | null> {
  try {
    const text = await boundedText(c.req.raw);
    if (text === null) return null;
    const body: unknown = JSON.parse(text);
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

// This GET makes an outbound request and is not exempt from abuse by other sites, so it gets the Sec-Fetch-Site half of the check.
app.get("/api/books/lookup", async (c, next) => {
  const site = c.req.header("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return c.json({ rejected: "not-allowed" }, 403);
  await next();
}, member(async (c) => {
  const isbn = c.req.query("isbn");
  if (isbn === undefined) return invalid(c);
  return c.json({ book: await c.var.services.lookup(isbn) });
}));

app.post("/api/copies", member(async (c, who) => {
  const body = await objectBody(c);
  if (!body) return invalid(c);
  const book = body.isbn !== undefined ? { isbn: body.isbn } : { title: body.title, authors: body.authors };
  return answer(c, await c.var.services.ledger.add(who, { code: body.code, book, collectionId: body.collectionId } as Parameters<Ledger["add"]>[1]));
}));

// Collection ids are 32 hex (backfilled) or a 36-character UUID; copy ids are UUIDs. Anything else cannot exist.
const ID_SHAPE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const notFound = (c: AppContext) => c.json({ rejected: "not-found" satisfies RejectionReason }, STATUS["not-found"]);
const idParam = (c: AppContext): string | null => {
  const id = c.req.param("id") ?? "";
  return ID_SHAPE.test(id) ? id : null;
};

// Registered before /api/collections/:id, which would take "mine" for an id.
app.get("/api/collections/mine", member(async (c, who) => answer(c, await c.var.services.ledger.collectionsOf(who.id))));

app.post("/api/collections", member(async (c, who) => {
  const body = await objectBody(c);
  if (!body || typeof body.name !== "string") return invalid(c);
  return answer(c, await c.var.services.ledger.createCollection(who, body.name));
}));

app.patch("/api/collections/:id", member(async (c, who) => {
  const body = await objectBody(c);
  if (!body || typeof body.name !== "string") return invalid(c);
  const id = idParam(c);
  return id === null ? notFound(c) : answer(c, await c.var.services.ledger.renameCollection(who, id, body.name));
}));

app.delete("/api/collections/:id", member(async (c, who) => {
  const id = idParam(c);
  return id === null ? notFound(c) : answer(c, await c.var.services.ledger.deleteCollection(who, id));
}));

app.post("/api/collections/:id/default", member(async (c, who) => {
  const id = idParam(c);
  if (id === null) return notFound(c);
  const result = await c.var.services.ledger.makeDefault(who, id);
  return Array.isArray(result) ? c.json({ collections: result }) : answer(c, result);
}));

// A removed member's collections are hidden from everyone, as /api/members hides them.
async function ownedByActive(c: AppContext, result: { rejected: string } | { owner: { id: string } }): Promise<Response> {
  if ("rejected" in result) return answer(c, result as Rejection);
  const active = await c.var.services.membership.members();
  return active.some((p) => p.id === result.owner.id) ? c.json(result) : notFound(c);
}

app.get("/api/collections/:id", member(async (c) => {
  const id = idParam(c);
  return id === null ? notFound(c) : ownedByActive(c, await c.var.services.ledger.shelf(id));
}));

app.get("/api/members", member(async (c) => c.json({ members: await c.var.services.membership.members() })));

app.get("/api/members/:id/collections", member(async (c) => ownedByActive(c, await c.var.services.ledger.collectionsOf(c.req.param("id") ?? ""))));

app.get("/api/holding", member(async (c, who) => c.json({ items: await c.var.services.ledger.holding(who) })));

// Registered before /api/copies/:id, which would take "candidates" for an id.
app.get("/api/copies/candidates", member(async (c, who) =>
  answer(c, await c.var.services.ledger.candidates(who, { isbn: c.req.query("isbn"), title: c.req.query("title") }))));

app.get("/api/copies/:id", member(async (c, who) => {
  const id = idParam(c);
  return id === null ? notFound(c) : answer(c, await c.var.services.ledger.viewCopy(id, who));
}));

app.post("/api/copies/:id/move", member(async (c, who) => {
  const body = await objectBody(c);
  if (!body || typeof body.collectionId !== "string") return invalid(c);
  const id = idParam(c);
  return id === null ? notFound(c) : answer(c, await c.var.services.ledger.moveCopy(who, id, body.collectionId));
}));

app.post("/api/copies/:id/label", member(async (c, who) => {
  const body = await objectBody(c);
  if (!body || typeof body.code !== "string") return invalid(c);
  const id = idParam(c);
  return id === null ? notFound(c) : answer(c, await c.var.services.ledger.labelCopy(who, id, body.code));
}));

app.post("/api/imports", member(async (c, who) => {
  const body = await objectBody(c);
  if (!body) return invalid(c);
  // Omitted or null means the importer's default, as for ledger.add; anything else must be an id.
  const collectionId = body.collectionId ?? null;
  if (collectionId !== null && typeof collectionId !== "string") return invalid(c);
  return answer(c, await c.var.services.ledger.importCopies(who, { collectionId, rows: body.rows as ImportRow[] }));
}));

app.post("/api/labels/:code/claim", member(async (c, who) =>
  answer(c, await c.var.services.ledger.act(who, { type: "claim", code: c.req.param("code") ?? "" }))));

app.post("/api/copies/:id/return", member(async (c, who) =>
  answer(c, await c.var.services.ledger.act(who, { type: "return", copyId: c.req.param("id") ?? "" }))));

app.notFound((c) => {
  if (isApi(c.req.path)) return c.json({ rejected: "not-found" }, 404, { "cache-control": "no-store" });
  return c.text("404 Not Found", 404);
});

app.get("/auth/login", (c) => c.var.services.membership.beginLogin(c.req.query("returnTo") ?? null));
app.get("/auth/callback", (c) => c.var.services.membership.completeLogin(c.req.raw));
app.post("/auth/logout", (c) => c.var.services.membership.logout(c.req.raw));

export default app;
