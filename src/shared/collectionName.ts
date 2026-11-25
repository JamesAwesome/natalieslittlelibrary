const MAX_NAME = 60;
// Control characters, and the bidi embeddings, overrides and isolates (U+202A–U+202E, U+2066–U+2069).
const REFUSED = /[\p{Cc}‪-‮⁦-⁩]/u;

// The name as stored (trimmed, NFC) and the key names are compared by. The server's answer is the authority.
export function cleanCollectionName(raw: unknown): { name: string; key: string } | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().normalize("NFC");
  const length = Array.from(name).length;
  if (length < 1 || length > MAX_NAME || REFUSED.test(name)) return null;
  return { name, key: name.toLowerCase() };
}
