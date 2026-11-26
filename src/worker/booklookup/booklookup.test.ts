import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BookInfo } from "../../shared/types";
import { resetDatabase } from "../../../test/reset";
import many from "./fixtures/many.json";
import found from "./fixtures/found.json";
import googleFound from "./fixtures/google-found.json";
import { createBookLookup, LookupUnavailable, lookupSources, MAX_BATCH, type BookSource } from "./index";

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

// ---- lookupMany ----

const ISBN_DUNE = "9780441172719";
const ISBN_MISS = "9783141592658";
const DUNE: BookInfo = { isbn: ISBN_DUNE, title: "Dune", authors: ["Frank Herbert"], coverUrl: null };

function manySource(
  name: string,
  result: (isbns: string[], signal: AbortSignal) => Promise<Map<string, BookInfo>>,
): BookSource & { calls: string[][]; signals: AbortSignal[] } {
  const calls: string[][] = [];
  const signals: AbortSignal[] = [];
  return {
    name,
    calls,
    signals,
    async find() {
      throw new Error("lookupMany must not use find");
    },
    async findMany(isbns, _fetch, signal) {
      calls.push(isbns);
      signals.push(signal);
      return result(isbns, signal);
    },
  };
}

const finds = (name: string, ...books: BookInfo[]) =>
  manySource(name, async () => new Map<string, BookInfo>(books.map((b): [string, BookInfo] => [b.isbn as string, b])));

test("lookupMany answers cached ISBNs without a request and asks once for the rest", async () => {
  const seed = createBookLookup({ db: env.DB, sources: [returns("seed", A)], now: () => 1 });
  await seed.lookup(ISBN);
  const s = finds("a", DUNE);
  const got = await createBookLookup({ db: env.DB, sources: [s] }).lookupMany([ISBN, ISBN_DUNE]);
  expect(s.calls).toEqual([[ISBN_DUNE]]);
  expect(got).toEqual(new Map([[ISBN, A], [ISBN_DUNE, DUNE]]));
});

test("lookupMany with everything cached makes no request", async () => {
  await createBookLookup({ db: env.DB, sources: [returns("seed", A)] }).lookup(ISBN);
  const s = finds("a");
  expect((await createBookLookup({ db: env.DB, sources: [s] }).lookupMany([ISBN])).get(ISBN)).toEqual(A);
  expect(s.calls).toEqual([]);
});

test("lookupMany caches what it found in one batch", async () => {
  const s = finds("a", A, DUNE);
  const statements: string[] = [];
  const spyDb = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "batch") return (stmts: unknown[]) => { statements.push(`batch:${stmts.length}`); return target.batch(stmts as never); };
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  await createBookLookup({ db: spyDb, sources: [s], now: () => 7 }).lookupMany([ISBN, ISBN_DUNE, ISBN_MISS]);
  expect(statements).toEqual(["batch:2"]);
  expect((await rows()).map((r) => [r.isbn, r.source, r.fetched_at]).sort()).toEqual(
    [[ISBN, "a", 7], [ISBN_DUNE, "a", 7]].sort(),
  );
  // A second import is answered from the cache.
  const again = finds("b");
  const got = await createBookLookup({ db: env.DB, sources: [again] }).lookupMany([ISBN, ISBN_DUNE]);
  expect(again.calls).toEqual([]);
  expect([...got.keys()].sort()).toEqual([ISBN, ISBN_DUNE].sort());
});

test("lookupMany normalises ISBN-10s, drops non-ISBNs, and asks for each ISBN once", async () => {
  const s = finds("a");
  const got = await createBookLookup({ db: env.DB, sources: [s] }).lookupMany([
    "0441172717", // Dune as an ISBN-10
    ISBN_DUNE,
    "978-0-441-17271-9",
    "not an isbn",
    "9780306406158",
    "",
    5 as unknown as string,
  ]);
  expect(s.calls).toEqual([[ISBN_DUNE]]);
  expect(got.size).toBe(0);
});

test("lookupMany of no usable ISBN asks nothing", async () => {
  const s = finds("a");
  expect((await createBookLookup({ db: env.DB, sources: [s] }).lookupMany(["x", ""])).size).toBe(0);
  expect(s.calls).toEqual([]);
});

test("lookupMany asks each source once, in order, only for what is still missing", async () => {
  const a = finds("a", A);
  const b = finds("b", DUNE);
  const c = finds("c");
  const got = await createBookLookup({ db: env.DB, sources: [a, b, c] }).lookupMany([ISBN, ISBN_DUNE]);
  expect(a.calls).toEqual([[ISBN, ISBN_DUNE]]);
  expect(b.calls).toEqual([[ISBN_DUNE]]);
  expect(c.calls).toEqual([]);
  expect(got.get(ISBN_DUNE)).toEqual(DUNE);
  expect((await rows()).find((r) => r.isbn === ISBN_DUNE)?.source).toBe("b");
});

