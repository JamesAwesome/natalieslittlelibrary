import { afterEach, expect, test, vi } from "vitest";
import { ApiError, addCopy, claim, getLabel, getMe, logout, lookupBook, mintLabels, returnCopy } from "./api";

const member = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: () => Promise<Response>) {
  const f = vi.fn<typeof fetch>(() => impl());
  vi.stubGlobal("fetch", f);
  return f;
}

test("getMe requests /api/me and returns the member", async () => {
  const f = stubFetch(async () => json({ member }));
  expect(await getMe()).toEqual(member);
  expect(f.mock.calls[0][0]).toBe("/api/me");
});

test("getMe returns null for a signed-out 200", async () => {
  stubFetch(async () => json({ member: null }));
  expect(await getMe()).toBeNull();
});

test("getMe treats a 200 without a member key as signed out", async () => {
  stubFetch(async () => json({}));
  expect(await getMe()).toBeNull();
});

test("getMe rejects on a 500, even with a member-shaped body", async () => {
  stubFetch(async () => json({ member }, 500));
  await expect(getMe()).rejects.toThrow();
});

test("getMe rejects when the body is not JSON", async () => {
  stubFetch(async () => new Response("<html>", { status: 200 }));
  await expect(getMe()).rejects.toThrow();
});

test("getMe rejects when fetch itself rejects", async () => {
  stubFetch(async () => { throw new TypeError("offline"); });
  await expect(getMe()).rejects.toThrow("offline");
});

test("logout POSTs to /auth/logout and resolves on 204", async () => {
  const f = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal("fetch", f);
  await expect(logout()).resolves.toBeUndefined();
  expect(f.mock.calls[0][0]).toBe("/auth/logout");
  expect(f.mock.calls[0][1]?.method).toBe("POST");
});

test("logout rejects on a 500", async () => {
  stubFetch(async () => new Response(null, { status: 500 }));
  await expect(logout()).rejects.toThrow();
});

const sent = (f: ReturnType<typeof stubFetch>) => {
  const [url, init] = f.mock.calls[0];
  return { url, method: init?.method ?? "GET", body: init?.body === undefined ? undefined : JSON.parse(init.body as string) };
};

test("getLabel GETs the encoded code", async () => {
  const f = stubFetch(async () => json({ kind: "unknown" }));
  expect(await getLabel("a b/c")).toEqual({ kind: "unknown" });
  expect(sent(f)).toEqual({ url: "/api/labels/a%20b%2Fc", method: "GET", body: undefined });
});

test("mintLabels POSTs the count", async () => {
  const f = stubFetch(async () => json({ labels: [{ code: "abc", url: "https://x/b/abc" }] }));
  expect(await mintLabels(3)).toEqual({ labels: [{ code: "abc", url: "https://x/b/abc" }] });
  expect(sent(f)).toEqual({ url: "/api/labels", method: "POST", body: { count: 3 } });
});

test("lookupBook GETs with the ISBN encoded", async () => {
  const f = stubFetch(async () => json({ book: null, suggestion: null }));
  expect(await lookupBook("978 &x")).toEqual({ book: null, suggestion: null });
  expect(sent(f)).toEqual({ url: "/api/books/lookup?isbn=978%20%26x", method: "GET", body: undefined });
});

test("addCopy POSTs either shape as given", async () => {
  const f = stubFetch(async () => json({ copyId: "c1" }));
  await addCopy({ code: "abc", isbn: "9780000000002" });
  expect(sent(f)).toEqual({ url: "/api/copies", method: "POST", body: { code: "abc", isbn: "9780000000002" } });
  f.mockClear();
  await addCopy({ code: "abc", title: "T", authors: ["A"] });
  expect(sent(f).body).toEqual({ code: "abc", title: "T", authors: ["A"] });
});

test("claim and returnCopy POST with the id encoded and no body", async () => {
  const f = stubFetch(async () => json({ copyId: "c1" }));
  await claim("a/b");
  expect(sent(f)).toEqual({ url: "/api/labels/a%2Fb/claim", method: "POST", body: undefined });
  f.mockClear();
  await returnCopy("c 1");
  expect(sent(f)).toEqual({ url: "/api/copies/c%201/return", method: "POST", body: undefined });
});

test("a refusal throws ApiError with status and reason", async () => {
  stubFetch(async () => json({ rejected: "not-allowed" }, 403));
  const err = await claim("abc").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 403, rejected: "not-allowed" });
});

test("a non-JSON error body still throws ApiError with rejected null", async () => {
  stubFetch(async () => new Response("<html>", { status: 502 }));
  const err = await getLabel("abc").catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 502, rejected: null });
});

test("getMe throws ApiError carrying 503", async () => {
  stubFetch(async () => json({ rejected: "unavailable" }, 503));
  await expect(getMe()).rejects.toMatchObject({ status: 503, rejected: "unavailable" });
});
