import { toIsbn13 } from "../../shared/isbn";
import { cleanBookFacts } from "../../shared/bookFacts";
import type { BookInfo } from "../../shared/types";

export type BookSource = {
  name: string;
  find(isbn: string, fetch: typeof globalThis.fetch, signal: AbortSignal): Promise<BookInfo | null>;
  // Optional: one request for many ISBNs. Resolves with the books it found, keyed by ISBN-13.
  findMany?(isbns: string[], fetch: typeof globalThis.fetch, signal: AbortSignal): Promise<Map<string, BookInfo>>;
};

// Open Library asks API clients to name themselves and say where to reach them.
const USER_AGENT = "NataliesLittleLibrary/1 (+https://github.com/JamesAwesome/natalieslittlelibrary)";

// A miss is `200 {}`; a found book is the value under `ISBN:<isbn>`. A non-200 answer throws; a 200 with an unexpected body is not found.
export const openLibrary: BookSource = {
  name: "openlibrary",
  async find(isbn, fetch, signal) {
    return (await openLibrary.findMany!([isbn], fetch, signal)).get(isbn) ?? null;
  },
  // `bibkeys` takes a comma-separated list; ISBNs with no record are simply absent from the body.
  async findMany(isbns, fetch, signal) {
    const found = new Map<string, BookInfo>();
    if (isbns.length === 0) return found;
    const url = `https://openlibrary.org/api/books?bibkeys=${isbns.map((i) => `ISBN:${i}`).join(",")}&format=json&jscmd=data`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal });
    // Anything but 200 (429, 503, ...) is the source failing, not a book it lacks; the caller must be able to tell.
    if (res.status !== 200) throw new Error(`open library answered ${res.status}`);
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return found;
    for (const isbn of isbns) {
      const entry = (body as Record<string, unknown>)[`ISBN:${isbn}`];
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as { title?: unknown; authors?: unknown; cover?: unknown };
      const authors = Array.isArray(e.authors) ? e.authors.map((a) => (a as { name?: unknown } | null)?.name) : [];
      const cover = typeof e.cover === "object" && e.cover !== null ? (e.cover as { medium?: unknown }).medium : null;
      const facts = cleanBookFacts({ title: e.title, authors, coverUrl: cover });
      if (facts) found.set(isbn, { isbn, ...facts });
    }
    return found;
  },
};

// A miss is `totalItems: 0`. `q=isbn:` can return a different book, so a volume counts only if it lists this ISBN.
// Non-2xx (429 over quota, 403 bad key) throws, which the lookup treats as a failure.
export function googleBooks(apiKey: string): BookSource {
  return {
    name: "google-books",
    async find(isbn, fetch, signal) {
      const params = new URLSearchParams({ q: `isbn:${isbn}`, key: apiKey });
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`, {
        headers: { "User-Agent": USER_AGENT },
        signal,
      });
      if (!res.ok) throw new Error(`google books answered ${res.status}`);
      const body: unknown = await res.json();
      const items = typeof body === "object" && body !== null ? (body as { items?: unknown }).items : null;
      if (!Array.isArray(items)) return null;
      for (const item of items) {
        const info = (item as { volumeInfo?: unknown } | null)?.volumeInfo;
        if (typeof info !== "object" || info === null) continue;
        const v = info as { title?: unknown; authors?: unknown; industryIdentifiers?: unknown; imageLinks?: unknown };
        const ids = Array.isArray(v.industryIdentifiers) ? v.industryIdentifiers : [];
        const matches = ids.some((id) => {
          const raw = (id as { identifier?: unknown } | null)?.identifier;
          return typeof raw === "string" && toIsbn13(raw) === isbn;
        });
        if (!matches) continue;
        const facts = cleanBookFacts({ title: v.title, authors: v.authors, coverUrl: googleCover(v.imageLinks) });
        return facts && { isbn, ...facts };
      }
      return null;
    },
  };
}

// Google sends http thumbnails with a page-curl effect; store https without the curl.
function googleCover(links: unknown): string | null {
  const thumb = typeof links === "object" && links !== null ? (links as { thumbnail?: unknown }).thumbnail : null;
  if (typeof thumb !== "string") return null;
  try {
    const u = new URL(thumb);
    if (u.protocol === "http:") u.protocol = "https:";
    u.searchParams.delete("edge");
    return u.href;
  } catch {
    return null;
  }
}