test("a source without findMany is not asked by lookupMany", async () => {
  const single = returns("single", A);
  const many1 = finds("many", DUNE);
  const got = await createBookLookup({ db: env.DB, sources: [single, many1] }).lookupMany([ISBN, ISBN_DUNE]);
  expect(single.calls).toEqual([]);
  expect([...got.keys()]).toEqual([ISBN_DUNE]);
});

test("lookupMany with the real source asks Open Library once and parses the fixture", async () => {
  const urls: string[] = [];
  const got = await createBookLookup({ db: env.DB, fetch: stubFetch(many, urls) }).lookupMany([ISBN, ISBN_DUNE, ISBN_MISS]);
  expect(urls).toEqual([
    `https://openlibrary.org/api/books?bibkeys=ISBN:${ISBN},ISBN:${ISBN_DUNE},ISBN:${ISBN_MISS}&format=json&jscmd=data`,
  ]);
  expect([...got.keys()].sort()).toEqual([ISBN, ISBN_DUNE].sort());
});

const manyFailures: [string, () => Promise<Map<string, BookInfo>>][] = [
  ["a rejected fetch", async () => { throw new TypeError("network down"); }],
  ["a 500", async () => { throw new Error("open library answered 500"); }],
  ["a body that is not JSON", async () => { throw new SyntaxError("Unexpected token"); }],
  ["a request that never answers", () => new Promise<never>(() => {})],
];

test.each(manyFailures.map(([name]) => name))("%s is LookupUnavailable, not an empty map", async (name) => {
  const bad = manySource("bad", manyFailures.find(([n]) => n === name)![1]);
  await expect(createBookLookup({ db: env.DB, sources: [bad], batchTimeoutMs: 20 }).lookupMany([ISBN])).rejects.toBeInstanceOf(LookupUnavailable);
  expect(bad.calls).toHaveLength(1);
});

test("a source that errors does not stop the next source", async () => {
  const bad = manySource("bad", async () => { throw new Error("boom"); });
  const b = finds("b", A);
  expect((await createBookLookup({ db: env.DB, sources: [bad, b] }).lookupMany([ISBN])).get(ISBN)).toEqual(A);
});

test("a source answering the wrong shape contributes nothing, and counts as a failure", async () => {
  const bad = manySource("bad", async () => ({ nonsense: true }) as never);
  const bad2 = manySource("bad2", async () => new Map([[ISBN, { title: 5 } as never]]));
  await expect(createBookLookup({ db: env.DB, sources: [bad, bad2] }).lookupMany([ISBN])).rejects.toBeInstanceOf(LookupUnavailable);
  expect(await rows()).toEqual([]);
});

test("a failure after some books were found caches them, then throws; a genuine miss alone does not throw", async () => {
  const ok = manySource("ok", async () => new Map([[ISBN, A]]));
  const bad = manySource("bad", async () => { throw new Error("boom"); });
  await expect(createBookLookup({ db: env.DB, sources: [ok, bad] }).lookupMany([ISBN, ISBN_DUNE])).rejects.toBeInstanceOf(LookupUnavailable);
  expect((await rows()).map((r) => r.isbn)).toEqual([ISBN]);
  const missOnly = manySource("miss", async () => new Map());
  expect((await createBookLookup({ db: env.DB, sources: [missOnly] }).lookupMany([ISBN_DUNE])).size).toBe(0);
});

test("a batch that never answers is aborted: its signal fires", async () => {
  const never = manySource("never", () => new Promise<never>(() => {}));
  await createBookLookup({ db: env.DB, sources: [never], batchTimeoutMs: 20 }).lookupMany([ISBN]).catch(() => undefined);
  expect(never.signals[0].aborted).toBe(true);
});

test("the batch time limit is batchTimeoutMs, not timeoutMs", async () => {
  const slow = manySource("slow", async () => { await new Promise((r) => setTimeout(r, 60)); return new Map([[ISBN, A]]); });
  const got = await createBookLookup({ db: env.DB, sources: [slow], timeoutMs: 20, batchTimeoutMs: 500 }).lookupMany([ISBN]);
  expect(got.get(ISBN)).toEqual(A);
});

