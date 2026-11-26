import { cleanBookFacts } from "../../shared/bookFacts";
import { toIsbn13 } from "../../shared/isbn";
import type { ImportRow } from "../../shared/types";
import { parseCsv } from "./csv";

// StoryGraph's column names, in one place. If an export's header differs, this is the only thing to correct.
export const COLUMNS = { title: "Title", authors: "Authors", isbn: "ISBN/UID", format: "Format", owned: "Owned?" } as const;
// What the Owned? column holds for a book she owns (compared trimmed, case-insensitive).
export const OWNED_VALUE = "yes";

export type ParseResult =
  | { ok: true; rows: ImportRow[]; skipped: { notOwned: number; notPhysical: number; noTitle: number } }
  | { ok: false; missing: string[] };

const norm = (s: string) => s.trim().toLowerCase();

export function parseExport(text: string): ParseResult {
  const records = parseCsv(text);
  const header = (records[0] ?? []).map(norm);
  const at = {} as Record<keyof typeof COLUMNS, number>;
  const missing: string[] = [];
  for (const key of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
    const i = header.indexOf(norm(COLUMNS[key]));
    at[key] = i;
    if (i === -1) missing.push(COLUMNS[key]);
  }
  if (missing.length > 0) return { ok: false, missing };

  const rows: ImportRow[] = [];
  const skipped = { notOwned: 0, notPhysical: 0, noTitle: 0 };
  for (const rec of records.slice(1)) {
    if (rec.every((c) => c.trim() === "")) continue;
    const cell = (k: keyof typeof COLUMNS) => rec[at[k]] ?? "";
    if (norm(cell("owned")) !== OWNED_VALUE) {
      skipped.notOwned++;
      continue;
    }
    const format = norm(cell("format"));
    if (format !== "" && !format.includes("hardcover") && !format.includes("paperback")) {
      skipped.notPhysical++;
      continue;
    }
    const facts = cleanBookFacts({ title: cell("title"), authors: cell("authors").split(",") });
    if (facts === null) {
      skipped.noTitle++;
      continue;
    }
    // Built from three named fields only: nothing else in the record can reach a request.
    rows.push({ title: facts.title, authors: facts.authors, isbn: toIsbn13(cell("isbn")) });
  }
  return { ok: true, rows, skipped };
}
