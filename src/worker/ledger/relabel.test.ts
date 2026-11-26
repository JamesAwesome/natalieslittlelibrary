import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CopyView, Rejection } from "../../shared/types";
import { resetDatabase } from "../../../test/reset";
import { invariantViolations } from "../../../test/invariant";
import { asCopy, count, homeCopy, insertMembers, make, mint, natalie, ok, sam } from "../../../test/ledger-fixtures";
import { gated, racing } from "../../../test/racing";

beforeEach(async () => {
  await resetDatabase(env.DB);
  await insertMembers();
});

afterEach(async () => {
  expect(await invariantViolations(env.DB)).toEqual([]);
});

const labelsOf = async (copyId: string) =>
  (await env.DB.prepare("select code, retired_at from labels where copy_id = ? order by rowid").bind(copyId).all()).results;
const liveLabels = async (copyId: string) =>
  (await env.DB.prepare("select count(*) as n from labels where copy_id = ? and retired_at is null").bind(copyId).first<{ n: number }>())!.n;
const relabelledEvents = async (copyId: string) =>
  (await env.DB.prepare("select count(*) as n from events where copy_id = ? and type = 'relabelled'").bind(copyId).first<{ n: number }>())!.n;
const isBlank = async (code: string) =>
  (await env.DB.prepare("select copy_id from labels where code = ?").bind(code).first<{ copy_id: string | null }>())!.copy_id === null;
const isRejection = (r: CopyView | Rejection): r is Rejection => "rejected" in r;

test("replace retires the old label, binds the new one, and adds one relabelled entry", async () => {
  const { ledger } = make();
  const { code: old, copyId } = await homeCopy(ledger);
  const [fresh] = await mint(ledger);
  const copy = ok(await ledger.replaceLabel(natalie, copyId, { code: fresh, replacing: old }));
  expect(copy.code).toBe(fresh);
  expect(copy.ownerCode).toBe(fresh);
  expect(copy.history[0].type).toBe("relabelled");
  expect(copy.history.filter((h) => h.type === "relabelled")).toHaveLength(1);
  expect(await ledger.view(old, natalie)).toEqual({ kind: "retired" });
  expect(asCopy(await ledger.view(fresh, natalie)).copyId).toBe(copyId);
  const rows = await env.DB.prepare("select code, retired_at from labels where copy_id = ? order by rowid").bind(copyId).all();
  expect(rows.results).toEqual([{ code: old, retired_at: 1000 }, { code: fresh, retired_at: null }]);
});

test("after a replace the copy is listed once on its shelf and in holding, still labelled", async () => {
  const { ledger } = make();
  const { code: old, copyId } = await homeCopy(ledger);
  ok(await ledger.act(sam, { type: "claim", code: old })); // out with Sam, so it is in his holding too
  const [fresh] = await mint(ledger);
  ok(await ledger.replaceLabel(natalie, copyId, { code: fresh, replacing: old }));
  const { collections } = ok(await ledger.collectionsOf(natalie.id));
  expect(collections.map((k) => [k.count, k.unlabelled])).toEqual([[1, 0]]);
  const shelf = ok(await ledger.shelf(collections[0].id));
  expect(shelf.items.map((i) => [i.copyId, i.labelled])).toEqual([[copyId, true]]);
  expect((await ledger.holding(sam)).map((i) => [i.copyId, i.labelled])).toEqual([[copyId, true]]);
});

test("only the owner may replace; a removed owner may not", async () => {
  const { ledger } = make();
  const { code: old, copyId } = await homeCopy(ledger);
  const [fresh] = await mint(ledger);
  expect(await ledger.replaceLabel(sam, copyId, { code: fresh, replacing: old })).toEqual({ rejected: "not-allowed" });
  await env.DB.prepare("update members set removed_at = 1 where id = ?").bind(natalie.id).run();
  expect(await ledger.replaceLabel(natalie, copyId, { code: fresh, replacing: old })).toEqual({ rejected: "not-allowed" });
  expect(await labelsOf(copyId)).toEqual([{ code: old, retired_at: null }]);
  expect(await isBlank(fresh)).toBe(true);
  expect(await relabelledEvents(copyId)).toBe(0);
});

