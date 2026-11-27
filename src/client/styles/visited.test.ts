import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// jsdom cannot resolve :visited, so this only guards the source: base.css recolours visited links at
// specificity 0,2,1, which beats these rules unless they name :visited themselves.
test.each([
  ["shell.css", /\.tab-bar \.tab:visited/],
  ["more.css", /\.more-list a:visited/],
  ["wall.css", /\.wall a\.wall-link:visited/],
  ["wall.css", /\.wall-menu a\.wall-menu-item:visited/],
  ["book.css", /\.copy-page \.book-row:visited/],
  ["book.css", /\.copy-page \.book-back a:visited/],
])("%s keeps its link colours once visited", (file, selector) => {
  expect(readFileSync(`src/client/styles/${file}`, "utf8")).toMatch(selector);
});
