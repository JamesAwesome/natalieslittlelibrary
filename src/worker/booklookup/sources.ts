import { toIsbn13 } from "../../shared/isbn";
import { cleanBookFacts } from "../../shared/bookFacts";
import type { BookInfo, Suggestion } from "../../shared/types";

export type BookSource = {
  name: string;
  find(isbn: string, fetch: typeof globalThis.fetch, signal: AbortSignal): Promise<BookInfo | null>;
};

// Open Library asks API clients to name themselves and say where to reach them.
const USER_AGENT = "NataliesLittleLibrary/1 (+https://github.com/JamesAwesome/natalieslittlelibrary)";

// A miss is `200 {}`; a found book is the value under `ISBN:<isbn>`. Anything unexpected is not found.
export const openLibrary: BookSource = {
  name: "openlibrary",
  async find(isbn, fetch, signal) {
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal });
    if (res.status !== 200) return null;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return null;
    const entry = (body as Record<string, unknown>)[`ISBN:${isbn}`];
    if (typeof entry !== "object" || entry === null) return null;
    const e = entry as { title?: unknown; authors?: unknown; cover?: unknown };
    const authors = Array.isArray(e.authors) ? e.authors.map((a) => (a as { name?: unknown } | null)?.name) : [];
    const cover = typeof e.cover === "object" && e.cover !== null ? (e.cover as { medium?: unknown }).medium : null;
    const facts = cleanBookFacts({ title: e.title, authors, coverUrl: cover });
    return facts && { isbn, ...facts };
  },
};

export type SuggestSource = {
  name: string;
  find(isbn: string, fetch: typeof globalThis.fetch, signal: AbortSignal): Promise<Suggestion | null>;
};

// The suggestion source exists only when a key is set.
export function suggestSourceFor(apiKey: unknown): SuggestSource | null {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  return key === "" ? null : googleBooks(key);
}

// A miss is `totalItems: 0`. `q=isbn:` can return a different book, so a volume counts only if it lists this ISBN.
// Non-2xx (429 over quota, 403 bad key) throws, which the caller treats as no suggestion.
// Nothing here is a cover: Google's content is shown once, with a link back, and never stored.
export function googleBooks(apiKey: string): SuggestSource {
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
        const v = info as { title?: unknown; authors?: unknown; industryIdentifiers?: unknown };
        const ids = Array.isArray(v.industryIdentifiers) ? v.industryIdentifiers : [];
        const matches = ids.some((id) => {
          const raw = (id as { identifier?: unknown } | null)?.identifier;
          return typeof raw === "string" && toIsbn13(raw) === isbn;
        });
        if (!matches) continue;
        const facts = cleanBookFacts({ title: v.title, authors: v.authors, coverUrl: null });
        const link = googleLink((item as { id?: unknown }).id);
        return facts && link ? { title: facts.title, authors: facts.authors, link } : null;
      }
      return null;
    },
  };
}

// Built from the volume id alone, so it is always https on books.google.com and cannot carry the key or anything else.
// Google's own links are not used: canonicalVolumeLink can be on play.google.com and infoLink is http.
function googleLink(id: unknown): string | null {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? `https://books.google.com/books?id=${id}` : null;
}
