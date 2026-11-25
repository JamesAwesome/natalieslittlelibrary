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
  ["ISBN 978-0-306-40615-7", "9780306406157"], // pasted prefix
  ["ISBN 0306406152", "9780306406157"], // a bare "ISBN" label before a ten-digit number
  ["ISBN-10 0306406152", "9780306406157"], // an explicit "-10" label
  ["9791012345678", "9791012345678"], // 979-10 France
  ["9791112345677", "9791112345677"], // 979-11 Korea
  ["9791212345676", "9791212345676"], // 979-12 Italy
  ["9791312345675", "9791312345675"], // 979-13 Spain
  ["9798123456781", "9798123456781"], // 979-8 US
  ["isbn: 0306406152", "9780306406157"],
  ["ISBN-10: 0-306-40615-2", "9780306406157"],
  ["ISBN-13: 9780306406157", "9780306406157"],
  ["978\u20130\u2013306\u201340615\u20137", "9780306406157"], // en dashes
  ["978\u20140\u2014306\u201440615\u20147", "9780306406157"], // em dashes
])("%s is ISBN %s", (raw, want) => expect(toIsbn13(raw)).toBe(want));

test("an ISBN-10 that starts with 13 keeps its digits after an ISBN prefix", () => {
  expect(toIsbn13("1306406153")).not.toBeNull();
  expect(toIsbn13("ISBN 1306406153")).toBe(toIsbn13("1306406153"));
});

test.each([
  "", "abc", "9780306406158", // bad check digit
  "0794972486008", "6780272426008", // valid EAN-13, not a book
  "0306406153", // bad ISBN-10 check digit
  "9790060115615", // 979-0 is a music number (ISMN), not a book
  "979-0-060-11561-5",
  "9790123456785", // 979-0 with a valid check digit
  "97803064061577", "978030640615", // wrong length
])("%s is not an ISBN", (raw) => expect(toIsbn13(raw)).toBeNull());
