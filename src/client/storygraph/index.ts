import type { ImportRow } from "../../shared/types";

export { parseExport, type ParseResult } from "./parse";

// A real collection id is at most 36 characters; measuring with that keeps every chunk under the bound.
const ID_PLACEHOLDER = "x".repeat(36);
const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

// Splits rows, in order, into chunks of at most `maxRows` rows whose request body
// (`JSON.stringify({ collectionId, rows })`) is at most `maxBytes` UTF-8 bytes. A single row too big on its own
// still goes in a chunk of its own: nothing is dropped.
export function chunkRows(rows: ImportRow[], maxRows = 20, maxBytes = 12000): ImportRow[][] {
  const base = bytes(JSON.stringify({ collectionId: ID_PLACEHOLDER, rows: [] }));
  const chunks: ImportRow[][] = [];
  let current: ImportRow[] = [];
  let size = base;
  for (const row of rows) {
    const add = bytes(JSON.stringify(row)) + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && (current.length >= maxRows || size + add > maxBytes)) {
      chunks.push(current);
      current = [];
      size = base;
    }
    size += bytes(JSON.stringify(row)) + (current.length > 0 ? 1 : 0);
    current.push(row);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
