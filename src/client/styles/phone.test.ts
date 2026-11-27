import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { toHex } from "./oklch";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const css = read("src/client/styles/tokens.css");
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const paper = (block: string) => /--color-paper:\s*(oklch\([^)]*\))/.exec(block)![1];
const lightPaper = toHex(paper(css.slice(0, darkStart)));
const darkPaper = toHex(paper(css.slice(darkStart)));

it("keeps the manifest colours on light paper", () => {
  const m = JSON.parse(read("public/manifest.webmanifest"));
  expect(m.background_color).toBe(lightPaper);
  expect(m.theme_color).toBe(lightPaper);
  expect(m.display).toBe("browser");
});

it("keeps the theme-color metas on each setting's paper", () => {
  const html = read("index.html");
  const meta = (scheme: string) =>
    new RegExp(`<meta name="theme-color" media="\\(prefers-color-scheme: ${scheme}\\)" content="([^"]+)"`).exec(html)?.[1];
  expect(meta("light")).toBe(lightPaper);
  expect(meta("dark")).toBe(darkPaper);
});

it("keeps the icon background on light paper and the spines on light rust", () => {
  const svg = read("public/icons/icon.svg");
  const lightAccent = toHex(/--color-accent:\s*(oklch\([^)]*\))/.exec(css.slice(0, darkStart))![1]);
  const bg = /<rect width="512" height="512" fill="([^"]+)"/.exec(svg)?.[1];
  const spine = /<g fill="([^"]+)">\s*<rect x="98" y="170"/.exec(svg)?.[1];
  expect(bg).toBe(lightPaper);
  expect(spine).toBe(lightAccent);
});

it("pins the manifest names and icon files and sizes", () => {
  const m = JSON.parse(read("public/manifest.webmanifest"));
  expect(m.name).toBe("Natalie\u2019s Little Library");
  expect(m.short_name).toBe("Little Library");
  for (const icon of m.icons) {
    const png = readFileSync(resolve(process.cwd(), "public", icon.src.replace(/^\//, "")));
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }
  const touch = readFileSync(resolve(process.cwd(), "public/icons/apple-touch-icon.png"));
  expect([touch.readUInt32BE(16), touch.readUInt32BE(20)]).toEqual([180, 180]);
});

it("sets a short iOS home-screen title and does not request standalone mode", () => {
  const html = read("index.html");
  expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Little Library" />');
  expect(html).not.toContain("apple-mobile-web-app-capable");
});
