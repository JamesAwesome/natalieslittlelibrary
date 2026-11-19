import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import { createMembership, type Identity, type Membership, type MembershipConfig } from "./index";
import { fakeProvider, signInAs } from "./testing";
import { googleProvider } from "./index";
import type { Member } from "../../shared/types";
import { resetDatabase } from "../../../test/reset";

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
  await resetDatabase(env.DB);
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

const badReturnTos = ["//evil.example", "https://evil.example", "/\\evil.example", "/auth/login", "evil",
  "/\t/evil.example", "/\n/evil.example", "/\r/evil.example"];

test.each(badReturnTos)(
  "returnTo %j is replaced with /", async (bad) => {
    const res = await signIn(make(), bad);
    expect(res.headers.get("location")).toBe("/");
  });

test("no returnTo can send the browser to another origin", async () => {
  for (const bad of badReturnTos) {
    const res = await signIn(make(), bad);
    expect(new URL(res.headers.get("location")!, "https://books.test").origin).toBe("https://books.test");
  }
});

test("someone not on the allowlist is refused and gets no session", async () => {
  const m = make({ provider: fakeProvider({ ...natalie, subject: "g-2", email: "stranger@example.com" }) });
  const res = await signIn(m);
  expect(res.headers.get("location")).toBe("/?refused=not-invited");
  expect(res.headers.getSetCookie().some((c) => /lib_session=/.test(c) && !c.includes("Max-Age=0"))).toBe(false);
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

test("an allowlisted person who is not an admin is not an admin", async () => {
  const m = make({ config: { ...config, admins: "someone-else@example.com" } });
  expect(await asMember(m, await signIn(m))).toMatchObject({ email: "natalie@example.com", isAdmin: false });
});

test("beginLogin sets the login cookie with exact attributes", async () => {
  const [c] = (await make().beginLogin(null)).headers.getSetCookie();
  expect(c).toMatch(/^__Host-lib_login=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=600; Secure$/);
  const [local] = (await make({ config: { ...config, siteUrl: "http://localhost:5173" } }).beginLogin(null)).headers.getSetCookie();
  expect(local).toMatch(/^lib_login=[^;]+; HttpOnly; SameSite=Lax; Path=\/auth; Max-Age=600$/);
});

test("completeLogin sets the session cookie with exact attributes and clears the login cookie", async () => {
  const cs = (await signIn(make())).headers.getSetCookie();
  expect(cs).toHaveLength(2);
  expect(cs.find((c) => c.startsWith("__Host-lib_session=")))
    .toMatch(/^__Host-lib_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=7776000; Secure$/);
  expect(cs.find((c) => c.startsWith("__Host-lib_login=")))
    .toBe("__Host-lib_login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure");
});

test("a refusal clears the login cookie", async () => {
  const m = make({ provider: fakeProvider(new Error("no")) });
  const cs = (await signIn(m)).headers.getSetCookie();
  expect(cs).toEqual(["__Host-lib_login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure"]);
});

test("logout clears the session cookie", async () => {
  const out = await make().logout(new Request("https://books.test/auth/logout", { method: "POST" }));
  expect(out.headers.getSetCookie()).toEqual(["__Host-lib_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure"]);
});

test("on https a session cookie without the __Host- prefix is not honoured", async () => {
  const m = make();
  const token = /__Host-lib_session=([^;]+)/.exec((await signIn(m)).headers.getSetCookie().join(";"))![1];
  const req = (cookie: string) => new Request("https://books.test/", { headers: { cookie } });
  expect(await m.currentMember(req(`lib_session=${token}`))).toBeNull();
  expect(await m.currentMember(req(`__Host-lib_session=${token}`))).not.toBeNull();
});

test("a session is expired at exactly 90 days", async () => {
  let t = 0;
  const m = make({ now: () => t });
  const res = await signIn(m);
  t = 90 * 86_400_000;
  expect(await asMember(m, res)).toBeNull();
});

test("currentMember returns null rather than throwing when the database fails", async () => {
  const m = make();
  const res = await signIn(m);
  const broken = make({ db: { prepare() { throw new Error("db down"); } } as unknown as D1Database });
  expect(await asMember(broken, res)).toBeNull();
});

test("the provider's email is lower-cased before the allowlist check", async () => {
  const m = make({ provider: fakeProvider({ ...natalie, email: "Natalie@Example.com" }) });
  expect((await signIn(m)).headers.get("location")).toBe("/");
});

test("returnTo is cleaned again at callback time", async () => {
  const m = make();
  const begin = await m.beginLogin(null);
  const [name, value] = cookies(begin).split("=");
  const [state, verifier] = value.split(".");
  const evil = btoa("//evil.example").replace(/=+$/, "");
  const res = await m.completeLogin(new Request(`https://books.test/auth/callback?code=x&state=${state}`,
    { headers: { cookie: `${name}=${state}.${verifier}.${evil}` } }));
  expect(res.headers.get("location")).toBe("/");
});

async function begin(m: Membership) {
  const res = await m.beginLogin(null);
  return { res, state: new URL(res.headers.get("location")!).searchParams.get("state")! };
}

function callback(state: string, cookie: string, query = "code=x"): Request {
  return new Request(`https://books.test/auth/callback?${query}&state=${encodeURIComponent(state)}`, { headers: { cookie } });
}

test("the verifier and state given to the provider at login are the ones used at the callback", async () => {
  const provider = fakeProvider(natalie);
  const m = make({ provider });
  const { res, state } = await begin(m);
  await m.completeLogin(callback(state, cookies(res)));
  expect(provider.authorizations).toHaveLength(1);
  expect(provider.authorizations[0].state).toBe(state);
  expect(provider.exchanges).toHaveLength(1);
  expect(provider.exchanges[0].codeVerifier).toBe(provider.authorizations[0].codeVerifier);
});

test("a callback whose state differs from the one issued never reaches the provider", async () => {
  const provider = fakeProvider(natalie);
  const m = make({ provider });
  const { res } = await begin(m);
  const out = await m.completeLogin(callback("A".repeat(43), cookies(res)));
  expect(out.headers.get("location")).toBe("/?refused=failed");
  expect(provider.exchanges).toHaveLength(0);
});

test("each login gets its own verifier and state", async () => {
  const provider = fakeProvider(natalie);
  const m = make({ provider });
  await begin(m);
  await begin(m);
  const [a, b] = provider.authorizations;
  expect(a.codeVerifier).not.toBe(b.codeVerifier);
  expect(a.state).not.toBe(b.state);
  expect(a.codeVerifier).not.toBe(a.state);
});

test("with the real Google adapter, the challenge at login matches the verifier at exchange", async () => {
  let posted: URLSearchParams | undefined;
  const stub = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    posted = new URLSearchParams(String(init?.body));
    const seg = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const id_token = `${seg({ alg: "none" })}.${seg({ iss: "https://accounts.google.com", aud: "test-client", sub: "g-1",
      email: "natalie@example.com", email_verified: true, name: "Natalie" })}.sig`;
    return new Response(JSON.stringify({ id_token }), { status: 200 });
  }) as typeof fetch;
  const m = make({ provider: googleProvider({ clientId: "test-client", clientSecret: "s", siteUrl: "https://books.test", fetch: stub }) });
  const { res, state } = await begin(m);
  const challenge = new URL(res.headers.get("location")!).searchParams.get("code_challenge")!;
  const out = await m.completeLogin(callback(state, cookies(res)));
  expect(out.headers.get("location")).toBe("/");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(posted!.get("code_verifier")!));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  expect(expected).toBe(challenge);
});

