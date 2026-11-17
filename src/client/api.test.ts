import { afterEach, expect, test, vi } from "vitest";
import { getMe, logout } from "./api";

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
