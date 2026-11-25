import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { invariantViolations } from "../../test/invariant";
import { resetDatabase } from "../../test/reset";
import type { CollectionSummary, CopyView, ImportResult, LabelView, Shelf, ShelfItem } from "../shared/types";
import many from "./booklookup/fixtures/many.json";
import app from "./index";
import { signInAs } from "./membership/testing";

const person = (subject: string, name: string) => ({
  provider: "google" as const, subject, email: `${subject}@example.com`, name, pictureUrl: null, emailVerified: true,
});

beforeEach(() => resetDatabase(env.DB));
afterEach(async () => {
  expect(await invariantViolations(env.DB)).toEqual([]);
});

test("print, pair, claim, return", async () => {
  const natalie = await signInAs(env.DB, person("natalie", "Natalie"));
  const james = await signInAs(env.DB, person("james", "James"));
  const call = (path: string, cookie: string | null, init: RequestInit = {}) =>
    app.request(`https://books.test${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" } }, env);
  const post = (path: string, cookie: string, body?: unknown) =>
    app.request(`https://books.test${path}`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    }, env);

  const minted = await post("/api/labels", natalie.cookie, { count: 3 });
  expect(minted.status).toBe(200);
  const { labels } = (await minted.json()) as { labels: { code: string; url: string }[] };
  expect(labels).toHaveLength(3);
  const code = labels[0].code;

  const added = await post("/api/copies", natalie.cookie, { code, title: "The Hobbit", authors: ["J. R. R. Tolkien"] });
  expect(added.status).toBe(200);
  expect(((await added.json()) as CopyView).home).toBe(true);

  const publicRes = await call(`/api/labels/${code}`, null);
  const publicText = await publicRes.text();
  expect((JSON.parse(publicText) as LabelView).kind).toBe("public");
  expect(publicText).not.toContain("Natalie");
  expect(publicText).not.toContain("@");

  const jamesView = (await (await call(`/api/labels/${code}`, james.cookie)).json()) as Extract<LabelView, { kind: "copy" }>;
  expect(jamesView.kind).toBe("copy");
  expect(jamesView.copy.actions).toEqual(["claim"]);

  const claimed = await post(`/api/labels/${code}/claim`, james.cookie);
  expect(claimed.status).toBe(200);
  const afterClaim = (await claimed.json()) as CopyView;
  expect(afterClaim.holder).toMatchObject({ kind: "member", person: { name: "James" } });
  expect((await post(`/api/labels/${code}/claim`, james.cookie)).status).toBe(403);

  const nView = (await (await call(`/api/labels/${code}`, natalie.cookie)).json()) as Extract<LabelView, { kind: "copy" }>;
  expect(nView.copy.actions).toEqual(["return", "move"]);

  const returned = await post(`/api/copies/${nView.copy.copyId}/return`, natalie.cookie);
  expect(returned.status).toBe(200);
  const final = (await returned.json()) as CopyView;
  expect(final.home).toBe(true);
  expect(final.history.map((h) => [h.type, h.actor.name])).toEqual([
    ["returned", "Natalie"], ["claimed", "James"], ["labelled", "Natalie"], ["added", "Natalie"],
  ]);
});

// The real servicesFor asks Open Library; this answers from the recorded response and never touches the network.
test("import, see the shelf, scan to label, lend, and come home to the same collection", async () => {
  const urls: string[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(many), { status: 200 });
  }) as typeof fetch);
  try {
    const natalie = await signInAs(env.DB, person("natalie", "Natalie"));
    const sam = await signInAs(env.DB, person("sam", "Sam"));
    const send = (method: string, path: string, cookie: string, body?: unknown) =>
      app.request(`https://books.test${path}`, {
        method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
      }, env);
    const KNOWN = "9798855427974";
    const UNKNOWN = "9783141592658";

    const beach = (await (await send("POST", "/api/collections", natalie.cookie, { name: "Beach house" })).json()) as CollectionSummary;
    const rows = [
      { title: "Guy She Was Interested In", authors: ["Sumiko Arai"], isbn: KNOWN },
      { title: "Die Verwandlung", authors: ["Franz Kafka"], isbn: UNKNOWN },
      { title: "An Old Atlas", authors: ["Anon"], isbn: null },
    ];
    const first = await send("POST", "/api/imports", natalie.cookie, { collectionId: beach.id, rows });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ added: 3, skipped: 0 } satisfies ImportResult);

    const shelf = (await (await send("GET", `/api/collections/${beach.id}`, natalie.cookie)).json()) as Shelf;
    expect(shelf.items).toHaveLength(3);
    expect(shelf.items.every((i) => i.labelled === false)).toBe(true);

    const again = await send("POST", "/api/imports", natalie.cookie, { collectionId: beach.id, rows });
    expect(await again.json()).toEqual({ added: 0, skipped: 3 } satisfies ImportResult);

    const copies = async () => (await env.DB.prepare("select count(*) as n from copies").first<{ n: number }>())!.n;
    expect(await copies()).toBe(3);
    const { labels } = (await (await send("POST", "/api/labels", natalie.cookie, { count: 1 })).json()) as { labels: { code: string }[] };
    const code = labels[0].code;
    const kafka = shelf.items.find((i) => i.book.title === "Die Verwandlung") as ShelfItem;
    const bound = await send("POST", "/api/copies", natalie.cookie, { code, isbn: UNKNOWN });
    expect(bound.status).toBe(200);
    expect(((await bound.json()) as CopyView).copyId).toBe(kafka.copyId);
    expect(await copies()).toBe(3);

    const theirs = await send("GET", `/api/members/${natalie.member.id}/collections`, sam.cookie);
    const theirShelf = await send("GET", `/api/collections/${beach.id}`, sam.cookie);
    for (const text of [await theirs.text(), await theirShelf.text()]) {
      expect(text).not.toContain(code);
      expect(text).not.toContain("@");
    }

    const claimed = await send("POST", `/api/labels/${code}/claim`, sam.cookie);
    expect(claimed.status).toBe(200);
    const holding = (await (await send("GET", "/api/holding", sam.cookie)).json()) as { items: ShelfItem[] };
    expect(holding.items).toHaveLength(1);
    expect(holding.items[0]).toMatchObject({ copyId: kafka.copyId, owner: { name: "Natalie" }, collection: { id: beach.id, name: "Beach house" } });

    const returned = await send("POST", `/api/copies/${kafka.copyId}/return`, natalie.cookie);
    expect(returned.status).toBe(200);
    const home = (await (await send("GET", `/api/copies/${kafka.copyId}`, natalie.cookie)).json()) as CopyView;
    expect(home.home).toBe(true);
    expect(home.collection).toMatchObject({ id: beach.id, name: "Beach house" });
    expect(home.code).toBeNull();
    expect(urls.every((u) => u.startsWith("https://openlibrary.org/"))).toBe(true);
  } finally {
    spy.mockRestore();
  }
});
