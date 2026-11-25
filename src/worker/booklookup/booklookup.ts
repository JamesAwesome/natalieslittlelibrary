import { cleanBookFacts } from "../../shared/bookFacts";
import { toIsbn13 } from "../../shared/isbn";
import type { BookInfo } from "../../shared/types";
import { googleBooks, openLibrary, type BookSource } from "./sources";

export type BookLookupDeps = {
  db: D1Database;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  sources?: BookSource[];
};

export interface BookLookup {
  lookup(isbn: string): Promise<BookInfo | null>;
}

const DEFAULT_TIMEOUT_MS = 4000;

// Open Library first; Google Books after it only when a key is set.
export function lookupSources(apiKey: unknown): BookSource[] {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  return key === "" ? [openLibrary] : [openLibrary, googleBooks(key)];
}

export function createBookLookup(deps: BookLookupDeps): BookLookup {
  const { db } = deps;
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
          .first<{ title: string; authors: string; cover_url: string | null }>();
        if (!row) return null;
        let authors: unknown = [];
        try {
          authors = JSON.parse(row.authors);
        } catch {
          // Unreadable authors count as none; the rest of the row is still cleaned below.
        }
        const facts = cleanBookFacts({ title: row.title, authors, coverUrl: row.cover_url });
        return facts && { isbn, ...facts };
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
  async function withLimit<T>(work: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);
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
    const facts = cleanBookFacts(await withLimit((signal) => source.find(isbn, doFetch, signal)));
    return facts && { isbn, ...facts };
  }

  return {
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
