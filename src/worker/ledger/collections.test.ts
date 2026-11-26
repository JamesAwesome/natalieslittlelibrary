import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CollectionSummary, Member, Rejection } from "../../shared/types";
import { invariantViolations } from "../../../test/invariant";
import { homeCopy, insertMembers, kim, make, mint, natalie, ok, sam } from "../../../test/ledger-fixtures";
import { gated, racing, run } from "../../../test/racing";
import { resetDatabase } from "../../../test/reset";
import { ensureDefault } from "./collections";

beforeEach(async () => {
  await resetDatabase(env.DB);
  await insertMembers();
});

afterEach(async () => {
  expect(await invariantViolations(env.DB)).toEqual([]);
});

type Row = { id: string; owner_id: string; name: string; name_key: string; is_default: number };
const rows = async (): Promise<Row[]> =>
  (await env.DB.prepare("select id, owner_id, name, name_key, is_default from collections order by owner_id, name_key").all<Row>()).results;
const defaultsOf = async (ownerId: string) =>
  (await env.DB.prepare("select count(*) as n from collections where owner_id = ? and is_default = 1").bind(ownerId).first<{ n: number }>())!.n;

async function create(m: Member, name: string): Promise<CollectionSummary> {
  return ok(await make().ledger.createCollection(m, name));
}

// A copy placed by raw insert: unlabelled, and lent out when `holder` is another member.
async function rawCopy(id: string, ownerId: string, collectionId: string, holder: string = ownerId): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("insert or ignore into books (id, isbn, title, authors, cover_url, created_at) values ('b-raw', null, 'T', '[]', null, 0)"),
    env.DB.prepare("insert into copies (id, book_id, owner_id, holder_member_id, created_at, collection_id) values (?, 'b-raw', ?, ?, 0, ?)")
      .bind(id, ownerId, holder, collectionId),
  ]);
}

test("a member's first collection is their default; the second is not", async () => {
  const first = await create(natalie, "Beach house");
  const second = await create(natalie, "Classroom");
  expect(first).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: "Beach house", isDefault: true, count: 0, unlabelled: 0 });
  expect(second).toMatchObject({ name: "Classroom", isDefault: false });
  expect(await defaultsOf(natalie.id)).toBe(1);
});

test("names clash per member, ignoring case, including É and é", async () => {
  await create(natalie, "Beach");
  expect(await make().ledger.createCollection(natalie, "BEACH")).toEqual({ rejected: "name-taken" });
  await create(natalie, "École");
  expect(await make().ledger.createCollection(natalie, "\u00e9cole")).toEqual({ rejected: "name-taken" });
  expect(await make().ledger.createCollection(natalie, "ÉCOLE")).toEqual({ rejected: "name-taken" });
  expect(ok(await make().ledger.createCollection(sam, "Beach")).name).toBe("Beach");
  expect(await rows()).toHaveLength(3);
});

test.each(["", "   ", "a\nb", "x".repeat(61), 5, null])("creating %j is invalid", async (name) => {
  expect(await make().ledger.createCollection(natalie, name as never)).toEqual({ rejected: "invalid" });
  expect(await rows()).toEqual([]);
});

test("renaming to a case-only variant of its own name succeeds", async () => {
  const c = await create(natalie, "beach");
  expect(ok(await make().ledger.renameCollection(natalie, c.id, "  BEACH "))).toMatchObject({ id: c.id, name: "BEACH", isDefault: true });
  expect((await rows())[0]).toMatchObject({ name: "BEACH", name_key: "beach" });
});

test("renaming onto another collection's name is name-taken", async () => {
  await create(natalie, "Beach");
  const b = await create(natalie, "Classroom");
  expect(await make().ledger.renameCollection(natalie, b.id, "beach")).toEqual({ rejected: "name-taken" });
  expect(await make().ledger.renameCollection(natalie, b.id, "")).toEqual({ rejected: "invalid" });
  expect((await rows()).map((r) => r.name)).toEqual(["Beach", "Classroom"]);
});

