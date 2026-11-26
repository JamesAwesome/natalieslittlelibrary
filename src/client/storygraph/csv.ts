// RFC 4180 reader. A leading BOM is dropped; CRLF, LF and CR end a record outside quotes; quoted fields may
// hold commas, doubled quotes and line breaks; a trailing newline adds no record.
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let started = false; // anything seen in the current record, so a final record without a newline still counts
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      started = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      started = true;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      started = false;
    } else {
      field += ch;
      started = true;
    }
  }
  if (started || field !== "") {
    row.push(field);
    records.push(row);
  }
  return records;
}
