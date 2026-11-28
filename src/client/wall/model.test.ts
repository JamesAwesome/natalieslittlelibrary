import { afterEach, describe, expect, test, vi } from "vitest";
import { item, ann } from "../screens/shelfFixtures";
import { ALL, RAIL_MARKS, RAIL_STRIP, applyFilter, countLine, groupByLetter, letterOf, markAt, matchesQuery, showRail, sortKey, targetLetter } from "./model";

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
  test("a query narrows whatever the chips show", () => {
    const books = [
      item({ copyId: "a", book: { isbn: null, title: "The Hobbit", authors: ["J. R. R. Tolkien"], coverUrl: null } }),
      item({ copyId: "b", home: false, book: { isbn: null, title: "Dune", authors: ["Frank Herbert"], coverUrl: null } }),
    ];
    const q = (status: "all" | "out", query: string) => applyFilter(books, { status, collectionId: null, q: query }).map((i) => i.copyId);
    expect(q("all", "hob")).toEqual(["a"]);
    expect(q("all", "   ")).toEqual(["a", "b"]);
    expect(q("out", "hobbit")).toEqual([]);
    expect(q("out", "herbert")).toEqual(["b"]);
  });
});

describe("matchesQuery", () => {
  const book = (title: string, authors: string[] = []) => ({ isbn: null, title, authors, coverUrl: null });
  test("an empty or blank query matches everything", () => {
    expect(matchesQuery(book("Dune"), "")).toBe(true);
    expect(matchesQuery(book("Dune"), "  ")).toBe(true);
  });
  test("any part of the title or an author, ignoring case and accents", () => {
    expect(matchesQuery(book("The Hobbit"), "HOBB")).toBe(true);
    expect(matchesQuery(book("Émile"), "emile")).toBe(true);
    expect(matchesQuery(book("Emile"), "émile")).toBe(true);
    expect(matchesQuery(book("Dune", ["Frank Herbert"]), "herb")).toBe(true);
    expect(matchesQuery(book("Dune", ["Frank Herbert"]), "tolkien")).toBe(false);
  });
  test("every word must match somewhere, in any order", () => {
    const b = book("The Left Hand of Darkness", ["Ursula K. Le Guin"]);
    expect(matchesQuery(b, "le guin darkness")).toBe(true);
    expect(matchesQuery(b, "darkness  left")).toBe(true);
    expect(matchesQuery(b, "darkness tolkien")).toBe(false);
  });
  test("apostrophes, straight or curly, are ignored on both sides", () => {
    expect(matchesQuery(book("'Salem's Lot"), "salem’s")).toBe(true);
    expect(matchesQuery(book("Salem’s Lot"), "salems lot")).toBe(true);
    expect(matchesQuery(book("Charlotte's Web"), "charlotte's")).toBe(true);
  });
  test("a word may not straddle the title and an author", () => {
    expect(matchesQuery(book("Dune", ["Frank Herbert"]), "dunefrank")).toBe(false);
    expect(matchesQuery(book("Dune", ["Frank Herbert", "Brian Herbert"]), "herbertbrian")).toBe(false);
  });
});

describe("rail", () => {
  test("marks", () => {
    expect(RAIL_MARKS).toHaveLength(27);
    expect(RAIL_MARKS[0]).toBe("A");
    expect(RAIL_MARKS[25]).toBe("Z");
    expect(RAIL_MARKS[26]).toBe("#");
  });
  test("the strip is the up mark then the 27 letters", () => {
    expect(RAIL_STRIP).toHaveLength(28);
    expect(RAIL_STRIP[0]).toBe("↑");
    expect(RAIL_STRIP[1]).toBe("A");
    expect(RAIL_STRIP[27]).toBe("#");
  });
  test("markAt clamps", () => {
    expect(markAt(0, 280)).toBe("↑");
    expect(markAt(9.9, 280)).toBe("↑");
    expect(markAt(10, 280)).toBe("A");
    expect(markAt(20, 280)).toBe("B");
    expect(markAt(279, 280)).toBe("#");
    expect(markAt(-5, 280)).toBe("↑");
    expect(markAt(999, 280)).toBe("#");
    expect(markAt(0, 0)).toBe("↑");
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
