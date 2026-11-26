import { describe, expect, test } from "vitest";
import { classify } from "./classify";

describe("classify", () => {
  test.each([
    ["an ISBN-13", "9780306406157", "ean_13", { kind: "isbn", isbn: "9780306406157" }],
    ["a 979-11 ISBN-13", "9791112345677", "ean_13", { kind: "isbn", isbn: "9791112345677" }],
    ["an EAN that is not an ISBN", "0794972486008", "ean_13", { kind: "not-a-book-barcode" }],
    ["a 978 EAN with a bad check digit", "9780306406158", "ean_13", { kind: "not-a-book-barcode" }],
    ["a UPC-A", "036000291452", "upc_a", { kind: "not-a-book-barcode" }],
    ["a UPC-A that looks like an ISBN-10", "030640615X", "upc_a", { kind: "not-a-book-barcode" }],
    ["a label link in capitals", "HTTPS://BOOKS.EXAMPLE.TEST/B/T2XAK7Q2XZ", "qr_code", { kind: "label", code: "t2xak7q2xz" }],
    ["a QR code holding some other link", "https://example.test/about", "qr_code", { kind: "not-our-label" }],
    ["a QR code holding plain text", "hello", "qr_code", { kind: "not-our-label" }],
    ["an unknown format", "9780306406157", "code_128", null],
  ])("%s", (_name, raw, format, want) => {
    expect(classify(raw, format)).toEqual(want);
  });
});
