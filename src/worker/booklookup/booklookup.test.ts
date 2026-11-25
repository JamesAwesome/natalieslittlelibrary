import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BookInfo } from "../../shared/types";
import { resetDatabase } from "../../../test/reset";
import found from "./fixtures/found.json";
import googleFound from "./fixtures/google-found.json";
import { createBookLookup, lookupSources, type BookSource } from "./index";

const ISBN = "9798855427974";
const BOOK_KEY = `ISBN:${ISBN}`;
const A: BookInfo = { isbn: ISBN, title: "From A", authors: ["Ann"], coverUrl: null };
const B: BookInfo = { isbn: ISBN, title: "From B", authors: ["Bo"], coverUrl: null };

beforeEach(async () => {
  // Any fetch that is not passed in explicitly is a bug: fail loudly rather than reach the network.
  vi.stubGlobal("fetch", () => {
    throw new Error("a test made a real network request");
  });
  await resetDatabase(env.DB);
});
afterEach(() => vi.unstubAllGlobals());

function source(name: string, result: () => Promise<BookInfo | null>): BookSource & { calls: string[]; signals: AbortSignal[] } {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  return {
    name,
    calls,
    signals,
    async find(isbn, _fetch, signal) {
      calls.push(isbn);
      signals.push(signal);
      return result();
    },
  };
}

const returns = (name: string, book: BookInfo | null) => source(name, async () => book);

async function rows(): Promise<{ isbn: string; title: string; authors: string; cover_url: string | null; source: string; fetched_at: number }[]> {
  return (await env.DB.prepare("select * from book_lookups").all()).results as never;
}

