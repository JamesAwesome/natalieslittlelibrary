import { expect, test } from "vitest";
import { codeBox, perSheet, positions, validate, type SheetLayout } from "./layout";
import { DEFAULT_SHEET_ID, SHEETS } from "./sheets";

const EPS = 1e-9;

test.each(SHEETS)("$name fits its page, without overlap", (sheet) => {
  expect(validate(sheet)).toEqual([]);
  const spots = positions(sheet);
  expect(spots).toHaveLength(perSheet(sheet));
  for (const s of spots) {
    expect(s.leftIn).toBeGreaterThan(0);
    expect(s.topIn).toBeGreaterThan(0);
    expect(s.leftIn + sheet.label.widthIn).toBeLessThanOrEqual(sheet.page.widthIn + 0.005);
    expect(s.topIn + sheet.label.heightIn).toBeLessThanOrEqual(sheet.page.heightIn + 0.005);
  }
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const a = spots[i]!;
      const b = spots[j]!;
      const apart =
        a.leftIn + sheet.label.widthIn <= b.leftIn + EPS || b.leftIn + sheet.label.widthIn <= a.leftIn + EPS ||
        a.topIn + sheet.label.heightIn <= b.topIn + EPS || b.topIn + sheet.label.heightIn <= a.topIn + EPS;
      expect(apart).toBe(true);
    }
  }
});

test("the default sheet is a 1-inch square, 48 to a sheet", () => {
  const sheet = SHEETS.find((s) => s.id === DEFAULT_SHEET_ID)!;
  expect(sheet.label).toEqual({ widthIn: 1, heightIn: 1 });
  expect(sheet.shape).toBe("rectangle");
  expect(perSheet(sheet)).toBe(48);
});

const base: SheetLayout = {
  id: "t", name: "t", source: "test", page: { widthIn: 8.5, heightIn: 11 }, shape: "rectangle",
  label: { widthIn: 1, heightIn: 1 }, columns: 2, rows: 2, marginTopIn: 0.5, marginLeftIn: 0.5, pitchXIn: 1.25, pitchYIn: 1.25,
};

test("positions run across each row, then down", () => {
  expect(positions(base)).toEqual([
    { leftIn: 0.5, topIn: 0.5 }, { leftIn: 1.75, topIn: 0.5 },
    { leftIn: 0.5, topIn: 1.75 }, { leftIn: 1.75, topIn: 1.75 },
  ]);
});

test.each([
  [{ shape: "rectangle", w: 1, h: 1 }, { qrIn: 0.72, showText: true }],
  [{ shape: "rectangle", w: 2.625, h: 1 }, { qrIn: 0.72, showText: true }],
  [{ shape: "rectangle", w: 1.5, h: 1.5 }, { qrIn: 1.08, showText: true }],
  [{ shape: "round", w: 1, h: 1 }, { qrIn: 0.62, showText: false }],
  [{ shape: "round", w: 1.4, h: 1.4 }, { qrIn: 0.868, showText: false }],
  [{ shape: "round", w: 1.5, h: 1.5 }, { qrIn: 0.93, showText: true }],
  [{ shape: "round", w: 2, h: 2 }, { qrIn: 1.24, showText: true }],
  [{ shape: "rectangle", w: 1.75, h: 0.5 }, null],
  [{ shape: "rectangle", w: 0.85, h: 0.85 }, { qrIn: 0.612, showText: false }],
] as const)("a %j label carries %j", (label, expected) => {
  const got = codeBox({ ...base, shape: label.shape, label: { widthIn: label.w, heightIn: label.h } });
  if (expected === null) expect(got).toBeNull();
  else {
    expect(got!.qrIn).toBeCloseTo(expected.qrIn, 9);
    expect(got!.showText).toBe(expected.showText);
  }
});

