import { afterEach, describe, expect, test, vi } from "vitest";
import { item, ann } from "../screens/shelfFixtures";
import { ALL, RAIL_MARKS, applyFilter, countLine, groupByLetter, letterOf, markAt, showRail, sortKey, targetLetter } from "./model";

const titled = (copyId: string, title: string) => item({ copyId, book: { isbn: null, title, authors: [], coverUrl: null } });

describe("sortKey and letterOf", () => {
  test("drops a leading article but never leaves an empty key", () => {
    expect(sortKey("The Call of the Wild")).toBe("Call of the Wild");
    expect(sortKey("an apple")).toBe("apple");
    expect(sortKey("A  Tale")).toBe("Tale");
    expect(sortKey("The")).toBe("The");
    expect(sortKey("Theory")).toBe("Theory");
  });
  test("awkward titles", () => {
    expect(letterOf("Émile")).toBe("E");
    expect(letterOf("'Salem's Lot")).toBe("#");
    expect(letterOf("1984")).toBe("#");
    expect(letterOf("¿Quién?")).toBe("#");
    expect(letterOf("an apple")).toBe("A");
    expect(letterOf("  The Hobbit")).toBe("H");
    expect(letterOf("")).toBe("#");
  });
});

describe("groupByLetter", () => {
  test("A to Z, then # last, empty groups omitted", () => {
    const g = groupByLetter([titled("1", "1984"), titled("2", "Zebra"), titled("3", "The Apple"), titled("4", "'Salem's Lot")]);
    expect(g.map((x) => x.letter)).toEqual(["A", "Z", "#"]);
  });
  test("numeric order within a group, ties by copyId", () => {
    const g = groupByLetter([titled("b", "Book 10"), titled("c", "Book 2"), titled("z", "Same"), titled("a", "Same")]);
    expect(g[0].items.map((i) => i.copyId)).toEqual(["c", "b"]);
    expect(g[1].items.map((i) => i.copyId)).toEqual(["a", "z"]);
  });
  test("the collator locale is pinned to en", async () => {
    const real = Intl.Collator;
    const seen: unknown[] = [];
    vi.spyOn(Intl, "Collator").mockImplementation(function (locale?: string | string[], opts?: Intl.CollatorOptions) {
      seen.push(locale);
      return new real(locale, opts);
    } as unknown as typeof Intl.Collator);
    vi.resetModules();
    await import("./model");
    expect(seen).toEqual(["en"]);
  });
  test("sorts by the article-free key, so The Call of the Wild precedes Cello", () => {
    const g = groupByLetter([titled("1", "Cello"), titled("2", "The Call of the Wild")]);
    expect(g[0].items.map((i) => i.copyId)).toEqual(["2", "1"]);
  });
  test("leading whitespace is ignored when sorting", () => {
    const g = groupByLetter([titled("1", "Ham"), titled("2", "  The Hobbit")]);
    expect(g[0].items.map((i) => i.copyId)).toEqual(["1", "2"]);
  });
  test("case does not split ties; copyId decides", () => {
    const g = groupByLetter([titled("b", "dune"), titled("a", "Dune")]);
    expect(g[0].items.map((i) => i.copyId)).toEqual(["a", "b"]);
  });
});

afterEach(() => vi.restoreAllMocks());

describe("applyFilter", () => {
  const items = [
    item({ copyId: "1" }),
    item({ copyId: "2", home: false, holder: { kind: "member", person: ann } }),
    item({ copyId: "3", labelled: false, collection: { id: "k2", name: "Other" } }),
    item({ copyId: "4", home: false, collection: { id: "k2", name: "Other" } }),
    item({ copyId: "5", collection: null }),
  ];
  const ids = (f: Parameters<typeof applyFilter>[1]) => applyFilter(items, f).map((i) => i.copyId);
  test("statuses", () => {
    expect(ids(ALL)).toEqual(["1", "2", "3", "4", "5"]);
    expect(ids({ status: "home", collectionId: null })).toEqual(["1", "3", "5"]);
    expect(ids({ status: "out", collectionId: null })).toEqual(["2", "4"]);
    expect(ids({ status: "unlabelled", collectionId: null })).toEqual(["3"]);
  });
  test("collection, alone and with out; null collection never matches", () => {
    expect(ids({ status: "all", collectionId: "k2" })).toEqual(["3", "4"]);
    expect(ids({ status: "out", collectionId: "k2" })).toEqual(["4"]);
    expect(ids({ status: "all", collectionId: "nope" })).toEqual([]);
    expect(ids({ status: "home", collectionId: "k2" })).toEqual(["3"]);
  });
});

describe("rail", () => {
  test("marks", () => {
    expect(RAIL_MARKS).toHaveLength(27);
    expect(RAIL_MARKS[0]).toBe("A");
    expect(RAIL_MARKS[25]).toBe("Z");
    expect(RAIL_MARKS[26]).toBe("#");
  });
  test("markAt clamps", () => {
    expect(markAt(0, 270)).toBe("A");
    expect(markAt(269, 270)).toBe("#");
    expect(markAt(-5, 270)).toBe("A");
    expect(markAt(999, 270)).toBe("#");
    expect(markAt(9.9, 270)).toBe("A");
    expect(markAt(10, 270)).toBe("B");
    expect(markAt(15, 270)).toBe("B");
    expect(markAt(0, 0)).toBe("A");
  });
  test("targetLetter", () => {
    expect(targetLetter("C", ["A", "D"])).toBe("D");
    expect(targetLetter("D", ["A", "D"])).toBe("D");
    expect(targetLetter("Z", ["A", "D"])).toBe("D");
    expect(targetLetter("A", [])).toBeNull();
    expect(targetLetter("A", ["A", "D"])).toBe("A");
    expect(targetLetter("B", ["D", "C"])).toBe("C");
  });
  test("showRail", () => {
    expect(showRail(25, 2)).toBe(true);
    expect(showRail(24, 5)).toBe(false);
    expect(showRail(25, 1)).toBe(false);
  });
});

describe("countLine", () => {
  test("pluralises and counts lent out for the owner only", () => {
    expect(countLine([item({ copyId: "1" })], true)).toBe("1 book");
    const many = Array.from({ length: 248 }, (_, i) => item({ copyId: String(i), home: i >= 3 }));
    expect(countLine(many, true)).toBe("248 books · 3 lent out");
    expect(countLine(many, false)).toBe("248 books");
    expect(countLine(many.slice(3, 8), true)).toBe("5 books");
  });
});
