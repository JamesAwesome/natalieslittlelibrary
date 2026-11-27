import type { ShelfItem } from "../../shared/types";

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
    byLetter.set(l, [...(byLetter.get(l) ?? []), it]);
  }
  const tie = (x: T) => (x as { copyId?: string }).copyId ?? "";
  return RAIL_MARKS.filter((l) => byLetter.has(l)).map((letter) => ({
    letter,
    items: byLetter.get(letter)!.sort((a, b) =>
      collator.compare(sortKey(a.book.title), sortKey(b.book.title)) || (tie(a) < tie(b) ? -1 : tie(a) > tie(b) ? 1 : 0)),
  }));
}

export type Status = "all" | "home" | "out" | "unlabelled";
export type WallFilter = { status: Status; collectionId: string | null };
export const ALL: WallFilter = { status: "all", collectionId: null };

export function applyFilter(items: ShelfItem[], f: WallFilter): ShelfItem[] {
  return items.filter((i) => {
    if (f.collectionId !== null && i.collection?.id !== f.collectionId) return false;
    if (f.status === "home") return i.home;
    if (f.status === "out") return !i.home;
    if (f.status === "unlabelled") return !i.labelled;
    return true;
  });
}

export const RAIL_MARKS: readonly string[] = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

export function markAt(offsetY: number, height: number): string {
  const i = Math.floor((offsetY / height) * RAIL_MARKS.length);
  return RAIL_MARKS[Math.min(RAIL_MARKS.length - 1, Math.max(0, i))];
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