test("an unlabelled copy cannot be replaced", async () => {
  const { ledger } = make();
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [{ title: "Loose", authors: [], isbn: null }] }));
  const copyId = (await env.DB.prepare("select id from copies").first<{ id: string }>())!.id;
  const [fresh, other] = await mint(ledger, 2);
  expect(await ledger.replaceLabel(natalie, copyId, { code: fresh, replacing: other })).toEqual({ rejected: "not-allowed" });
  expect(await labelsOf(copyId)).toEqual([]);
  expect(await isBlank(fresh)).toBe(true);
});

test("a stale replacing code is refused and its new label stays blank", async () => {
  const { ledger } = make();
  const { code: old, copyId } = await homeCopy(ledger);
  const [a, b] = await mint(ledger, 2);
  ok(await ledger.replaceLabel(natalie, copyId, { code: a, replacing: old }));
  expect(await ledger.replaceLabel(natalie, copyId, { code: b, replacing: old })).toEqual({ rejected: "not-allowed" });
  expect(await isBlank(b)).toBe(true);
  expect(await liveLabels(copyId)).toBe(1);
  expect(await relabelledEvents(copyId)).toBe(1);
});

test("the copy's own label as the new one is label-in-use; an unknown code is label-unknown", async () => {
  const { ledger } = make();
  const { code: old, copyId } = await homeCopy(ledger);
  expect(await ledger.replaceLabel(natalie, copyId, { code: old, replacing: old })).toEqual({ rejected: "label-in-use" });
  expect(await ledger.replaceLabel(natalie, copyId, { code: "zzzzzzzzzz", replacing: old })).toEqual({ rejected: "label-unknown" });
  expect(await ledger.replaceLabel(natalie, copyId, { code: "not a code", replacing: old })).toEqual({ rejected: "label-unknown" });
  // A retired label is still bound to its copy, so it is in use too.
  const [fresh] = await mint(ledger);
  ok(await ledger.replaceLabel(natalie, copyId, { code: fresh, replacing: old }));
  expect(await ledger.replaceLabel(natalie, copyId, { code: old, replacing: fresh })).toEqual({ rejected: "label-in-use" });
  expect(await labelsOf(copyId)).toEqual([{ code: old, retired_at: 1000 }, { code: fresh, retired_at: null }]);
});

test("rejections come in order: invalid, label-unknown, label-in-use, not-found, not-allowed", async () => {
  const { ledger } = make();
  const { code: old, copyId } = await homeCopy(ledger);
  const [fresh] = await mint(ledger);
  const missing = crypto.randomUUID();
  const replace = (id: unknown, input: unknown) => ledger.replaceLabel(natalie, id as string, input as { code: string; replacing: string });
  expect(await replace(5, { code: fresh, replacing: old })).toEqual({ rejected: "invalid" });
  expect(await replace(copyId, null)).toEqual({ rejected: "invalid" });
  expect(await replace(copyId, { code: fresh })).toEqual({ rejected: "invalid" });
  expect(await replace(copyId, { code: 5, replacing: old })).toEqual({ rejected: "invalid" });
  expect(await replace(missing, { code: "zzzzzzzzzz", replacing: old })).toEqual({ rejected: "label-unknown" });
  expect(await replace(missing, { code: old, replacing: old })).toEqual({ rejected: "label-in-use" });
  expect(await replace(missing, { code: fresh, replacing: old })).toEqual({ rejected: "not-found" });
  expect(await replace(copyId, { code: fresh, replacing: "not a code" })).toEqual({ rejected: "not-allowed" });
  expect(await isBlank(fresh)).toBe(true);
});

