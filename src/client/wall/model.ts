import type { BookInfo, ShelfItem } from "../../shared/types";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Title without a leading The/A/An; unchanged if that would leave nothing. */
export function sortKey(title: string): string {
  const rest = title.replace(/^(?:the|an|a)\s+/i, "");
  return rest.trim() === "" ? title : rest;
}

/** A–Z for the sort key's first character (accents folded), else "#". Ø, Æ and ß fall under "#" for now. */
export function letterOf(title: string): string {
  const first = sortKey(title.trim()).normalize("NFD").replace(/\p{M}/gu, "").charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : "#";
}

export function groupByLetter<T extends { book: { title: string } }>(items: T[]): { letter: string; items: T[] }[] {
  const byLetter = new Map<string, T[]>();
  for (const it of items) {
    const l = letterOf(it.book.title);
    const bucket = byLetter.get(l);
    if (bucket) bucket.push(it);
    else byLetter.set(l, [it]);
  }
  const tie = (x: T) => (x as { copyId?: string }).copyId ?? "";
  return RAIL_MARKS.filter((l) => byLetter.has(l)).map((letter) => ({
    letter,
    items: byLetter.get(letter)!.sort((a, b) =>
      collator.compare(sortKey(a.book.title.trim()), sortKey(b.book.title.trim())) || (tie(a) < tie(b) ? -1 : tie(a) > tie(b) ? 1 : 0)),
  }));
}

export type Status = "all" | "home" | "out" | "unlabelled";
/** `q` is what's typed in the find box; absent or blank, it matches every book. */
export type WallFilter = { status: Status; collectionId: string | null; q?: string };
export const ALL: WallFilter = { status: "all", collectionId: null };

// Letters NFD leaves whole, spelled as an English keyboard would type them: "nesbo" finds Nesbø.
const PLAIN: Record<string, string> = { ø: "o", ł: "l", æ: "ae", œ: "oe", ß: "ss", đ: "d", ð: "d", þ: "th", ı: "i" };

// Lower case, accents dropped, and apostrophes (straight, curly, modifier) and hyphens gone: iOS types ’ where titles
// often hold ', and "spiderman" or "spider man" should both find Spider-Man.
const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/['‘’ʼ\-‐‑]/g, "").replace(/[øłæœßđðþı]/g, (c) => PLAIN[c]);

/** Every word of the query is found in the title or in one author's name, in any order. */
export function matchesQuery(book: BookInfo, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // Separate fields, so a word never matches across the join between the title and an author.
  const fields = [book.title, ...book.authors].map(fold);
  return words.every((w) => fields.some((f) => f.includes(w)));
}

export function applyFilter(items: ShelfItem[], f: WallFilter): ShelfItem[] {
  return items.filter((i) => {
    if (f.collectionId !== null && i.collection?.id !== f.collectionId) return false;
    if (f.q && !matchesQuery(i.book, f.q)) return false;
    if (f.status === "home") return i.home;
    if (f.status === "out") return !i.home;
    if (f.status === "unlabelled") return !i.labelled;
    return true;
  });
}

export const RAIL_MARKS: readonly string[] = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

// The mark above A: not a letter, it goes back to the top. The strip is what the rail draws; RAIL_MARKS stays the letters.
export const RAIL_TOP = "↑";
export const RAIL_STRIP: readonly string[] = [RAIL_TOP, ...RAIL_MARKS];

export function markAt(offsetY: number, height: number): string {
  if (!(height > 0)) return RAIL_STRIP[0];
  const i = Math.floor((offsetY / height) * RAIL_STRIP.length);
  return RAIL_STRIP[Math.min(RAIL_STRIP.length - 1, Math.max(0, i))];
}

export function targetLetter(mark: string, present: string[]): string | null {
  const order = [...present].sort((a, b) => RAIL_MARKS.indexOf(a) - RAIL_MARKS.indexOf(b));
  const at = RAIL_MARKS.indexOf(mark);
  return order.find((l) => RAIL_MARKS.indexOf(l) >= at) ?? order[order.length - 1] ?? null;
}

export const showRail = (itemCount: number, groupCount: number): boolean => itemCount > 24 && groupCount >= 2;

export function countLine(items: ShelfItem[], owner: boolean): string {
  const base = items.length === 1 ? "1 book" : `${items.length} books`;
  const out = items.filter((i) => !i.home).length;
  return owner && out > 0 ? `${base} · ${out} lent out` : base;
}