test("renaming or deleting someone else's collection is not-found, and changes nothing", async () => {
  const c = await create(sam, "Sam's shelf");
  await create(sam, "Spare");
  const before = await rows();
  const { ledger } = make();
  expect(await ledger.renameCollection(natalie, c.id, "Mine now")).toEqual({ rejected: "not-found" });
  expect(await ledger.deleteCollection(natalie, c.id)).toEqual({ rejected: "not-found" });
  expect(await ledger.renameCollection(natalie, "no-such-id", "x")).toEqual({ rejected: "not-found" });
  expect(await ledger.deleteCollection(natalie, "no-such-id")).toEqual({ rejected: "not-found" });
  expect(await ledger.deleteCollection(natalie, 5 as never)).toEqual({ rejected: "not-found" });
  expect(await rows()).toEqual(before);
});

test("deleting an empty, non-default collection works", async () => {
  await create(natalie, "Home");
  const b = await create(natalie, "Beach");
  expect(await make().ledger.deleteCollection(natalie, b.id)).toEqual({ deleted: true });
  expect((await rows()).map((r) => r.name)).toEqual(["Home"]);
});

test.each(["the default", "a collection holding an unlabelled copy", "a collection whose only copy is lent out"])(
  "deleting %s is not-allowed",
  async (what) => {
    const home = await create(natalie, "Home");
    const beach = await create(natalie, "Beach");
    if (what.includes("unlabelled")) await rawCopy("c1", natalie.id, beach.id);
    if (what.includes("lent")) await rawCopy("c1", natalie.id, beach.id, sam.id);
    const target = what === "the default" ? home : beach;
    expect(await make().ledger.deleteCollection(natalie, target.id)).toEqual({ rejected: "not-allowed" });
    expect(await rows()).toHaveLength(2);
  },
);

test("make-default moves the default and leaves exactly one", async () => {
  const home = await create(natalie, "Home");
  const beach = await create(natalie, "Beach");
  const after = ok(await make().ledger.makeDefault(natalie, beach.id));
  expect(after.map((c) => [c.name, c.isDefault])).toEqual([["Beach", true], ["Home", false]]);
  expect(await defaultsOf(natalie.id)).toBe(1);
  expect((await rows()).find((r) => r.id === home.id)!.is_default).toBe(0);
});

test("make-default of the current default changes nothing and succeeds", async () => {
  const home = await create(natalie, "Home");
  await create(natalie, "Beach");
  const before = await rows();
  const after = ok(await make().ledger.makeDefault(natalie, home.id));
  expect(after.map((c) => [c.name, c.isDefault])).toEqual([["Home", true], ["Beach", false]]);
  expect(await rows()).toEqual(before);
});

test("make-default of someone else's collection is not-found and leaves both defaults as they were", async () => {
  await create(natalie, "Home");
  const theirs = await create(sam, "Sam's");
  await create(sam, "Spare");
  const before = await rows();
  expect(await make().ledger.makeDefault(natalie, theirs.id)).toEqual({ rejected: "not-found" });
  expect(await make().ledger.makeDefault(natalie, "no-such-id")).toEqual({ rejected: "not-found" });
  expect(await make().ledger.makeDefault(natalie, 7 as never)).toEqual({ rejected: "not-found" });
  expect(await rows()).toEqual(before);
});

test("make-default counts copies, lent out and unlabelled included", async () => {
  const home = await create(natalie, "Home");
  const beach = await create(natalie, "Beach");
  await rawCopy("c1", natalie.id, beach.id, sam.id);
  await rawCopy("c2", natalie.id, beach.id);
  const after = ok(await make().ledger.makeDefault(natalie, home.id));
  expect(after.find((c) => c.id === beach.id)).toMatchObject({ count: 2, unlabelled: 2 });
});

test("two creates of the same name at once: one succeeds, one is name-taken", async () => {
  const { ledger } = make({ db: gated(2) });
  const results = await Promise.all([ledger.createCollection(natalie, "Beach"), ledger.createCollection(natalie, "beach")]);
  const refused = results.filter((r): r is Rejection => "rejected" in r);
  expect(refused).toEqual([{ rejected: "name-taken" }]);
  expect(await rows()).toHaveLength(1);
});

test("two first creates at once: exactly one default", async () => {
  const { ledger } = make({ db: gated(2) });
  const results = await Promise.all([ledger.createCollection(natalie, "Beach"), ledger.createCollection(natalie, "Classroom")]);
  expect(results.every((r) => !("rejected" in r))).toBe(true);
  expect(await rows()).toHaveLength(2);
  expect(await defaultsOf(natalie.id)).toBe(1);
});

