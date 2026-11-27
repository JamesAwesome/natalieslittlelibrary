import { expect, test } from "vitest";
import { largerCover } from "./covers";

test("an Open Library medium cover becomes the large one, which 404s rather than answering with a blank", () => {
  expect(largerCover("https://covers.openlibrary.org/b/id/12345-M.jpg")).toBe("https://covers.openlibrary.org/b/id/12345-L.jpg?default=false");
  expect(largerCover("https://covers.openlibrary.org/b/isbn/9780141439518-M.jpg")).toBe("https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg?default=false");
});

test("every other URL passes through, Google Books included", () => {
  for (const u of ["https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1", "https://covers.openlibrary.org/b/id/1-S.jpg", "https://example.test/x-M.jpg"]) {
    expect(largerCover(u)).toBe(u);
  }
});
