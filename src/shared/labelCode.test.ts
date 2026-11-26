import { expect, test } from "vitest";
import { LABEL_ALPHABET, parseLabelLink } from "./labelCode";

const code = "t7k2q9xzmb";
test.each([
  code, "T7K2Q9XZMB", ` ${code} `,
  `https://books.waffle.haus/b/${code}`, `HTTPS://BOOKS.WAFFLE.HAUS/B/T7K2Q9XZMB`,
  `https://old.example/b/${code}`, `https://books.waffle.haus/b/${code}?x=1#y`, `/b/${code}`,
  `https://books.waffle.haus/b/${code}/`, `/b/${code}/?x=1`,
])("%s is label t7k2q9xzmb", (raw) => expect(parseLabelLink(raw)).toBe(code));

test.each([
  "", "t7k2q9xzm", "t7k2q9xzmbb", // wrong length
  "t7k2q9xzm0", "t7k2q9xzml", "t7k2q9xzmo", // characters not in the alphabet
  `https://books.waffle.haus/c/${code}`, `https://books.waffle.haus/b/${code}/extra`,
  `https://books.waffle.haus/b/${code}//`, `https://books.waffle.haus/b/${code}/x`,
  "9780306406157", "javascript:alert(1)",
])("%s is not a label", (raw) => expect(parseLabelLink(raw)).toBeNull());

test("the alphabet has no lookalikes", () => {
  expect(LABEL_ALPHABET).toHaveLength(31);
  expect(LABEL_ALPHABET).not.toMatch(/[01ilo]/);
});