test("two replaces racing for one copy: one wins, the copy keeps one live label", async () => {
  const { code: old, copyId } = await homeCopy(make().ledger);
  const [a, b] = await mint(make().ledger, 2);
  const { ledger } = make({ db: gated(2) });
  const results = await Promise.all([
    ledger.replaceLabel(natalie, copyId, { code: a, replacing: old }),
    ledger.replaceLabel(natalie, copyId, { code: b, replacing: old }),
  ]);
  expect(results.filter((r) => !isRejection(r))).toHaveLength(1);
  const [refused] = results.filter(isRejection);
  expect(["not-allowed", "label-in-use"]).toContain(refused.rejected);
  expect(await liveLabels(copyId)).toBe(1);
  expect(await relabelledEvents(copyId)).toBe(1);
  expect((await isBlank(a)) !== (await isBlank(b))).toBe(true);
});

test("the same replace sent twice at once applies once: one relabelled entry, one live label", async () => {
  const { code: old, copyId } = await homeCopy(make().ledger);
  const [a] = await mint(make().ledger);
  const { ledger } = make({ db: gated(2) });
  const results = await Promise.all([
    ledger.replaceLabel(natalie, copyId, { code: a, replacing: old }),
    ledger.replaceLabel(natalie, copyId, { code: a, replacing: old }),
  ]);
  expect(results.filter((r) => !isRejection(r))).toHaveLength(1);
  const [refused] = results.filter(isRejection);
  expect(["not-allowed", "label-in-use"]).toContain(refused.rejected);
  expect(await relabelledEvents(copyId)).toBe(1);
  expect(await liveLabels(copyId)).toBe(1);
});

test("a claim through the old code that lands after the replace is refused", async () => {
  const ledger2 = make().ledger;
  const { code: old, copyId } = await homeCopy(ledger2);
  const [fresh] = await mint(ledger2);
  let replaced = null as CopyView | Rejection | null;
  const { ledger } = make({
    db: racing(async () => {
      replaced = await ledger2.replaceLabel(natalie, copyId, { code: fresh, replacing: old });
    }),
  });
  const claimed = await ledger.act(sam, { type: "claim", code: old });
  expect(replaced).not.toBeNull();
  ok(replaced!); // the replace really landed, between Sam's read and his write
  expect(isRejection(claimed) && ["not-found", "not-allowed"].includes(claimed.rejected)).toBe(true);
  const holder = (await env.DB.prepare("select holder_member_id as h from copies where id = ?").bind(copyId).first<{ h: string }>())!.h;
  expect(holder).toBe(natalie.id);
  expect(await env.DB.prepare("select 1 from events where type = 'claimed'").first()).toBeNull();
});

test("ownerCode is the live code for the owner on any view, and null for anyone else", async () => {
  const { ledger } = make();
  const { code, copyId } = await homeCopy(ledger);
  expect(ok(await ledger.viewCopy(copyId, natalie)).ownerCode).toBe(code);
  expect(ok(await ledger.viewCopy(copyId, natalie)).code).toBeNull();
  expect(ok(await ledger.viewCopy(copyId, sam)).ownerCode).toBeNull();
  expect(asCopy(await ledger.view(code, sam)).ownerCode).toBeNull();
  expect(asCopy(await ledger.view(code, natalie)).ownerCode).toBe(code);
  const pub = await ledger.view(code, null);
  expect(pub.kind).toBe("public");
  expect("ownerCode" in pub).toBe(false);
  // An unlabelled copy has no code for anyone.
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [{ title: "Loose", authors: [], isbn: null }] }));
  const loose = (await env.DB.prepare("select id from copies where id <> ?").bind(copyId).first<{ id: string }>())!.id;
  expect(ok(await ledger.viewCopy(loose, natalie)).ownerCode).toBeNull();
});