function stubFetch(body: unknown, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

test("found at the first source: the second is not asked, and the answer is cached", async () => {
  const a = returns("a", A);
  const b = returns("b", B);
  const lookup = createBookLookup({ db: env.DB, sources: [a, b], now: () => 5000 });
  expect(await lookup.lookup(ISBN)).toEqual(A);
  expect(b.calls).toEqual([]);
  expect(await rows()).toEqual([
    { isbn: ISBN, title: "From A", authors: JSON.stringify(["Ann"]), cover_url: null, source: "a", fetched_at: 5000 },
  ]);
});

test("a second lookup is answered from the cache with no request", async () => {
  const a = returns("a", A);
  const lookup = createBookLookup({ db: env.DB, sources: [a] });
  await lookup.lookup(ISBN);
  expect(await lookup.lookup(ISBN)).toEqual(A);
  expect(a.calls).toHaveLength(1);
});

test("a cached book keeps its cover", async () => {
  const withCover = { ...A, coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg" };
  const a = returns("a", withCover);
  const lookup = createBookLookup({ db: env.DB, sources: [a] });
  await lookup.lookup(ISBN);
  expect(await lookup.lookup(ISBN)).toEqual(withCover);
  expect(a.calls).toHaveLength(1);
});

test("not at the first source, found at the second", async () => {
  const a = returns("a", null);
  const b = returns("b", B);
  const lookup = createBookLookup({ db: env.DB, sources: [a, b] });
  expect(await lookup.lookup(ISBN)).toEqual(B);
  expect((await rows())[0].source).toBe("b");
});

test("found nowhere is null and is not cached", async () => {
  const a = returns("a", null);
  const lookup = createBookLookup({ db: env.DB, sources: [a] });
  expect(await lookup.lookup(ISBN)).toBeNull();
  expect(await rows()).toEqual([]);
  expect(await lookup.lookup(ISBN)).toBeNull();
  expect(a.calls).toHaveLength(2);
});

const failures: [string, () => Promise<BookInfo | null>][] = [
  ["a rejected fetch", async () => { throw new TypeError("network down"); }],
  ["a 500", async () => null],
  ["a body that is not JSON", async () => { throw new SyntaxError("Unexpected token"); }],
  ["JSON of the wrong shape", async () => ({ nonsense: true }) as unknown as BookInfo],
  ["a request that never answers", () => new Promise<never>(() => {})],
];

test.each(failures.map(([name]) => name))("the first source giving %s falls through to the second", async (name) => {
  const bad = source("bad", failures.find(([n]) => n === name)![1]);
  const b = returns("b", B);
  const lookup = createBookLookup({ db: env.DB, sources: [bad, b], timeoutMs: 20 });
  expect(await lookup.lookup(ISBN)).toEqual(B);
  expect(bad.calls).toHaveLength(1);
});

test("Open Library giving a rejected fetch, a 500, non-JSON, or the wrong shape is null", async () => {
  const cases: typeof fetch[] = [
    (async () => { throw new TypeError("network down"); }) as typeof fetch,
    (async () => new Response("{}", { status: 500 })) as typeof fetch,
    (async () => new Response("<html>", { status: 200 })) as typeof fetch,
    (async () => new Response(JSON.stringify({ [BOOK_KEY]: { title: 7 } }), { status: 200 })) as typeof fetch,
  ];
  for (const fetch of cases) {
    expect(await createBookLookup({ db: env.DB, fetch }).lookup(ISBN)).toBeNull();
  }
  expect(await rows()).toEqual([]);
});

test("a source that never answers is aborted: its signal fires", async () => {
  const never = source("never", () => new Promise<never>(() => {}));
  const started = Date.now();
  await createBookLookup({ db: env.DB, sources: [never], timeoutMs: 20 }).lookup(ISBN);
  expect(never.signals[0].aborted).toBe(true);
  expect(Date.now() - started).toBeLessThan(2000);
});

test("every source failing is null, never a throw", async () => {
  const a = source("a", async () => { throw new Error("boom"); });
  const b = source("b", async () => { throw "not even an Error"; });
  await expect(createBookLookup({ db: env.DB, sources: [a, b] }).lookup(ISBN)).resolves.toBeNull();
});

test("a cache table error does not stop the lookup", async () => {
  const broken = {
    prepare() {
      throw new Error("no such table: book_lookups");
    },
  } as unknown as D1Database;
  const a = returns("a", A);
  await expect(createBookLookup({ db: broken, sources: [a] }).lookup(ISBN)).resolves.toEqual(A);
});

async function insertRow(title: string, authors: string, cover: string | null): Promise<void> {
  await env.DB.prepare("insert into book_lookups (isbn, title, authors, cover_url, source, fetched_at) values (?, ?, ?, ?, 'x', 1)")
    .bind(ISBN, title, authors, cover)
    .run();
}

test("a cache row is cleaned on the way out, and no request is made", async () => {
  await insertRow("y".repeat(400), '{"not":"an array"}', "https://evil.example/p.gif");
  const a = returns("a", A);
  const book = await createBookLookup({ db: env.DB, sources: [a] }).lookup(ISBN);
  expect(book).toEqual({ isbn: ISBN, title: "y".repeat(300), authors: [], coverUrl: null });
  expect(a.calls).toEqual([]);
});

test("a cache row whose authors are not JSON is read with no authors", async () => {
  await insertRow("Old", "not json", null);
  expect(await createBookLookup({ db: env.DB, sources: [returns("a", A)] }).lookup(ISBN)).toEqual({
    isbn: ISBN, title: "Old", authors: [], coverUrl: null,
  });
});

function hangingDb(hang: "read" | "write"): D1Database {
  const never = () => new Promise<never>(() => {});
  return {
    prepare(sql: string) {
      const isRead = sql.trim().toLowerCase().startsWith("select");
      const stmt = {
        bind: () => stmt,
        first: () => (hang === "read" && isRead ? never() : Promise.resolve(null)),
        run: () => (hang === "write" && !isRead ? never() : Promise.resolve({})),
      };
      return stmt;
    },
  } as unknown as D1Database;
}

test("a cache read that never settles is a miss: the source still answers", async () => {
  const started = Date.now();
  const book = await createBookLookup({ db: hangingDb("read"), sources: [returns("a", A)], timeoutMs: 20 }).lookup(ISBN);
  expect(book).toEqual(A);
  expect(Date.now() - started).toBeLessThan(2000);
});

test("a cache write that never settles is ignored: the found book is returned", async () => {
  const started = Date.now();
  const book = await createBookLookup({ db: hangingDb("write"), sources: [returns("a", A)], timeoutMs: 20 }).lookup(ISBN);
  expect(book).toEqual(A);
  expect(Date.now() - started).toBeLessThan(2000);
});

test("no timer is left pending after a lookup", async () => {
  const set = vi.spyOn(globalThis, "setTimeout");
  const cleared = vi.spyOn(globalThis, "clearTimeout");
  const a = returns("a", A);
  await createBookLookup({ db: env.DB, sources: [a], timeoutMs: 50 }).lookup(ISBN);
  const ids = set.mock.results.map((r) => r.value);
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) expect(cleared).toHaveBeenCalledWith(id);
  await new Promise((r) => setTimeout(r, 80));
  expect(a.signals[0].aborted).toBe(false);
});

test("a value that is not a string is null with no request", async () => {
  const a = returns("a", A);
  const lookup = createBookLookup({ db: env.DB, sources: [a] });
  for (const raw of [undefined, null, 9798855427974, {}, ["9798855427974"]]) {
    expect(await lookup.lookup(raw as unknown as string)).toBeNull();
  }
  expect(a.calls).toEqual([]);
});

test("an ISBN-10 is looked up and cached as its ISBN-13", async () => {
  const a = returns("a", { ...A, isbn: "9780441172719" });
  const lookup = createBookLookup({ db: env.DB, sources: [a] });
  expect(await lookup.lookup("0-441-17271-7")).toEqual({ ...A, isbn: "9780441172719" });
  expect(a.calls).toEqual(["9780441172719"]);
  expect((await rows())[0].isbn).toBe("9780441172719");
  await lookup.lookup("9780441172719");
  expect(a.calls).toHaveLength(1);
});

test("something that is not an ISBN is null with no request", async () => {
  const a = returns("a", A);
  const lookup = createBookLookup({ db: env.DB, sources: [a] });
  for (const raw of ["", "hello", "012345678905", "9780441172710"]) expect(await lookup.lookup(raw)).toBeNull();
  expect(a.calls).toEqual([]);
});

test("the default source asks Open Library through the fetch it is given", async () => {
  const calls: string[] = [];
  const lookup = createBookLookup({ db: env.DB, fetch: stubFetch(found, calls) });
  const book = await lookup.lookup(ISBN);
  expect(book?.title).toBe("Guy She Was Interested in Wasn't a Guy at All, Vol. 3");
  expect(calls).toEqual([`https://openlibrary.org/api/books?bibkeys=ISBN:${ISBN}&format=json&jscmd=data`]);
});

test.each([
  ["https://covers.openlibrary.org/b/id/1-M.jpg", "https://covers.openlibrary.org/b/id/1-M.jpg"],
  ["http://covers.openlibrary.org/b/id/1-M.jpg", null],
  ["https://evil.example/pixel.gif", null],
  ["https://covers.openlibrary.org.evil.example/x.jpg", null],
  ["javascript:alert(1)", null],
  ["", null],
])("cover %s is stored as %s", async (cover, stored) => {
  const body = { [BOOK_KEY]: { title: "T", authors: [{ name: "N" }], cover: { medium: cover } } };
  const lookup = createBookLookup({ db: env.DB, fetch: stubFetch(body) });
  expect((await lookup.lookup(ISBN))?.coverUrl).toBe(stored);
  expect((await rows())[0].cover_url).toBe(stored);
});

test("a title of 400 characters is cut to 300; a missing title is not found", async () => {
  const long = { [BOOK_KEY]: { title: "x".repeat(400) } };
  expect((await createBookLookup({ db: env.DB, fetch: stubFetch(long) }).lookup(ISBN))?.title).toHaveLength(300);
  await resetDatabase(env.DB);
  for (const title of [undefined, "", "   "]) {
    const body = { [BOOK_KEY]: { title } };
    expect(await createBookLookup({ db: env.DB, fetch: stubFetch(body) }).lookup(ISBN)).toBeNull();
  }
  expect(await rows()).toEqual([]);
});

test("authors are trimmed and capped at 10", async () => {
  const authors = Array.from({ length: 12 }, (_, i) => ({ name: ` Author ${i} ` }));
  const body = { [BOOK_KEY]: { title: "T", authors } };
  const book = await createBookLookup({ db: env.DB, fetch: stubFetch(body) }).lookup(ISBN);
  expect(book?.authors).toHaveLength(10);
  expect(book?.authors[0]).toBe("Author 0");
});

// A fetch that answers by host.
function byHost(open: () => Response, google: () => Response, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return new URL(url).hostname === "www.googleapis.com" ? google() : open();
  }) as typeof fetch;
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const googleCalls = (calls: string[]) => calls.filter((u) => u.includes("googleapis.com"));

