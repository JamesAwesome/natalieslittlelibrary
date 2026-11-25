import { expect, test } from "vitest";
import { toIsbn13 } from "./isbn";

test.each([
  ["9780306406157", "9780306406157"],
  ["978-0-306-40615-7", "9780306406157"],
  [" 9780306406157 ", "9780306406157"],
  ["0306406152", "9780306406157"], // ISBN-10
  ["0-306-40615-2", "9780306406157"],
  ["080442957X", "9780804429573"], // ISBN-10 with X
  ["080442957x", "9780804429573"],
  ["9798855427974", "9798855427974"], // 979 prefix
])("%s is ISBN %s", (raw, want) => expect(toIsbn13(raw)).toBe(want));

test.each([
  "", "abc", "9780306406158", // bad check digit
  "0794972486008", "6780272426008", // valid EAN-13, not a book
  "0306406153", // bad ISBN-10 check digit
  "97803064061577", "978030640615", // wrong length
])("%s is not an ISBN", (raw) => expect(toIsbn13(raw)).toBeNull());
