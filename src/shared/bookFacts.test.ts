import { expect, test } from "vitest";
import { cleanBookFacts, safeCoverUrl } from "./bookFacts";

test.each([
  ["https://covers.openlibrary.org/b/id/1-L.jpg", "https://covers.openlibrary.org/b/id/1-L.jpg"],
  ["http://covers.openlibrary.org/b/id/1-L.jpg", null],
  ["https://openlibrary.org/b/id/1-L.jpg", null],
  ["https://covers.openlibrary.org.evil.example/x.jpg", null],
  ["https://evil.example/covers.openlibrary.org", null],
  ["https://user@covers.openlibrary.org.evil.example/", null],
  ["javascript:alert(1)", null],
  ["https:covers.openlibrary.org/b/id/1-M.jpg", "https://covers.openlibrary.org/b/id/1-M.jpg"],
  ["https://covers.openlibrary.org:8443/b/id/1-M.jpg", null],
  ["https://user:pass@covers.openlibrary.org/b/id/1-M.jpg", null],
  ["https://user@covers.openlibrary.org/b/id/1-M.jpg", null],
  ["https://:pw@covers.openlibrary.org/b/id/1-M.jpg", null],
  ["not a url", null],
  ["", null],
  [42, null],
  [null, null],
  [undefined, null],
  [{}, null],
])("safeCoverUrl(%j) is %j", (raw, expected) => {
  expect(safeCoverUrl(raw)).toBe(expected);
});

test("good facts pass through, trimmed", () => {
  expect(cleanBookFacts({ title: "  Dune ", authors: [" Frank Herbert "], coverUrl: "https://covers.openlibrary.org/a.jpg" }))
    .toEqual({ title: "Dune", authors: ["Frank Herbert"], coverUrl: "https://covers.openlibrary.org/a.jpg" });
});

test.each([[null], [undefined], ["x"], [{}], [{ title: 5 }], [{ title: "   " }], [{ authors: ["A"] }]])("%j has no usable title", (raw) => {
  expect(cleanBookFacts(raw)).toBeNull();
});

test("a long title is cut to 300 code points, never mid-pair", () => {
  expect(cleanBookFacts({ title: "x".repeat(5000) })!.title).toHaveLength(300);
  const t = cleanBookFacts({ title: "📚".repeat(301) })!.title;
  expect(Array.from(t)).toHaveLength(300);
  expect(t).toBe("📚".repeat(300));
});

test("authors: non-array is empty, non-strings and empties dropped, cut to 200, at most 10", () => {
  expect(cleanBookFacts({ title: "T" })!.authors).toEqual([]);
  expect(cleanBookFacts({ title: "T", authors: "A" })!.authors).toEqual([]);
  expect(cleanBookFacts({ title: "T", authors: ["A", 5, null, "  ", " B "] })!.authors).toEqual(["A", "B"]);
  expect(Array.from(cleanBookFacts({ title: "T", authors: ["📚".repeat(201)] })!.authors[0])).toHaveLength(200);
  expect(cleanBookFacts({ title: "T", authors: Array.from({ length: 12 }, (_, i) => `a${i}`) })!.authors).toHaveLength(10);
});

test("a bad cover becomes null without rejecting the book", () => {
  expect(cleanBookFacts({ title: "T", coverUrl: "javascript:alert(1)" })).toEqual({ title: "T", authors: [], coverUrl: null });
});

test.each([
  "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&source=gbs_api",
  "http://books.google.com/books/content?id=abc",
  "https://books.google.com.evil.test/books/content?id=abc",
  "https://evilbooks.google.com/books/content?id=abc",
  "https://user@books.google.com/books/content?id=abc",
  "https://:pw@books.google.com/books/content?id=abc",
  "https://books.google.com:8443/books/content?id=abc",
  "https://google.com/books/content?id=abc",
])("%s is refused", (u) => expect(safeCoverUrl(u)).toBeNull());
