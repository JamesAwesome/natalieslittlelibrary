import { cleanBookFacts } from "../../shared/bookFacts";
import { toIsbn13 } from "../../shared/isbn";
import type { BookInfo } from "../../shared/types";
import { openLibrary, type BookSource } from "./sources";

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

export function createBookLookup(deps: BookLookupDeps): BookLookup {
  const { db } = deps;
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sources = deps.sources ?? [openLibrary];

  async function readCache(isbn: string): Promise<BookInfo | null> {
    try {
      const row = await db
        .prepare("select title, authors, cover_url from book_lookups where isbn = ?")
        .bind(isbn)
        .first<{ title: string; authors: string; cover_url: string | null }>();
      if (!row) return null;
      const facts = cleanBookFacts({ title: row.title, authors: JSON.parse(row.authors), coverUrl: row.cover_url });
      return facts && { isbn, ...facts };
    } catch {
      return null;
    }
  }

  async function writeCache(book: BookInfo, source: string): Promise<void> {
    try {
      await db
        .prepare(
          "insert or replace into book_lookups (isbn, title, authors, cover_url, source, fetched_at) values (?, ?, ?, ?, ?, ?)",
        )
        .bind(book.isbn, book.title, JSON.stringify(book.authors), book.coverUrl, source, now())
        .run();
    } catch {
      // A cache that cannot be written costs a repeat request, not the answer.
    }
  }

  // One source, one time limit. Never throws; null means this source has nothing.
  async function ask(source: BookSource, isbn: string): Promise<BookInfo | null> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, timeoutMs);
    });
    try {
      const found = await Promise.race([source.find(isbn, doFetch, controller.signal), timedOut]);
      const facts = cleanBookFacts(found);
      return facts && { isbn, ...facts };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async lookup(raw) {
      const isbn = toIsbn13(raw);
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
