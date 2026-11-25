import { expect, test } from "vitest";
import { parseCsv } from "./csv";

test.each([
  ["a,b\r\nc,d\r\n", [["a", "b"], ["c", "d"]]],
  ["﻿a,b\n", [["a", "b"]]],
  ['"x, y",z\n', [["x, y", "z"]]],
  ['"he said ""hi""",z\n', [['he said "hi"', "z"]]],
  ['"line1\r\nline2\nline3",z\n', [["line1\r\nline2\nline3", "z"]]],
  ["a,\n", [["a", ""]]],
  ["a,b", [["a", "b"]]],
  ["a,b\rc,d\r", [["a", "b"], ["c", "d"]]],
  ["", []],
  ["a\"b,c\n", [["a\"b", "c"]]], // a quote inside an unquoted field is just a character
  ["a\n  \nb\n", [["a"], ["  "], ["b"]]],
  ["a\n\nb\n", [["a"], [""], ["b"]]],
])("%j parses to %j", (text, expected) => {
  expect(parseCsv(text)).toEqual(expected);
});