test("cancelling on Google's consent screen is refused without calling the provider", async () => {
  const provider = fakeProvider(natalie);
  const m = make({ provider });
  const { res, state } = await begin(m);
  const out = await m.completeLogin(callback(state, cookies(res), "error=access_denied"));
  expect(out.headers.get("location")).toBe("/?refused=failed");
  const set = out.headers.getSetCookie();
  expect(set.some((c) => /lib_session=/.test(c))).toBe(false);
  expect(set.some((c) => /lib_login=;/.test(c) && c.includes("Max-Age=0"))).toBe(true);
  expect(provider.exchanges).toHaveLength(0);
});

const brokenDb = { prepare() { throw new Error("db down"); }, batch() { throw new Error("db down"); } } as unknown as D1Database;

test("a database outage during sign-in is reported as unavailable, with no session", async () => {
  const healthy = make();
  const begin = await healthy.beginLogin(null);
  const state = new URL(begin.headers.get("location")!).searchParams.get("state")!;
  const res = await make({ db: brokenDb }).completeLogin(
    new Request(`https://books.test/auth/callback?code=x&state=${state}`, { headers: { cookie: cookies(begin) } }));
  expect(res.headers.get("location")).toBe("/?refused=unavailable");
  expect(res.headers.getSetCookie()).toEqual(["__Host-lib_login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure"]);
});

test("beginLogin does not touch the database", async () => {
  const res = await make({ db: brokenDb }).beginLogin(null);
  expect(res.status).toBe(302);
});