test("two renames onto one name at once: one succeeds, one is name-taken", async () => {
  await create(natalie, "Home");
  const a = await create(natalie, "A");
  const b = await create(natalie, "B");
  const { ledger } = make({ db: gated(2) });
  const results = await Promise.all([ledger.renameCollection(natalie, a.id, "Same"), ledger.renameCollection(natalie, b.id, "same")]);
  expect(results.filter((r) => "rejected" in r)).toEqual([{ rejected: "name-taken" }]);
});

test("a delete made stale by a copy placed in the collection after the read is refused and strands nothing", async () => {
  await create(natalie, "Home");
  const beach = await create(natalie, "Beach");
  const db = racing(() => rawCopy("c1", natalie.id, beach.id));
  expect(await make({ db }).ledger.deleteCollection(natalie, beach.id)).toEqual({ rejected: "not-allowed" });
  expect(await rows()).toHaveLength(2);
});

test("a make-default made stale by the target being deleted after the read is not-found, and the default stays", async () => {
  await create(natalie, "Home");
  const beach = await create(natalie, "Beach");
  const db = racing(run("delete from collections where id = ?", beach.id));
  expect(await make({ db }).ledger.makeDefault(natalie, beach.id)).toEqual({ rejected: "not-found" });
  expect(await defaultsOf(natalie.id)).toBe(1);
});

test("a removed member's collection writes are not-allowed and change nothing", async () => {
  const home = await create(sam, "Home");
  const beach = await create(sam, "Beach");
  const theirs = await create(natalie, "Natalie's");
  await env.DB.prepare("update members set removed_at = 5 where id = ?").bind(sam.id).run();
  const before = await rows();
  const { ledger } = make();
  expect(await ledger.createCollection(sam, "New")).toEqual({ rejected: "not-allowed" });
  expect(await ledger.renameCollection(sam, beach.id, "Renamed")).toEqual({ rejected: "not-allowed" });
  expect(await ledger.renameCollection(sam, theirs.id, "Renamed")).toEqual({ rejected: "not-allowed" });
  expect(await ledger.deleteCollection(sam, beach.id)).toEqual({ rejected: "not-allowed" });
  expect(await ledger.deleteCollection(sam, theirs.id)).toEqual({ rejected: "not-allowed" });
  expect(await ledger.makeDefault(sam, beach.id)).toEqual({ rejected: "not-allowed" });
  expect(await ledger.makeDefault(sam, home.id)).toEqual({ rejected: "not-allowed" });
  expect(await rows()).toEqual(before);
});

test("ensureDefault makes one default, once, and never for a removed member", async () => {
  await env.DB.prepare("update members set removed_at = 5 where id = ?").bind(kim.id).run();
  await env.DB.batch([...ensureDefault(env.DB, kim.id, 10), ...ensureDefault(env.DB, kim.id, 10)]);
  expect(await rows()).toEqual([]);
  await env.DB.batch([...ensureDefault(env.DB, sam.id, 10), ...ensureDefault(env.DB, sam.id, 11)]);
  expect(await rows()).toEqual([
    { id: expect.stringMatching(/^[0-9a-f-]{36}$/), owner_id: sam.id, name: "Home library", name_key: "home library", is_default: 1 },
  ]);
});

test("a member with a copy but no collection row (old code) gets a default, and a first collection becomes it", async () => {
  // What an old Worker, or a rollback, leaves: an owned copy with a null collection_id and no default for the owner.
  const { copyId } = await homeCopy(make().ledger);
  await env.DB.batch([
    env.DB.prepare("update copies set collection_id = null where id = ?").bind(copyId),
    env.DB.prepare("delete from collections"),
  ]);
  expect(await invariantViolations(env.DB)).toEqual([
    `copy ${copyId}: owner and collection are not both null or both set`,
    `member ${natalie.id}: owns a copy and has 0 default collections`,
  ]);
  await env.DB.batch(ensureDefault(env.DB, natalie.id, 10));
  expect(await defaultsOf(natalie.id)).toBe(1);
  // ensureDefault also pins the old-code copy to the new default, so the invariant holds again.
  expect(await invariantViolations(env.DB)).toEqual([]);
  await env.DB.prepare("update copies set collection_id = null where id = ?").bind(copyId).run();

  // The same state, but the member's first collection is made by hand: it is the default.
  await env.DB.prepare("delete from collections").run();
  const beach = await create(natalie, "Beach");
  expect(beach.isDefault).toBe(true);
  // The next ledger write to the copy sets the column; here the test does it.
  await env.DB.prepare("update copies set collection_id = ? where id = ?").bind(beach.id, copyId).run();
});

