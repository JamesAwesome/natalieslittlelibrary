import { toIsbn13 } from "../../shared/isbn";
import { parseLabelLink } from "../../shared/labelCode";

export type Reading = { kind: "isbn"; isbn: string } | { kind: "label"; code: string };

export function classify(raw: string, format: string): Reading | { kind: "not-a-book-barcode" } | null {
  if (format === "ean_13") {
    const isbn = toIsbn13(raw);
    return isbn ? { kind: "isbn", isbn } : { kind: "not-a-book-barcode" };
  }
  if (format === "upc_a") return { kind: "not-a-book-barcode" };
  if (format === "qr_code") {
    const code = parseLabelLink(raw);
    return code ? { kind: "label", code } : null;
  }
  return null;
}
