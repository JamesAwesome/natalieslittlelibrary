// Returns the 13-digit ISBN for an ISBN-10 or ISBN-13 in any common spelling, or null if it is not a valid book number.
export function toIsbn13(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (/^97[89]\d{10}$/.test(s)) return checkDigit13(s.slice(0, 12)) === s[12] ? s : null;
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (10 - i) * (s[i] === "X" ? 10 : Number(s[i]));
    if (sum % 11 !== 0) return null;
    const body = `978${s.slice(0, 9)}`;
    return body + checkDigit13(body);
  }
  return null;
}

function checkDigit13(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}