test("lookupSources with no key, an empty key, or a blank key is Open Library only", () => {
  for (const k of [undefined, null, "", "   ", 42]) expect(lookupSources(k).map((s) => s.name)).toEqual(["openlibrary"]);
});

test("lookupSources with a key puts Google Books after Open Library", () => {
  expect(lookupSources("test-key").map((s) => s.name)).toEqual(["openlibrary", "google-books"]);
});

test("Open Library found: Google is never asked", async () => {
  const calls: string[] = [];
  const lookup = createBookLookup({ db: env.DB, sources: lookupSources("test-key"), fetch: byHost(json(found), json(googleFound), calls) });
  expect((await lookup.lookup(ISBN))?.title).toBe(found[BOOK_KEY].title);
  expect(googleCalls(calls)).toEqual([]);
});

test("Open Library miss then Google found: Google's book is returned with its cover and cached with source google-books", async () => {
  const calls: string[] = [];
  const lookup = createBookLookup({ db: env.DB, sources: lookupSources("test-key"), fetch: byHost(json({}), json(googleFound), calls) });
  const book = await lookup.lookup(ISBN);
  expect(book?.title).toBe(googleFound.items[0].volumeInfo.title);
  expect(book?.coverUrl).toMatch(/^https:\/\/books\.google\.com\/books\/content\?/);
  expect(googleCalls(calls)).toHaveLength(1);
  const stored = await rows();
  expect(stored.map((r) => r.source)).toEqual(["google-books"]);
  expect(stored[0].cover_url).toBe(book?.coverUrl);
  // A second lookup is answered from the cache.
  expect(await lookup.lookup(ISBN)).toEqual(book);
  expect(googleCalls(calls)).toHaveLength(1);
});