test("lookupMany of 21 ISBNs throws RangeError; 20 is fine", async () => {
  const s = finds("a");
  const lookup = createBookLookup({ db: env.DB, sources: [s] });
  const isbns = Array.from({ length: 21 }, (_, i) => {
    const first12 = `978${String(i).padStart(9, "0")}`;
    const sum = [...first12].reduce((t, d, k) => t + Number(d) * (k % 2 === 0 ? 1 : 3), 0);
    return first12 + String((10 - (sum % 10)) % 10);
  });
  await expect(lookup.lookupMany(isbns)).rejects.toThrow(RangeError);
  expect(s.calls).toEqual([]);
  await expect(lookup.lookupMany(isbns.slice(0, 20))).resolves.toBeInstanceOf(Map);
});

test("the cap counts valid distinct ISBNs, not raw entries", async () => {
  const lookup = createBookLookup({ db: env.DB, sources: [finds("a")] });
  await expect(lookup.lookupMany(Array.from({ length: 30 }, () => ISBN))).resolves.toBeInstanceOf(Map);
});

test("a bad cover from findMany is stored as null", async () => {
  const body = { [BOOK_KEY]: { title: "T", authors: [{ name: "N" }], cover: { medium: "http://evil.example/x.jpg" } } };
  const got = await createBookLookup({ db: env.DB, fetch: stubFetch(body) }).lookupMany([ISBN]);
  expect(got.get(ISBN)?.coverUrl).toBeNull();
  expect((await rows())[0].cover_url).toBeNull();
});

test("a bad cover handed up by a source is cleaned before it is cached", async () => {
  const s = finds("a", { ...A, coverUrl: "http://evil.example/x.jpg" });
  const got = await createBookLookup({ db: env.DB, sources: [s] }).lookupMany([ISBN]);
  expect(got.get(ISBN)?.coverUrl).toBeNull();
  expect((await rows())[0].cover_url).toBeNull();
});

test("a book a source returns under an ISBN it was not asked for is ignored", async () => {
  const s = finds("a", DUNE);
  expect((await createBookLookup({ db: env.DB, sources: [s] }).lookupMany([ISBN])).size).toBe(0);
});

test("a cache that cannot be read or written still gives the found books", async () => {
  const broken = {
    prepare: () => ({ bind: () => ({ all: async () => { throw new Error("db down"); }, first: async () => { throw new Error("db down"); }, run: async () => { throw new Error("db down"); } }) }),
    batch: async () => { throw new Error("db down"); },
  } as unknown as D1Database;
  const got = await createBookLookup({ db: broken, sources: [finds("a", A)] }).lookupMany([ISBN]);
  expect(got.get(ISBN)).toEqual(A);
});

test("lookupMany never uses Google Books", async () => {
  const sources = lookupSources("some-key");
  const google = sources.find((s) => s.name === "google-books")!;
  expect(google.findMany).toBeUndefined();
});

test("the default batch time limit is 20 seconds; a single lookup keeps 4", async () => {
  vi.useFakeTimers();
  try {
    const slow = manySource("slow", () => new Promise<never>(() => {}));
    const pending = createBookLookup({ db: env.DB, sources: [slow] }).lookupMany([ISBN]).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(slow.signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(slow.signals[0].aborted).toBe(true);
    expect(await pending).toBeInstanceOf(LookupUnavailable);
  } finally {
    vi.useRealTimers();
  }
});

test("lookupMany exports its cap", () => expect(MAX_BATCH).toBe(20));

test("lookupMany of something that is not a list is empty, not a throw", async () => {
  const got = await createBookLookup({ db: env.DB, sources: [finds("a")] }).lookupMany(undefined as unknown as string[]);
  expect(got.size).toBe(0);
});

test("the real Open Library source: a real 500 and a non-JSON body are LookupUnavailable", async () => {
  const f500 = (async () => new Response("oops", { status: 500 })) as typeof fetch;
  const text = (async () => new Response("<html>not json</html>", { status: 200 })) as typeof fetch;
  for (const fetch of [f500, text]) {
    await expect(createBookLookup({ db: env.DB, fetch }).lookupMany([ISBN])).rejects.toBeInstanceOf(LookupUnavailable);
  }
  expect(await rows()).toEqual([]);
});

test("the map never holds a null key or value, even when the cache holds a bad row", async () => {
  await env.DB.prepare("insert into book_lookups (isbn, title, authors, cover_url, source, fetched_at) values (?, '', '[]', null, 'x', 1)")
    .bind(ISBN)
    .run();
  const got = await createBookLookup({ db: env.DB, sources: [finds("a")] }).lookupMany([ISBN]);
  for (const [k, v] of got) {
    expect(k).not.toBeNull();
    expect(v).not.toBeNull();
  }
  expect(got.size).toBe(0);
});
