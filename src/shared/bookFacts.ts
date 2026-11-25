const MAX_TITLE = 300;
const MAX_AUTHORS = 10;
const MAX_AUTHOR = 200;
const COVER_HOST = "covers.openlibrary.org";

// Cuts by code point so a cut never splits a surrogate pair.
function cut(s: string, max: number): string {
  const points = Array.from(s);
  return points.length <= max ? s : points.slice(0, max).join("");
}

// A cover address is kept only if it is https on covers.openlibrary.org.
export function safeCoverUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    const ok = u.protocol === "https:" && u.hostname === COVER_HOST && !u.username && !u.password && !u.port;
    // The parsed form, so `https:host/x` (no slashes) is stored as the absolute address a browser would not misread.
    return ok ? u.href : null;
  } catch {
    return null;
  }
}

// Turns whatever a lookup returned into book facts the database may hold, or null when there is no usable title.
export function cleanBookFacts(raw: unknown): { title: string; authors: string[]; coverUrl: string | null } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== "string") return null;
  const title = cut(r.title.trim(), MAX_TITLE);
  if (title === "") return null;
  const authors = Array.isArray(r.authors)
    ? r.authors
        .filter((a): a is string => typeof a === "string")
        .map((a) => cut(a.trim(), MAX_AUTHOR))
        .filter((a) => a !== "")
        .slice(0, MAX_AUTHORS)
    : [];
  return { title, authors, coverUrl: safeCoverUrl(r.coverUrl) };
}