test("the invariant flags a retired label with no copy, and a copy whose only label is retired", async () => {
  const { ledger } = make();
  const { code, copyId } = await homeCopy(ledger);
  const [spare] = await mint(ledger);
  await env.DB.prepare("update labels set retired_at = 9 where code = ?").bind(spare).run();
  expect(await invariantViolations(env.DB)).toEqual([`label ${spare}: retired but not bound to a copy`]);
  await env.DB.prepare("update labels set retired_at = null where code = ?").bind(spare).run();
  // A retired label beside a live one is what a replace leaves, and is fine.
  await env.DB.prepare("update labels set copy_id = ?, retired_at = 9 where code = ?").bind(copyId, spare).run();
  expect(await invariantViolations(env.DB)).toEqual([]);
  await env.DB.prepare("update labels set retired_at = 9 where code = ?").bind(code).run();
  expect(await invariantViolations(env.DB)).toEqual([`copy ${copyId}: has a retired label and no live label`]);
  await env.DB.prepare("delete from labels where code = ?").bind(spare).run();
  await env.DB.prepare("update labels set retired_at = null where code = ?").bind(code).run();
});

test("deleting someone else's empty, non-default collection is not-found, and it still exists", async () => {
  await create(sam, "Sam's");
  const spare = await create(sam, "Spare");
  expect(await make().ledger.deleteCollection(natalie, spare.id)).toEqual({ rejected: "not-found" });
  expect((await rows()).map((r) => r.name)).toEqual(["Sam's", "Spare"]);
});

test("switching my default leaves another member's default alone", async () => {
  await create(sam, "Sam's");
  await create(natalie, "Home");
  const beach = await create(natalie, "Beach");
  ok(await make().ledger.makeDefault(natalie, beach.id));
  expect(await defaultsOf(sam.id)).toBe(1);
  expect(await defaultsOf(natalie.id)).toBe(1);
});

test("a member with no collections cannot make someone else's collection a default", async () => {
  await create(sam, "Sam's");
  const spare = await create(sam, "Spare");
  const before = await rows();
  expect(await make().ledger.makeDefault(kim, spare.id)).toEqual({ rejected: "not-found" });
  expect(await rows()).toEqual(before);
});

test("an old-code copy with no collection is pinned to the default, so changing the default cannot move it", async () => {
  const home = await create(natalie, "Home");
  const { copyId } = await homeCopy(make().ledger);
  await env.DB.prepare("update copies set collection_id = null where id = ?").bind(copyId).run();
  const beach = await create(natalie, "Beach");
  const after = ok(await make().ledger.makeDefault(natalie, beach.id));
  expect(await make().ledger.deleteCollection(natalie, home.id)).toEqual({ rejected: "not-allowed" });
  expect((await env.DB.prepare("select collection_id as c from copies where id = ?").bind(copyId).first<{ c: string }>())!.c).toBe(home.id);
  expect(after.find((c) => c.id === home.id)).toMatchObject({ count: 1, unlabelled: 0 });
  expect(after.find((c) => c.id === beach.id)).toMatchObject({ count: 0, isDefault: true });
});

test.each([
  ["a zero-width space", "a\u200bb"],
  ["a left-to-right mark", "a\u200eb"],
  ["a right-to-left mark", "a\u200fb"],
  ["an Arabic letter mark", "a\u061cb"],
  ["a line separator", "a\u2028b"],
  ["a paragraph separator", "a\u2029b"],
  ["a byte order mark", "a\ufeffb"],
  ["a soft hyphen", "a\u00adb"],
  ["a tag character", "a\u{e0041}b"],
  ["a lone surrogate", "a\ud800b"],
])("a name with %s is invalid", async (_what, name) => {
  expect(await make().ledger.createCollection(natalie, name)).toEqual({ rejected: "invalid" });
  expect(await rows()).toEqual([]);
});
