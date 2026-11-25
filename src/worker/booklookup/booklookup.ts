import { cleanBookFacts } from "../../shared/bookFacts";
import { toIsbn13 } from "../../shared/isbn";
import type { BookInfo } from "../../shared/types";
import { googleBooks, openLibrary, type BookSource } from "./sources";

export type BookLookupDeps = {
  db: D1Database;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  // Time limit for one many-ISBN request; a whole chunk in one request needs longer than a single lookup.
  batchTimeoutMs?: number;
  sources?: BookSource[];
};

export interface BookLookup {
  lookup(isbn: string): Promise<BookInfo | null>;
  // Up to MAX_BATCH ISBNs (any spelling); throws RangeError beyond that. Keyed by ISBN-13, misses absent. Never throws otherwise.
  lookupMany(isbns: string[]): Promise<Map<string, BookInfo>>;
}

export const MAX_BATCH = 20;

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_BATCH_TIMEOUT_MS = 8000;

// Open Library first; Google Books after it only when a key is set.
export function lookupSources(apiKey: unknown): BookSource[] {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  return key === "" ? [openLibrary] : [openLibrary, googleBooks(key)];
}

type CacheRow = { title: string; authors: string; cover_url: string | null };

function cachedBook(isbn: string, row: CacheRow): BookInfo | null {
  let authors: unknown = [];
  try {
    authors = JSON.parse(row.authors);
  } catch {
    // Unreadable authors count as none; the rest of the row is still cleaned below.
  }
  const facts = cleanBookFacts({ title: row.title, authors, coverUrl: row.cover_url });
  return facts && { isbn, ...facts };
}

export function createBookLookup(deps: BookLookupDeps): BookLookup {
  const { db } = deps;
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const batchTimeoutMs = deps.batchTimeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS;
  const sources = deps.sources ?? [openLibrary];

  // Bounds any promise by timeoutMs: a timeout settles as `onTimeout`, and the timer never outlives the call.
  async function bounded<T>(work: () => Promise<T>, onTimeout: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(onTimeout), timeoutMs);
    });
    try {
      return await Promise.race([work(), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function readCache(isbn: string): Promise<BookInfo | null> {
    try {
      return await bounded(async () => {
        const row = await db
          .prepare("select title, authors, cover_url from book_lookups where isbn = ?")
          .bind(isbn)
          .first<CacheRow>();
        return row ? cachedBook(isbn, row) : null;
      }, null);
    } catch {
      return null;
    }
  }

  async function writeCache(book: BookInfo, source: string): Promise<void> {
    try {
      await bounded(
        async () =>
          void (await db
            .prepare(
              "insert or replace into book_lookups (isbn, title, authors, cover_url, source, fetched_at) values (?, ?, ?, ?, ?, ?)",
            )
            .bind(book.isbn, book.title, JSON.stringify(book.authors), book.coverUrl, source, now())
            .run()),
        undefined,
      );
    } catch {
      // A cache that cannot be written costs a repeat request, not the answer.
    }
  }

  // One request, one time limit: on timeout the request is aborted and the answer is null. Never throws.
  async function withLimit<T>(ms: number, work: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, ms);
    });
    try {
      return await Promise.race([work(controller.signal), timedOut]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // One source, one time limit. Null means this source has nothing.
  async function ask(source: BookSource, isbn: string): Promise<BookInfo | null> {
    const facts = cleanBookFacts(await withLimit(timeoutMs, (signal) => source.find(isbn, doFetch, signal)));
    return facts && { isbn, ...facts };
  }

  async function readCacheMany(isbns: string[]): Promise<Map<string, BookInfo>> {
    const found = new Map<string, BookInfo>();
    try {
      const rows = await bounded(
        async () =>
          (
            await db
              .prepare(`select isbn, title, authors, cover_url from book_lookups where isbn in (${isbns.map(() => "?").join(",")})`)
              .bind(...isbns)
              .all<CacheRow & { isbn: string }>()
          ).results,
        [] as (CacheRow & { isbn: string })[],
      );
      for (const row of rows) {
        const book = cachedBook(row.isbn, row);
        if (book) found.set(row.isbn, book);
      }
    } catch {
      // An unreadable cache means everything is asked for again.
    }
    return found;
  }

  async function writeCacheMany(entries: { book: BookInfo; source: string }[]): Promise<void> {
    if (entries.length === 0) return;
    try {
      const at = now();
      await bounded(
        async () =>
          void (await db.batch(
            entries.map(({ book, source }) =>
              db
                .prepare(
                  "insert or replace into book_lookups (isbn, title, authors, cover_url, source, fetched_at) values (?, ?, ?, ?, ?, ?)",
                )
                .bind(book.isbn, book.title, JSON.stringify(book.authors), book.coverUrl, source, at),
            ),
          )),
        undefined,
      );
    } catch {
      // A cache that cannot be written costs a repeat request, not the answers.
    }
  }

  return {
    async lookupMany(raw) {
      const wanted = new Set<string>();
      for (const r of raw) {
        const isbn = typeof r === "string" ? toIsbn13(r) : null;
        if (isbn) wanted.add(isbn);
      }
      if (wanted.size > MAX_BATCH) throw new RangeError(`lookupMany takes at most ${MAX_BATCH} ISBNs, got ${wanted.size}`);
      const result = await readCacheMany([...wanted]);
      const fresh: { book: BookInfo; source: string }[] = [];
      for (const source of sources) {
        const missing = [...wanted].filter((i) => !result.has(i));
        if (missing.length === 0) break;
        if (!source.findMany) continue;
        const answer = await withLimit(batchTimeoutMs, (signal) => source.findMany!(missing, doFetch, signal));
        if (!(answer instanceof Map)) continue;
        for (const isbn of missing) {
          const facts = cleanBookFacts(answer.get(isbn));
          if (!facts) continue;
          const book = { isbn, ...facts };
          result.set(isbn, book);
          fresh.push({ book, source: source.name });
        }
      }
      await writeCacheMany(fresh);
      return result;
    },
    async lookup(raw) {
      const isbn = typeof raw === "string" ? toIsbn13(raw) : null;
      if (!isbn) return null;
      const cached = await readCache(isbn);
      if (cached) return cached;
      for (const source of sources) {
        const book = await ask(source, isbn);
        if (book) {
          await writeCache(book, source.name);
          return book;
        }
      }
      return null;
    },
  };
}
