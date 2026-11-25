import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { create } from "qrcode";
import { codeBox, perSheet, positions } from "./layout";
import { Sheet } from "./Sheet";
import { DEFAULT_SHEET_ID, SHEETS } from "./sheets";

const sheet = (id: string) => SHEETS.find((s) => s.id === id)!;
const made = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ code: `code${String(i).padStart(6, "0")}`, url: `https://lib.test/b/code${String(i).padStart(6, "0")}` }));
const none = { xMm: 0, yMm: 0 };
const inches = (v: string) => Number.parseFloat(v.replace("in", ""));

test("perSheet + 1 labels make two pages", () => {
  const layout = sheet(DEFAULT_SHEET_ID);
  const { container } = render(<Sheet labels={made(perSheet(layout) + 1)} layout={layout} nudge={none} />);
  const pages = container.querySelectorAll(".sheet-page");
  expect(pages).toHaveLength(2);
  expect(pages[0]!.querySelectorAll(".sheet-label")).toHaveLength(perSheet(layout));
  expect(pages[1]!.querySelectorAll(".sheet-label")).toHaveLength(1);
});

test.each(SHEETS)("$name: each label's SVG has the width codeBox gives, and text only where it says", (layout) => {
  const box = codeBox(layout)!;
  const { container } = render(<Sheet labels={made(3)} layout={layout} nudge={none} />);
  const svgs = container.querySelectorAll("svg");
  expect(svgs).toHaveLength(3);
  for (const svg of svgs) {
    expect(inches(svg.getAttribute("width")!)).toBeCloseTo(box.qrIn, 3);
    expect(inches(svg.getAttribute("height")!)).toBeCloseTo(box.qrIn, 3);
    expect(svg).toHaveAttribute("shape-rendering", "crispEdges");
  }
  const texts = container.querySelectorAll(".sheet-code");
  expect(texts).toHaveLength(box.showText ? 3 : 0);
  if (box.showText) expect(texts[0]!.textContent).toBe("code000000");
});

test("a nudge of 1 mm right and 0.5 mm down moves every label by that much", () => {
  const layout = sheet(DEFAULT_SHEET_ID);
  const at = (nudge: { xMm: number; yMm: number }) => {
    const { container, unmount } = render(<Sheet labels={made(48)} layout={layout} nudge={nudge} />);
    const spots = [...container.querySelectorAll<HTMLElement>(".sheet-label")].map((el) => ({
      left: inches(el.style.left), top: inches(el.style.top),
    }));
    unmount();
    return spots;
  };
  const still = at(none);
  const moved = at({ xMm: 1, yMm: 0.5 });
  expect(moved).toHaveLength(48);
  moved.forEach((m, i) => {
    expect((m.left - still[i]!.left) * 25.4).toBeCloseTo(1, 2);
    expect((m.top - still[i]!.top) * 25.4).toBeCloseTo(0.5, 2);
  });
  const want = positions(layout);
  expect(still[0]!.left).toBeCloseTo(want[0]!.leftIn, 4);
  expect(still[47]!.top).toBeCloseTo(want[47]!.topIn, 4);
});

test("the QR is built from the given url, verbatim, with error correction M", () => {
  const layout = sheet(DEFAULT_SHEET_ID);
  const url = "https://lib.test/b/23456789ab";
  const { container } = render(<Sheet labels={[{ code: "23456789ab", url }]} layout={layout} nudge={none} />);
  const svg = container.querySelector("svg")!;
  const qr = create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  expect(svg.getAttribute("viewBox")).toBe(`0 0 ${n} ${n}`);
  // Read the drawn squares back and compare them module for module.
  const d = svg.querySelector("path")!.getAttribute("d")!;
  const drawn = new Set<string>();
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let k = 0; k < Number(m[3]); k++) drawn.add(`${Number(m[1]) + k},${m[2]}`);
  }
  const expected = new Set<string>();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) expected.add(`${x},${y}`);
  expect(drawn).toEqual(expected);
});

test("only the plain-paper sheet draws cut marks", () => {
  const plain = render(<Sheet labels={made(1)} layout={sheet("plain-63")} nudge={none} />);
  expect(plain.container.querySelectorAll(".sheet-cut").length).toBeGreaterThan(0);
  plain.unmount();
  const avery = render(<Sheet labels={made(1)} layout={sheet(DEFAULT_SHEET_ID)} nudge={none} />);
  expect(avery.container.querySelectorAll(".sheet-cut")).toHaveLength(0);
});

test("the alignment sheet is one page of empty outlines, no codes", () => {
  const layout = sheet("avery-6450");
  const { container } = render(<Sheet labels={[]} layout={layout} nudge={none} outlinesOnly />);
  expect(container.querySelectorAll(".sheet-page")).toHaveLength(1);
  expect(container.querySelectorAll(".sheet-label")).toHaveLength(63);
  expect(container.querySelector("svg")).toBeNull();
  expect(container.querySelector(".sheet-code")).toBeNull();
  expect(container.querySelector(".sheet-label")).toHaveClass("sheet-label--round");
});