test("a copy can be replaced again: old to a, then a to b", async () => {
  const { ledger } = make();
  const { code: old, copyId } = await homeCopy(ledger);
  const [a, b] = await mint(ledger, 2);
  ok(await ledger.replaceLabel(natalie, copyId, { code: a, replacing: old }));
  const copy = ok(await ledger.replaceLabel(natalie, copyId, { code: b, replacing: a }));
  expect(copy.ownerCode).toBe(b);
  expect(await relabelledEvents(copyId)).toBe(2);
  expect(await ledger.view(old, natalie)).toEqual({ kind: "retired" });
  expect(await ledger.view(a, natalie)).toEqual({ kind: "retired" });
  expect(await labelsOf(copyId)).toEqual([{ code: old, retired_at: 1000 }, { code: a, retired_at: 1000 }, { code: b, retired_at: null }]);
});

test("a new label bound elsewhere between the read and the batch is label-in-use, and the copy keeps its label", async () => {
  const ledger2 = make().ledger;
  const { code: old, copyId } = await homeCopy(ledger2);
  const [fresh] = await mint(ledger2);
  let other = null as CopyView | Rejection | null;
  const { ledger } = make({
    db: racing(async () => {
      other = await ledger2.add(sam, { code: fresh, book: { title: "Sam's own", authors: [] } });
    }),
  });
  expect(await ledger.replaceLabel(natalie, copyId, { code: fresh, replacing: old })).toEqual({ rejected: "label-in-use" });
  const samsCopy = ok(other!); // the add really landed, between the replace's read and its batch
  expect(await labelsOf(copyId)).toEqual([{ code: old, retired_at: null }]);
  expect(await labelsOf(samsCopy.copyId)).toEqual([{ code: fresh, retired_at: null }]);
  expect(ok(await ledger2.viewCopy(copyId, natalie)).ownerCode).toBe(old);
  expect(await relabelledEvents(copyId)).toBe(0);
  expect(await liveLabels(copyId)).toBe(1);
});

test("an owner change between the read and the batch is not-allowed and changes nothing", async () => {
  const ledger2 = make().ledger;
  const { code: old, copyId } = await homeCopy(ledger2);
  const [fresh] = await mint(ledger2);
  ok(await ledger2.createCollection(sam, "Sam's shelf")); // Sam's first collection, so his default
  const snapshot = async () =>
    JSON.stringify(await Promise.all(["labels", "events"].map(async (t) => (await env.DB.prepare(`select * from ${t} order by 1`).all()).results)));
  let before = "";
  const { ledger } = make({
    db: racing(async () => {
      await env.DB.prepare(
        `update copies set owner_id = ?, holder_member_id = ?,
           collection_id = (select id from collections where owner_id = ? and is_default = 1) where id = ?`,
      ).bind(sam.id, sam.id, sam.id, copyId).run();
      before = await snapshot();
    }),
  });
  const events = await count("events");
  expect(await ledger.replaceLabel(natalie, copyId, { code: fresh, replacing: old })).toEqual({ rejected: "not-allowed" });
  expect(before).not.toBe(""); // the owner really changed, between the replace's read and its batch
  expect(await snapshot()).toBe(before);
  expect(await count("events")).toBe(events);
  expect(await isBlank(fresh)).toBe(true);
  expect(await labelsOf(copyId)).toEqual([{ code: old, retired_at: null }]);
});

test("a relabel clears a removed asker's request", async () => {
  const { ledger } = make();
  const { code: old, copyId } = await homeCopy(ledger);
  const [fresh] = await mint(ledger);
  await env.DB.prepare("update copies set holder_member_id = ?, requested_by = ?, requested_at = 7 where id = ?").bind(sam.id, sam.id, copyId).run();
  await env.DB.prepare("update members set removed_at = 5 where id = ?").bind(sam.id).run();
  ok(await ledger.replaceLabel(natalie, copyId, { code: fresh, replacing: old }));
  expect(await env.DB.prepare("select requested_by, requested_at from copies where id = ?").bind(copyId).first()).toEqual({ requested_by: null, requested_at: null });
});
