export const LABEL_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const LABEL_LENGTH = 10;

const CODE = new RegExp(`^[${LABEL_ALPHABET}]{${LABEL_LENGTH}}$`);

export function isLabelCode(s: string): boolean {
  return CODE.test(s);
}

// Accepts a bare code or any link whose path is /b/<code>, on any host. Returns the lowercase code.
export function parseLabelLink(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (isLabelCode(s)) return s;
  let path: string;
  try {
    path = new URL(s, "https://placeholder.invalid").pathname;
  } catch {
    return null;
  }
  const m = /^\/b\/([^/]+)\/?$/.exec(path);
  return m && isLabelCode(m[1]) ? m[1] : null;
}
