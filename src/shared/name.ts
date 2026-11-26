const MAX_NAME = 60;
// Control, format (zero-width, marks, BOM, soft hyphen, tags, bidi controls), line and paragraph separators, lone surrogates.
const REFUSED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;

// The name as stored (trimmed, NFC) and the key names are compared by. The server's answer is the authority.
export function cleanName(raw: unknown): { name: string; key: string } | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().normalize("NFC");
  const length = Array.from(name).length;
  if (length < 1 || length > MAX_NAME || REFUSED.test(name)) return null;
  return { name, key: name.toLowerCase() };
}

export const cleanPersonName = cleanName;
