import { expect, test } from "vitest";
import { googleProvider } from "./index";

type Call = { url: string; init: RequestInit | undefined };

function b64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function idToken(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}.${b64url("sig")}`;
}

function respond(status: number, body: unknown): typeof fetch {
  return respondText(status, JSON.stringify(body));
}

function respondText(status: number, text: string): typeof fetch {
  return (async () => new Response(text, { status })) as typeof fetch;
}

function recording(inner: typeof fetch, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return inner(input, init);
  }) as typeof fetch;
}

function google(fetchStub: typeof fetch = respond(500, {})) {
  return googleProvider({ clientId: "test-client", clientSecret: "test-secret", siteUrl: "https://books.test", fetch: fetchStub });
}

const good = {
  iss: "https://accounts.google.com", aud: "test-client", sub: "g-1",
  email: "natalie@example.com", email_verified: true, name: "Natalie", picture: "https://p.test/n.jpg",
};

test("the authorization URL carries the client, callback, scope, and PKCE challenge", async () => {
  const url = await google().authorizationUrl("state-1", "verifier-1");
  expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    client_id: "test-client", redirect_uri: "https://books.test/auth/callback",
    response_type: "code", scope: "openid email profile", prompt: "select_account", state: "state-1", code_challenge_method: "S256" });
  expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("the code challenge is the base64url SHA-256 of the verifier", async () => {
  // RFC 7636 appendix B vector.
  const url = await google().authorizationUrl("s", "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  expect(url.searchParams.get("code_challenge")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("a good token response becomes an identity", async () => {
  const p = google(respond(200, { id_token: idToken(good) }));
  expect(await p.exchange("code-1", "verifier-1")).toEqual({ provider: "google", subject: "g-1",
    email: "natalie@example.com", emailVerified: true, name: "Natalie", pictureUrl: "https://p.test/n.jpg" });
});

test("the token call sends the code, verifier, and secret as a form post", async () => {
  const calls: Call[] = [];
  await google(recording(respond(200, { id_token: idToken(good) }), calls)).exchange("code-1", "verifier-1");
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
  expect(calls[0].init?.method).toBe("POST");
  const body = new URLSearchParams(String(calls[0].init?.body));
  expect(Object.fromEntries(body)).toEqual({
    code: "code-1", client_id: "test-client", client_secret: "test-secret",
    redirect_uri: "https://books.test/auth/callback", grant_type: "authorization_code", code_verifier: "verifier-1" });
  expect(calls[0].init?.redirect).toBe("error");
  expect(new Headers(calls[0].init?.headers).get("content-type")).toContain("application/x-www-form-urlencoded");
});

test("a missing name falls back to the email's local part", async () => {
  const id = await google(respond(200, { id_token: idToken({ ...good, name: undefined }) })).exchange("c", "v");
  expect(id.name).toBe("natalie");
});

test("a missing picture becomes null", async () => {
  const id = await google(respond(200, { id_token: idToken({ ...good, picture: undefined }) })).exchange("c", "v");
  expect(id.pictureUrl).toBeNull();
});

test("non-ASCII names survive decoding", async () => {
  for (const name of ["Zoë Łukasz 日本", "é"]) {
    const id = await google(respond(200, { id_token: idToken({ ...good, name }) })).exchange("c", "v");
    expect(id.name).toBe(name);
  }
});

test("email_verified is true for boolean true and the string \"true\" only", async () => {
  const verified = async (v: unknown) =>
    (await google(respond(200, { id_token: idToken({ ...good, email_verified: v }) })).exchange("c", "v")).emailVerified;
  expect(await verified(true)).toBe(true);
  expect(await verified("true")).toBe(true);
  for (const v of [false, "false", "TRUE", 1, null, undefined, "yes"]) expect(await verified(v)).toBe(false);
});

test("the issuer may be the bare accounts.google.com", async () => {
  const id = await google(respond(200, { id_token: idToken({ ...good, iss: "accounts.google.com" }) })).exchange("c", "v");
  expect(id.subject).toBe("g-1");
});

test.each([
  ["an error status", respond(400, { error: "invalid_grant" })],
  ["an error status that still carries a token", respond(400, { id_token: idToken(good) })],
  ["a body that is not JSON", respondText(200, "<html>")],
  ["no id_token", respond(200, {})],
  ["a token for another client", respond(200, { id_token: idToken({ ...good, aud: "someone-else" }) })],
  ["a token whose audience list merely contains this client", respond(200, { id_token: idToken({ ...good, aud: ["test-client"] }) })],
  ["a token from another issuer", respond(200, { id_token: idToken({ ...good, iss: "https://evil.example" }) })],
  ["a token with no issuer", respond(200, { id_token: idToken({ ...good, iss: undefined }) })],
  ["a token with no subject", respond(200, { id_token: idToken({ ...good, sub: undefined }) })],
  ["a token with no email", respond(200, { id_token: idToken({ ...good, email: undefined }) })],
  ["a malformed token", respond(200, { id_token: "not.a.jwt" })],
  ["a token with too few parts", respond(200, { id_token: "abc" })],
  ["a payload that is not an object", respond(200, { id_token: `a.${b64url("[1]")}.c` })],
  ["a network failure", (async () => { throw new TypeError("offline"); }) as typeof fetch],
])("exchange throws on %s", async (_name, fetchStub) => {
  await expect(google(fetchStub).exchange("c", "v")).rejects.toThrow();
});

test.each(["https://books.test", "https://books.test/"])("siteUrl %s yields one callback URL everywhere", async (siteUrl) => {
  const calls: Call[] = [];
  const p = googleProvider({ clientId: "test-client", clientSecret: "test-secret", siteUrl,
    fetch: recording(respond(200, { id_token: idToken(good) }), calls) });
  expect((await p.authorizationUrl("s", "v")).searchParams.get("redirect_uri")).toBe("https://books.test/auth/callback");
  await p.exchange("c", "v");
  expect(new URLSearchParams(String(calls[0].init?.body)).get("redirect_uri")).toBe("https://books.test/auth/callback");
});
