import { cleanBookFacts } from "../../shared/bookFacts";
import type { BookInfo } from "../../shared/types";

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
