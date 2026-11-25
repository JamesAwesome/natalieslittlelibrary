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
  [{ shape: "round", w: 1, h: 1 }, { qrIn: 0.62, showText: true }],
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

test("on a round label the code's corners stay inside the circle", () => {
  const rounds = SHEETS.filter((s) => s.shape === "round");
  expect(rounds.length).toBeGreaterThan(0);
  for (const sheet of rounds) {
    const box = codeBox(sheet)!;
    expect(box.qrIn * Math.SQRT2).toBeLessThan(sheet.label.widthIn);
  }
});
