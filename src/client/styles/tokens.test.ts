import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, inGamut } from "./oklch";

const css = readFileSync(resolve(process.cwd(), "src/client/styles/tokens.css"), "utf8");

function props(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const light = props(css.slice(0, darkStart));
const dark = props(css.slice(darkStart));

describe("oklch contrast", () => {
  it("matches the spec's ink on paper", () => {
    const r = contrast("oklch(20% 0.012 60)", "oklch(98% 0.005 75)");
    expect(r).toBeGreaterThan(17.0);
    expect(r).toBeLessThan(17.2);
  });
});

describe.each([
  ["light", light],
  ["dark", dark],
])("%s tokens", (_name, t) => {
  const c = (a: string, b: string) => contrast(t[`--color-${a}`], t[`--color-${b}`]);

  it("defines every colour token", () => {
    for (const n of [
      "paper", "paper-2", "ink", "muted", "accent", "rule", "link", "link-visited",
      "alert-bg", "alert-ink", "tile", "tile-ink", "focus",
    ]) {
      expect(t[`--color-${n}`], n).toMatch(/^oklch\(/);
    }
  });

  it("keeps text at 4.5:1 or better", () => {
    expect(c("ink", "paper")).toBeGreaterThanOrEqual(4.5);
    expect(c("ink", "paper-2")).toBeGreaterThanOrEqual(4.5);
    expect(c("muted", "paper")).toBeGreaterThanOrEqual(4.5);
    expect(c("muted", "paper-2")).toBeGreaterThanOrEqual(4.5);
    expect(c("accent", "paper")).toBeGreaterThanOrEqual(4.5);
    expect(c("link", "paper")).toBeGreaterThanOrEqual(4.5);
    expect(c("link-visited", "paper")).toBeGreaterThanOrEqual(4.5);
    expect(c("alert-ink", "alert-bg")).toBeGreaterThanOrEqual(4.5);
    expect(c("paper", "ink")).toBeGreaterThanOrEqual(4.5);
    expect(c("tile-ink", "tile")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps an avatar initial (paper on an accent disc) at 4.5:1", () => {
    expect(c("paper", "accent")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the other rendered text pairs at 4.5:1", () => {
    expect(c("alert-ink", "paper")).toBeGreaterThanOrEqual(4.5);
    for (const bg of ["alert-bg", "tile"]) {
      expect(c("link", bg), `link on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(c("link-visited", bg), `visited on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(c("muted", bg), `muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("converts every colour inside sRGB without clipping", () => {
    for (const [k, v] of Object.entries(t)) {
      if (k.startsWith("--color-")) expect(inGamut(v), k).toBe(true);
    }
  });

  it("keeps the focus ring at 3:1 on every surface and hairlines visible", () => {
    for (const bg of ["paper", "paper-2", "ink", "alert-bg"]) {
      expect(c("focus", bg), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
    }
    expect(c("rule", "paper")).toBeGreaterThanOrEqual(1.2);
  });
});
