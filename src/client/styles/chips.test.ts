import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// jsdom does no layout, so these pin the declarations the fit depends on. The fit itself was measured in a browser
// at each iPhone portrait width (375 to 440px): with nothing picked, the chips row fits without scrolling. Change a
// value pinned here only after measuring again.
const css = readFileSync("src/client/styles/wall.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// The declarations of the first rule whose selector list is exactly `selector`, at or after `from`.
function decls(selector: string, from = 0): Record<string, string> {
  const re = new RegExp(`(^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  re.lastIndex = from;
  const m = re.exec(css);
  expect(m, `${selector} in wall.css`).not.toBeNull();
  return Object.fromEntries(
    m![2].split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(":");
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    }),
  );
}

test("the row's spacing stays as tight as the measured fit needs", () => {
  expect(decls(".wall-chips").gap).toBe("var(--space-1)");
  expect(decls(".wall-status").gap).toBe("2px");
  expect(decls(".chip-pill").padding).toBe("0 6px");
});

test("the status strip, when it must scroll, moves only sideways and never drags the page", () => {
  const strip = decls(".wall-status");
  expect(strip["overflow-x"]).toBe("auto");
  expect(strip["overflow-y"]).toBe("hidden");
  expect(strip["overscroll-behavior-x"]).toBe("contain");
});

test("the status chips stay whole and a picked collection's name gives way instead", () => {
  expect(decls(".wall-status").flex).toBe("none");
  expect(decls(".wall-status")["max-width"]).toBe("calc(100% + var(--space-1) - 44px)");
  expect(decls(".wall-collection")).toMatchObject({ flex: "0 1 auto", "min-width": "0" });
  expect(decls(".wall-collection > .chip").flex).toBe("0 1 auto");
  expect(decls(".wall-collection .chip-label")["min-width"]).toBe("0");
});

test("below 400px the Collection chip swaps its word for the icon", () => {
  expect(decls(".chip-icon").display).toBe("none");
  const narrow = css.indexOf("@media (max-width: 399px)");
  expect(narrow).toBeGreaterThanOrEqual(0);
  expect(decls(".chip-icon", narrow).display).toBe("block");
  expect(decls(".chip-word", narrow)).toMatchObject({ position: "absolute", "clip-path": "inset(50%)" });
});
