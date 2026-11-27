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

it("keeps the icon background on light paper", () => {
  expect(read("public/icons/icon.svg")).toContain(`fill="${lightPaper}"`);
});
