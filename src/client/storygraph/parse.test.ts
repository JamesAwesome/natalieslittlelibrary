import { expect, test } from "vitest";
import type { ImportRow } from "../../shared/types";
import { DATE_READ, FIXTURE, FIXTURE_LINES, RATING, REVIEW_SENTINEL } from "./fixture";
import { chunkRows, parseExport } from "./index";
import { COLUMNS } from "./parse";

function rowsOf(text: string): ImportRow[] {
  const r = parseExport(text);
  if (!r.ok) throw new Error(`missing ${r.missing.join()}`);
  return r.rows;
}

test("the fixture keeps owned physical and formatless rows, and counts the rest", () => {
  const r = parseExport(FIXTURE);
  expect(r).toEqual({
    ok: true,
    rows: [
      { title: "Hardcover Book", authors: ["Ann Author", "Bo Writer"], isbn: "9780306406157" },
      { title: "Paperback Book", authors: ["Cy Penn"], isbn: "9780306406157" },
      { title: "Formatless Book", authors: ["Fo Rmat"], isbn: null },
      { title: "UID Book", authors: ["Ui Dee"], isbn: null },
      { title: 'A Title, with a comma and "quotes"', authors: ["Quo Ted"], isbn: null },
      { title: "Reviewed Book", authors: ["Re View"], isbn: null },
    ],
    skipped: { notOwned: 1, notPhysical: 2, noTitle: 1 },
  });
});

test("a kept row has exactly title, authors, and isbn", () => {
  for (const row of rowsOf(FIXTURE)) expect(Object.keys(row).sort()).toEqual(["authors", "isbn", "title"]);
});

test("nothing from a review, rating, or date survives", () => {
  const out = JSON.stringify(parseExport(FIXTURE));
  for (const s of [REVIEW_SENTINEL, RATING, DATE_READ, "Translator", "hardcover", "second line"]) expect(out).not.toContain(s);
});

test("an ISBN-10 becomes ISBN-13; a UID that isn't an ISBN becomes null", () => {
  const rows = rowsOf(FIXTURE);
  expect(rows.find((r) => r.title === "Paperback Book")?.isbn).toBe("9780306406157");
  expect(rows.find((r) => r.title === "UID Book")?.isbn).toBeNull();
});

test("columns are found by name in any order and case", () => {
  const text = "owned?, FORMAT ,authors,title,isbn/uid\nyes,Paperback,A B,Some Book,0306406152\n";
  expect(rowsOf(text)).toEqual([{ title: "Some Book", authors: ["A B"], isbn: "9780306406157" }]);
});

test("a file without the StoryGraph columns names what is missing", () => {
  expect(parseExport("Name,Age\nx,1\n")).toEqual({ ok: false, missing: Object.values(COLUMNS) });
  expect(parseExport("")).toMatchObject({ ok: false });
  const some = FIXTURE_LINES[0].replace("Owned?", "Mine").replace("Format", "Kind");
  expect(parseExport(some + "\r\n")).toEqual({ ok: false, missing: ["Format", "Owned?"] });
});

test("chunks hold at most 20 rows and 12000 UTF-8 bytes of JSON each, in order, with nothing lost", () => {
  const rows: ImportRow[] = Array.from({ length: 250 }, (_, i) => ({
    title: i % 2 === 0 ? "本".repeat(300) : `Book ${i}`,
    authors: i % 2 === 0 ? ["著".repeat(100)] : ["An Author"],
    isbn: i % 2 === 0 ? "9780306406157" : null,
  }));
  const chunks = chunkRows(rows);
  expect(chunks.flat()).toEqual(rows);
  for (const c of chunks) {
    expect(c.length).toBeGreaterThan(0);
    expect(c.length).toBeLessThanOrEqual(20);
    const body = JSON.stringify({ collectionId: "a".repeat(36), rows: c });
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(12000);
  }
  expect(chunks.length).toBeGreaterThan(Math.ceil(250 / 20));
});

test("a row too big for any chunk still travels alone, and no rows means no chunks", () => {
  const big: ImportRow = { title: "x".repeat(200), authors: [], isbn: null };
  expect(chunkRows([big, big], 20, 100)).toEqual([[big], [big]]);
  expect(chunkRows([])).toEqual([]);
});

test("a line holding only whitespace is not a book and is not counted", () => {
  const head = FIXTURE_LINES[0];
  const r = parseExport(`${head}\r\n   \r\n,,,,,,,,,\r\n`);
  expect(r).toEqual({ ok: true, rows: [], skipped: { notOwned: 0, notPhysical: 0, noTitle: 0 } });
});

test("the byte bound holds at exactly maxBytes and gives way at one byte less", () => {
  const row: ImportRow = { title: "Dune", authors: ["Frank Herbert"], isbn: null };
  const exact = new TextEncoder().encode(JSON.stringify({ collectionId: "x".repeat(36), rows: [row, row] })).length;
  expect(chunkRows([row, row], 20, exact)).toEqual([[row, row]]);
  expect(chunkRows([row, row], 20, exact - 1)).toEqual([[row], [row]]);
  const three = [row, row, row];
  const body3 = new TextEncoder().encode(JSON.stringify({ collectionId: "x".repeat(36), rows: three })).length;
  expect(chunkRows(three, 20, body3)).toEqual([three]);
  expect(chunkRows(three, 20, body3 - 1).length).toBe(2);
});
