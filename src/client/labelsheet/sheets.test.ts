import { expect, test } from "vitest";
import { DEFAULT_SHEET_ID, SHEETS } from "./sheets";

test("every sheet says where its measurements came from", () => {
  for (const s of SHEETS) expect(s.source.trim()).not.toBe("");
});

test("every Avery sheet cites Avery's own template", () => {
  for (const s of SHEETS.filter((x) => x.id.startsWith("avery-"))) expect(s.source).toMatch(/^https:\/\/s3\.amazonaws\.com\/avery\./);
});

test("ids are unique and the default exists", () => {
  const ids = SHEETS.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain(DEFAULT_SHEET_ID);
  expect(DEFAULT_SHEET_ID).toBe("avery-94103");
});

test("the offered sheets are the sourced ones, and 5167 is not among them", () => {
  expect(SHEETS.map((s) => s.id)).toEqual([
    "avery-94103", "avery-22805", "avery-22806", "avery-5160", "avery-6450", "avery-22807", "plain-63",
  ]);
});
