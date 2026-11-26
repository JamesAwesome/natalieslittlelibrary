import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test } from "vitest";
import { resetDatabase } from "../../../test/reset";
import { invariantViolations } from "../../../test/invariant";
import { DUNE, EMMA, homeCopy, insertMembers, make, mint, natalie, ok, sam } from "../../../test/ledger-fixtures";

beforeEach(async () => {
  await resetDatabase(env.DB);
  await insertMembers();
});

afterEach(async () => {
  expect(await invariantViolations(env.DB)).toEqual([]);
});

test("sheets lists the member's mints newest first with counts", async () => {
  let t = 1000;
  const { ledger } = make({ now: () => t });
  await mint(ledger, 3);
  t = 5000;
  await homeCopy(ledger);
  ok(await ledger.mintLabels(sam, 2));
  const list = await ledger.sheets(natalie);
  expect(list.map((s) => [s.at, s.total, s.blank, s.mine])).toEqual([[5000, 1, 0, 1], [1000, 3, 3, 0]]);
});

test("sheetCodes gives blanks in mint order; includeMine adds labels on the member's own books only", async () => {
  const { ledger } = make();
  const [a, b, c] = await mint(ledger, 3);
  ok(await ledger.add(natalie, { code: a, book: { isbn: DUNE.isbn! } }));
  ok(await ledger.add(sam, { code: b, book: { isbn: EMMA.isbn! } }));
  const [sheet] = await ledger.sheets(natalie);
  const codes = async (includeMine: boolean) =>
    ok(await ledger.sheetCodes(natalie, sheet.id, { includeMine })).map((l) => l.code);
  expect(await codes(false)).toEqual([c]);
  expect(await codes(true)).toEqual([a, c]);
  expect(ok(await ledger.sheetCodes(natalie, sheet.id, { includeMine: false }))[0].url).toBe(`https://books.test/b/${c}`);
  expect(sheet.mine).toBe(1);
});

test("a label on a book the member owns but that was replaced is never printed", async () => {
  const { ledger } = make();
  const { code } = await homeCopy(ledger);
  const [sheet] = await ledger.sheets(natalie);
  await env.DB.prepare("update labels set retired_at = 1 where code = ?").bind(code).run();
  expect(ok(await ledger.sheetCodes(natalie, sheet.id, { includeMine: true }))).toEqual([]);
  expect((await ledger.sheets(natalie))[0].mine).toBe(0);
});

test("someone else's sheet, an unknown id and an over-long id are not-found", async () => {
  const { ledger } = make();
  await mint(ledger, 1);
  const [sheet] = await ledger.sheets(natalie);
  const mine = { includeMine: false };
  expect(await ledger.sheetCodes(sam, sheet.id, mine)).toEqual({ rejected: "not-found" });
  expect(await ledger.sheetCodes(natalie, "nope", mine)).toEqual({ rejected: "not-found" });
  expect(await ledger.sheetCodes(natalie, "x".repeat(201), mine)).toEqual({ rejected: "not-found" });
});

test("labels minted before sheet ids existed group by member and minted second", async () => {
  const { ledger } = make();
  const rows: [string, string, number][] = [["aaaaaaaaaa", natalie.id, 7000], ["bbbbbbbbbb", natalie.id, 7400], ["cccccccccc", natalie.id, 8100], ["dddddddddd", sam.id, 7000]];
  for (const [code, by, at] of rows) {
    await env.DB.prepare("insert into labels (code, minted_by, minted_at) values (?, ?, ?)").bind(code, by, at).run();
  }
  const list = await ledger.sheets(natalie);
  expect(list.map((s) => [s.total, s.id])).toEqual([[1, `old-${natalie.id}-8`], [2, `old-${natalie.id}-7`]]);
  const codes = ok(await ledger.sheetCodes(natalie, list[1].id, { includeMine: false }));
  expect(codes.map((l) => l.code)).toEqual(["aaaaaaaaaa", "bbbbbbbbbb"]);
});