test("Open Library 500 then Google found", async () => {
  const lookup = createBookLookup({ db: env.DB, sources: lookupSources("test-key"), fetch: byHost(json({}, 500), json(googleFound)) });
  expect((await lookup.lookup(ISBN))?.title).toBe(googleFound.items[0].volumeInfo.title);
});

test("Open Library timeout then Google found", async () => {
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).hostname !== "www.googleapis.com") {
      return new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    }
    return new Response(JSON.stringify(googleFound), { status: 200 });
  }) as typeof fetch;
  const lookup = createBookLookup({ db: env.DB, sources: lookupSources("test-key"), fetch: f, timeoutMs: 50 });
  expect((await lookup.lookup(ISBN))?.title).toBe(googleFound.items[0].volumeInfo.title);
});

test("Google over quota after an Open Library miss: null, nothing cached", async () => {
  const lookup = createBookLookup({ db: env.DB, sources: lookupSources("test-key"), fetch: byHost(json({}), json({}, 429)) });
  expect(await lookup.lookup(ISBN)).toBeNull();
  expect(await rows()).toEqual([]);
});

test("both miss: null, nothing cached", async () => {
  const lookup = createBookLookup({ db: env.DB, sources: lookupSources("test-key"), fetch: byHost(json({}), json({ totalItems: 0 })) });
  expect(await lookup.lookup(ISBN)).toBeNull();
  expect(await rows()).toEqual([]);
});

test("no cached row and no stored cover contain the key", async () => {
  const lookup = createBookLookup({ db: env.DB, sources: lookupSources("test-key"), fetch: byHost(json({}), json(googleFound)) });
  await lookup.lookup(ISBN);
  expect(JSON.stringify(await rows())).not.toContain("test-key");
});
