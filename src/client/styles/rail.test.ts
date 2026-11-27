import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { RAIL_STRIP } from "../wall/model";

// jsdom does no layout, so these pin the declarations the rail's and the Pair disc's geometry depend on. Both were
// measured in a browser (glyph and box rectangles, not eyeballed crops). Change a value pinned here only after
// measuring again.
const strip = (file: string) => readFileSync(`src/client/styles/${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const wall = strip("wall.css");
const shell = strip("shell.css");

// The declarations of the first rule whose selector list is exactly `selector`, at or after `from`.
function decls(css: string, selector: string, from = 0): Record<string, string> {
  const re = new RegExp(`(^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  re.lastIndex = from;
  const m = re.exec(css);
  expect(m, `${selector} in the stylesheet`).not.toBeNull();
  return Object.fromEntries(
    m![2].split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(":");
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    }),
  );
}

test("the rail's max-height gives each of its marks 1.5rem", () => {
  const maxHeight = decls(wall, ".alpha-rail")["max-height"];
  expect(maxHeight).toBe("calc(28 * 1.5rem)");
  expect(Number(/calc\((\d+) \*/.exec(maxHeight)![1])).toBe(RAIL_STRIP.length);
});

test("on a short landscape screen the arrow shrinks and rides up, and every other letter thins to a dot", () => {
  const short = wall.indexOf("@media (max-height: 33rem)");
  expect(short).toBeGreaterThanOrEqual(0);
  expect(decls(wall, ".alpha-rail-mark:first-child", short)).toMatchObject({
    "font-size": "calc(var(--text-xs) * 0.6)",
    transform: "translateY(-5px)",
  });
  expect(decls(wall, ".alpha-rail-mark:nth-child(odd):not(:first-child)", short)["font-size"]).toBe("0");
});

test("the Pair disc is 32px and sits inside the bar on its measured margins", () => {
  expect(decls(shell, ".tab-disc")).toMatchObject({ width: "32px", height: "32px", margin: "-7px 0 -1px" });
});