test("logout still clears the cookie and answers 204 when the database fails", async () => {
  const res = await signIn(make());
  const out = await make({ db: brokenDb }).logout(
    new Request("https://books.test/auth/logout", { method: "POST", headers: { cookie: cookies(res) } }));
  expect(out.status).toBe(204);
  expect(out.headers.getSetCookie()).toEqual(["__Host-lib_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure"]);
});

const dotForms = ["/.//evil.example", "/..//evil.example", "/%2e//evil.example", "/.%2e//evil.example",
  "/%2E%2E//evil.example", "/b/..//evil.example", "/./auth/login", "/b/../auth/login", "/%2e/auth/login"];

function staysOnSite(location: string) {
  const u = new URL(location, "https://books.test");
  expect(u.origin).toBe("https://books.test");
  expect(u.pathname.startsWith("//")).toBe(false);
  expect(u.pathname.startsWith("/auth")).toBe(false);
}

const stranger: Identity = { ...natalie, subject: "g-2", email: "stranger@example.com" };

test.each([...badReturnTos, ...dotForms])("returnTo %s: the success redirect stays on the site", async (bad) => {
  staysOnSite((await signIn(make(), bad)).headers.get("location")!);
});

test.each([...badReturnTos, ...dotForms])("returnTo %s: the refusal redirect stays on the site", async (bad) => {
  const res = await signIn(make({ provider: fakeProvider(stranger) }), bad);
  const location = res.headers.get("location")!;
  staysOnSite(location);
  expect(new URL(location, "https://books.test").searchParams.get("refused")).toBe("not-invited");
});

test.each([
  ["/b/abc", "/b/abc?refused=not-invited"],
  ["/b/abc?x=1", "/b/abc?x=1&refused=not-invited"],
  ["/b/abc?refused=failed", "/b/abc?refused=not-invited"],
  ["/b/abc#frag", "/b/abc?refused=not-invited"],
  [null, "/?refused=not-invited"],
])("a refusal after returnTo %s lands on %s", async (returnTo, expected) => {
  const res = await signIn(make({ provider: fakeProvider(stranger) }), returnTo);
  expect(res.headers.get("location")).toBe(expected);
});

test("a login cookie holding a dot-segment returnTo still cannot send anyone off-site", async () => {
  for (const provider of [fakeProvider(natalie), fakeProvider(stranger)]) {
    const m = make({ provider });
    const begin = await m.beginLogin(null);
    const [name, value] = cookies(begin).split("=");
    const [state, verifier] = value.split(".");
    for (const evil of dotForms) {
      const encoded = btoa(evil).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const res = await m.completeLogin(new Request(`https://books.test/auth/callback?code=x&state=${state}`,
        { headers: { cookie: `${name}=${state}.${verifier}.${encoded}` } }));
      staysOnSite(res.headers.get("location")!);
    }
  }
});

function req(cookie?: string): Request {
  return new Request("https://books.test/", cookie ? { headers: { cookie } } : {});
}

test("identify: a valid session is a member", async () => {
  const m = make();
  const res = await signIn(m);
  expect(await m.identify(req(cookies(res)))).toMatchObject({ status: "member",
    member: { name: "Natalie", email: "natalie@example.com", isAdmin: true } });
});

test.each(["no cookie", "a malformed token", "an unknown token", "an expired session", "a removed member"])(
  "identify: %s is signed-out", async (kind) => {
    let t = 0;
    const m = make({ now: () => t });
    const res = await signIn(m);
    let cookie: string | undefined;
    if (kind === "a malformed token") cookie = "__Host-lib_session=short";
    else if (kind === "an unknown token") cookie = `__Host-lib_session=${"A".repeat(43)}`;
    else if (kind === "an expired session") { t = 91 * 86_400_000; cookie = cookies(res); }
    else if (kind === "a removed member") {
      await env.DB.prepare("update members set removed_at = 1").run();
      cookie = cookies(res);
    }
    expect(await m.identify(req(cookie))).toEqual({ status: "signed-out" });
  });

test("identify: a database that throws is unavailable, and currentMember is still null", async () => {
  const res = await signIn(make());
  const broken = make({ db: { prepare() { throw new Error("db down"); } } as unknown as D1Database });
  expect(await broken.identify(req(cookies(res)))).toEqual({ status: "unavailable" });
  expect(await broken.currentMember(req(cookies(res)))).toBeNull();
});

test("signInAs gives a cookie that identify accepts", async () => {
  const { member, cookie } = await signInAs(env.DB, natalie, { admins: natalie.email });
  expect(member).toMatchObject({ name: "Natalie", email: "natalie@example.com" });
  expect(await make().identify(req(cookie))).toEqual({ status: "member", member });
});
