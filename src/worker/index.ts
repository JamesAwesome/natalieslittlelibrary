import { Hono } from "hono";
import { createMembership, googleProvider, type Membership } from "./membership";

const app = new Hono<{ Bindings: Env }>();

function membershipFor(env: Env): Membership {
  return createMembership({
    db: env.DB,
    provider: googleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      siteUrl: env.SITE_URL,
    }),
    config: { siteUrl: env.SITE_URL, allowlist: env.ALLOWLIST_EMAILS, admins: env.ADMIN_EMAILS },
  });
}

app.get("/api/health", (c) => c.json({ ok: true }));
app.get("/api/me", async (c) => c.json({ member: await membershipFor(c.env).currentMember(c.req.raw) }));
app.get("/auth/login", (c) => membershipFor(c.env).beginLogin(c.req.query("returnTo") ?? null));
app.get("/auth/callback", (c) => membershipFor(c.env).completeLogin(c.req.raw));
app.post("/auth/logout", (c) => membershipFor(c.env).logout(c.req.raw));

export default app;
