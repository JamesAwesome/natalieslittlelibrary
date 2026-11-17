import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import { createMembership, type Identity, type Membership, type MembershipConfig } from "./index";
import { fakeProvider } from "./testing";
import type { Member } from "../../shared/types";

const natalie: Identity = { provider: "google", subject: "g-1", email: "natalie@example.com",
  emailVerified: true, name: "Natalie", pictureUrl: null };
const config: MembershipConfig = { siteUrl: "https://books.test", allowlist: "natalie@example.com", admins: "natalie@example.com" };

function make(overrides: Partial<Parameters<typeof createMembership>[0]> = {}): Membership {
  return createMembership({ db: env.DB, provider: fakeProvider(natalie), config, ...overrides });
}

// Turns Set-Cookie headers into a Cookie header value, dropping cleared cookies.
function cookies(res: Response): string {
  return res.headers.getSetCookie()
    .filter((c) => !c.includes("Max-Age=0"))
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function signIn(m: Membership, returnTo: string | null = null): Promise<Response> {
  const begin = await m.beginLogin(returnTo);
  const state = new URL(begin.headers.get("location")!).searchParams.get("state")!;
  return m.completeLogin(new Request(`https://books.test/auth/callback?code=x&state=${encodeURIComponent(state)}`,
    { headers: { cookie: cookies(begin) } }));
}

function asMember(m: Membership, res: Response): Promise<Member | null> {
  return m.currentMember(new Request("https://books.test/", { headers: { cookie: cookies(res) } }));
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("delete from sessions"),
    env.DB.prepare("delete from identities"),
    env.DB.prepare("delete from members"),
  ]);
});

test("an allowlisted person signs in and is recognised", async () => {
  const m = make();
  const res = await signIn(m);
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
  expect(await asMember(m, res)).toMatchObject({ name: "Natalie", email: "natalie@example.com", isAdmin: true });
});

test("signing in returns the person to the page they came from", async () => {
  const res = await signIn(make(), "/b/abc123");
  expect(res.headers.get("location")).toBe("/b/abc123");
});

test.each(["//evil.example", "https://evil.example", "/\\evil.example", "/auth/login", "evil"])(
  "returnTo %s is replaced with /", async (bad) => {
    const res = await signIn(make(), bad);
    expect(res.headers.get("location")).toBe("/");
  });

test("someone not on the allowlist is refused and gets no session", async () => {
  const m = make({ provider: fakeProvider({ ...natalie, subject: "g-2", email: "stranger@example.com" }) });
  const res = await signIn(m);
  expect(res.headers.get("location")).toBe("/?refused=not-invited");
  expect(res.headers.getSetCookie().some((c) => c.startsWith("lib_session=") && !c.includes("Max-Age=0"))).toBe(false);
  expect(await asMember(m, res)).toBeNull();
});

test("allowlist matching ignores case, spaces, and empty entries", async () => {
  const m = make({ config: { ...config, allowlist: " Natalie@Example.com , ,james@example.com," } });
  expect((await signIn(m)).headers.get("location")).toBe("/");
});

test("an empty allowlist admits nobody", async () => {
  const m = make({ config: { ...config, allowlist: "" } });
  expect((await signIn(m)).headers.get("location")).toBe("/?refused=not-invited");
});

test("an unverified email is refused", async () => {
  const m = make({ provider: fakeProvider({ ...natalie, emailVerified: false }) });
  expect((await signIn(m)).headers.get("location")).toBe("/?refused=unverified");
});

test("a provider failure is a refusal, not an error", async () => {
  const m = make({ provider: fakeProvider(new Error("token endpoint said no")) });
  expect((await signIn(m)).headers.get("location")).toBe("/?refused=failed");
});

test("a callback with the wrong state is refused", async () => {
  const m = make();
  const begin = await m.beginLogin(null);
  const res = await m.completeLogin(new Request("https://books.test/auth/callback?code=x&state=wrong",
    { headers: { cookie: cookies(begin) } }));
  expect(res.headers.get("location")).toBe("/?refused=failed");
});

test("a callback with no login cookie is refused", async () => {
  const res = await make().completeLogin(new Request("https://books.test/auth/callback?code=x&state=y"));
  expect(res.headers.get("location")).toBe("/?refused=failed");
});

test("a returning member is the same member, with details refreshed", async () => {
  const first = await asMember(make(), await signIn(make()));
  const m2 = make({ provider: fakeProvider({ ...natalie, name: "Nat", email: "new@example.com" }),
    config: { ...config, allowlist: "" } });
  const second = await asMember(m2, await signIn(m2));
  expect(second).toMatchObject({ id: first!.id, name: "Nat", email: "new@example.com" });
});

test("a removed member is refused and their old session stops working", async () => {
  const m = make();
  const res = await signIn(m);
  await env.DB.prepare("update members set removed_at = 1").run();
  expect(await asMember(m, res)).toBeNull();
  expect((await signIn(m)).headers.get("location")).toBe("/?refused=removed");
});

test("a session expires after 90 days", async () => {
  let t = 0;
  const m = make({ now: () => t });
  const res = await signIn(m);
  t = 90 * 86_400_000 - 1;
  expect(await asMember(m, res)).not.toBeNull();
  t = 90 * 86_400_000 + 1;
  expect(await asMember(m, res)).toBeNull();
});

test.each(["lib_session=", "lib_session=not-a-token", "lib_session=%%%", "other=1"])(
  "cookie %s is treated as signed out", async (cookie) => {
    expect(await make().currentMember(new Request("https://books.test/", { headers: { cookie } }))).toBeNull();
  });

test("logout ends the session", async () => {
  const m = make();
  const res = await signIn(m);
  const out = await m.logout(new Request("https://books.test/auth/logout", { method: "POST", headers: { cookie: cookies(res) } }));
  expect(out.status).toBe(204);
  expect(await asMember(m, res)).toBeNull();
});

test("the database never holds the raw session token", async () => {
  const res = await signIn(make());
  const token = /lib_session=([^;]+)/.exec(res.headers.getSetCookie().join(";"))![1];
  const row = await env.DB.prepare("select token_hash from sessions").first<{ token_hash: string }>();
  expect(row!.token_hash).not.toBe(token);
  expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
});

test("cookies are Secure on https and not on http", async () => {
  expect((await signIn(make())).headers.getSetCookie().join(";")).toContain("Secure");
  const local = make({ config: { ...config, siteUrl: "http://localhost:5173" } });
  expect((await signIn(local)).headers.getSetCookie().join(";")).not.toContain("Secure");
});