test.each([
  ["labels running off the right edge", { columns: 7 }, "off the page"],
  ["labels running off the bottom edge", { rows: 9 }, "off the page"],
  ["a pitch smaller than the label", { pitchXIn: 0.9 }, "overlap"],
  ["zero columns", { columns: 0 }, "at least one"],
  ["101 labels on a sheet", { columns: 101, rows: 1, pitchXIn: 0.05, label: { widthIn: 0.05, heightIn: 1 } }, "100"],
  ["a half-inch label", { label: { widthIn: 0.5, heightIn: 0.5 } }, "this small"],
  ["a negative margin", { marginLeftIn: -1 }, "greater than zero"],
  ["a blank number", { pitchYIn: Number.NaN }, "greater than zero"],
  ["a page that is not Letter", { page: { widthIn: 8.27, heightIn: 11.69 } }, "Letter"],
] as const)("a custom sheet with %s is refused", (_what, change, expected) => {
  const problems = validate({ ...base, ...change });
  expect(problems.join(" | ")).toContain(expected);
});

test("a half-inch label says why in the brief's words", () => {
  expect(validate({ ...base, label: { widthIn: 0.5, heightIn: 0.5 } })).toContain(
    "Labels this small can't carry a code that scans reliably.",
  );
});

const MM = 1 / 25.4;
const CLEAR_IN = 1.5 * MM;
// Distance from the QR's nearest edge (rectangle) or corner (circle) to the label's cut.
function qrClearance(layout: SheetLayout): number {
  const box = codeBox(layout)!;
  const { widthIn: w, heightIn: h } = layout.label;
  const x0 = box.qrLeftIn;
  const y0 = box.qrTopIn;
  const x1 = x0 + box.qrIn;
  const y1 = y0 + box.qrIn;
  if (layout.shape === "rectangle") return Math.min(x0, y0, w - x1, h - y1);
  const r = w / 2;
  return Math.min(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => r - Math.hypot(x! - r, y! - r)));
}

test.each(SHEETS)("$name: the code keeps 1.5 mm clear of the cut", (sheet) => {
  expect(qrClearance(sheet)).toBeGreaterThanOrEqual(CLEAR_IN);
});

test("on every round label the code is exactly centred", () => {
  for (const sheet of SHEETS.filter((s) => s.shape === "round")) {
    const box = codeBox(sheet)!;
    expect(box.qrLeftIn).toBeCloseTo((sheet.label.widthIn - box.qrIn) / 2, 9);
    expect(box.qrTopIn).toBeCloseTo((sheet.label.heightIn - box.qrIn) / 2, 9);
  }
});

test("a custom round label stays clear of the cut at its smallest allowed size", () => {
  const round = { ...base, shape: "round" as const, label: { widthIn: 0.97, heightIn: 0.97 } };
  expect(codeBox(round)).not.toBeNull();
  expect(qrClearance(round)).toBeGreaterThanOrEqual(CLEAR_IN);
});

test.each([29, 33, 41])("the code text is at least 2 modules below a %i-module code, and inside the label", (modules) => {
  let withText = 0;
  for (const sheet of SHEETS) {
    const box = codeBox(sheet, modules)!;
    expect(box.qrIn).toBeCloseTo(codeBox(sheet)!.qrIn, 9); // the code is never shrunk to make room
    if (!box.showText) continue;
    withText++;
    const gap = box.textTopIn - (box.qrTopIn + box.qrIn);
    expect(gap).toBeGreaterThanOrEqual((2 * box.qrIn) / modules - 1e-9);
    const { widthIn: w, heightIn: h } = sheet.label;
    const textBottom = box.textTopIn + box.textHeightIn;
    if (sheet.shape === "rectangle") expect(h - textBottom).toBeGreaterThanOrEqual(CLEAR_IN);
    else {
      const r = w / 2;
      const corner = Math.hypot(box.textWidthIn / 2, textBottom - r);
      expect(r - corner).toBeGreaterThanOrEqual(CLEAR_IN);
    }
  }
  expect(withText).toBeGreaterThan(0);
});

test("round labels under 1.5 in carry no text; the 1 in round has none", () => {
  const sheet = SHEETS.find((s) => s.id === "avery-6450")!;
  expect(codeBox(sheet)!.showText).toBe(false);
  expect(codeBox(SHEETS.find((s) => s.id === "avery-22807")!)!.showText).toBe(true);
});
