import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CollectionSummary, Shelf } from "../../shared/types";
import { resetDatabase } from "../../../test/reset";
import { invariantViolations } from "../../../test/invariant";
import { DUNE, EMMA, asCopy, insertMembers, kim, make, mint, natalie, ok, sam } from "../../../test/ledger-fixtures";

beforeEach(async () => {
  await resetDatabase(env.DB);
  await insertMembers();
});

afterEach(async () => {
  expect(await invariantViolations(env.DB)).toEqual([]);
});

async function rawUnlabelled(id: string, ownerId: string, collectionId: string | null, title: string, holder: string = ownerId) {
  await env.DB.batch([
    env.DB.prepare("insert into books (id, isbn, title, authors, cover_url, created_at) values (?, null, ?, '[]', null, 0)").bind("b-" + id, title),
    env.DB.prepare("insert into copies (id, book_id, owner_id, holder_member_id, created_at, collection_id) values (?, ?, ?, ?, 0, ?)")
      .bind(id, "b-" + id, ownerId, holder, collectionId),
  ]);
}

// Natalie: Home library (2 labelled, 1 unlabelled, 1 of them lent to Sam) and Beach house (1); Sam: 1.
async function fixture() {
  const { ledger } = make();
  const codes = await mint(ledger, 5);
  const dune = ok(await ledger.add(natalie, { code: codes[0], book: { isbn: DUNE.isbn! } }));
  const emma = ok(await ledger.add(natalie, { code: codes[1], book: { isbn: EMMA.isbn! } }));
  await rawUnlabelled("c-raw", natalie.id, null, "Zeta");
  const beach = ok(await ledger.createCollection(natalie, "Beach house"));
  const atBeach = ok(await ledger.add(natalie, { code: codes[2], book: { title: "Sand", authors: ["A"] }, collectionId: beach.id }));
  const sams = ok(await ledger.add(sam, { code: codes[3], book: { title: "Sam's own", authors: [] } }));
  ok(await ledger.act(sam, { type: "claim", code: codes[0] })); // Sam holds Dune
  // the raw unlabelled copy goes in Home library through a real default
  await env.DB.prepare("update copies set collection_id = (select id from collections where owner_id = ? and is_default = 1) where id = 'c-raw'").bind(natalie.id).run();
  return { ledger, codes, dune, emma, atBeach, sams, beach };
}

test("collectionsOf lists the default first with counts that include lent-out and unlabelled copies", async () => {
  const { ledger, beach } = await fixture();
  const r = ok(await ledger.collectionsOf(natalie.id));
  expect(r.owner).toEqual({ id: natalie.id, name: "Natalie", pictureUrl: natalie.pictureUrl });
  expect(r.collections.map((c: CollectionSummary) => [c.name, c.isDefault, c.count, c.unlabelled])).toEqual([
    ["Home library", true, 3, 1],
    ["Beach house", false, 1, 0],
  ]);
  expect(r.collections[1].id).toBe(beach.id);
});

test("collectionsOf sorts non-default collections by name, ignoring case", async () => {
  const { ledger } = make();
  for (const n of ["cabin", "Attic", "Boat"]) ok(await ledger.createCollection(natalie, n));
  const r = ok(await ledger.collectionsOf(natalie.id));
  expect(r.collections.map((c) => c.name)).toEqual(["cabin", "Attic", "Boat"]); // the first made is the default
});

test("a shelf lists its copies by title with holder, home, and labelled", async () => {
  const { ledger, dune, emma } = await fixture();
  const home = ok(await ledger.collectionsOf(natalie.id)).collections[0];
  const shelf: Shelf = ok(await ledger.shelf(home.id));
  expect(shelf.owner.id).toBe(natalie.id);
  expect(shelf.collection).toEqual(home);
  expect(shelf.items.map((i) => i.book.title)).toEqual(["Dune", "Emma", "Zeta"]);
  const [d, e, z] = shelf.items;
  expect(d).toMatchObject({ copyId: dune.copyId, labelled: true, home: false, holder: { kind: "member", person: { id: sam.id } }, collection: { id: home.id, name: "Home library" } });
  expect(e).toMatchObject({ copyId: emma.copyId, labelled: true, home: true });
  expect(z).toMatchObject({ copyId: "c-raw", labelled: false, home: true });
});

test("a copy with a null collection_id shows on its owner's default shelf and in its count", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  await rawUnlabelled("c-null", natalie.id, null, "Old code");
  const home = ok(await ledger.collectionsOf(natalie.id)).collections[0];
  expect(home).toMatchObject({ count: 2, unlabelled: 1 });
  const shelf = ok(await ledger.shelf(home.id));
  const old = shelf.items.find((i) => i.copyId === "c-null")!;
  expect(old.collection).toEqual({ id: home.id, name: "Home library" });
  const v = ok(await ledger.viewCopy("c-null", natalie));
  expect(v.collection).toEqual({ id: home.id, name: "Home library" });
  await env.DB.prepare("delete from copies where id = 'c-null'").run(); // old code's state breaks the invariant by design
});

test("an owner with null-collection copies and no default does not crash the reads", async () => {
  const { ledger } = make();
  await rawUnlabelled("c-orphan", kim.id, null, "Lost");
  expect(ok(await ledger.collectionsOf(kim.id)).collections).toEqual([]);
  expect(ok(await ledger.viewCopy("c-orphan", natalie)).collection).toBeNull();
  await env.DB.prepare("update members set removed_at = 5 where id = ?").bind(kim.id).run();
  expect(ok(await ledger.collectionsOf(kim.id)).collections).toEqual([]);
  expect(ok(await ledger.viewCopy("c-orphan", natalie)).owner?.id).toBe(kim.id);
  await env.DB.prepare("update copies set holder_member_id = ? where id = 'c-orphan'").bind(natalie.id).run();
  expect((await ledger.holding(natalie)).map((i) => i.copyId)).toEqual(["c-orphan"]);
  await env.DB.prepare("delete from copies where id = 'c-orphan'").run(); // old code's state breaks the invariant by design
});

test("a member with no collections gets an empty list", async () => {
  const { ledger } = make();
  expect(ok(await ledger.collectionsOf(kim.id)).collections).toEqual([]);
});

test("a backfilled 32-hex collection id reads like any other", async () => {
  const { ledger } = make();
  const hex = "0123456789abcdef0123456789abcdef";
  await env.DB.prepare("insert into collections (id, owner_id, name, name_key, is_default, created_at) values (?, ?, 'Home library', 'home library', 1, 0)").bind(hex, kim.id).run();
  await rawUnlabelled("c-hex", kim.id, hex, "Hexed");
  expect(ok(await ledger.shelf(hex)).items.map((i) => i.copyId)).toEqual(["c-hex"]);
});

test("no shelf, collections list, holding list, or copy by id contains a label code", async () => {
  const { ledger, codes, dune, atBeach, beach } = await fixture();
  const home = ok(await ledger.collectionsOf(natalie.id)).collections[0];
  const outputs = [
    ok(await ledger.shelf(home.id)),
    ok(await ledger.shelf(beach.id)),
    ok(await ledger.collectionsOf(natalie.id)),
    await ledger.holding(sam),
  ];
  // A copy by id has the CopyView shape, whose `code` is null here. Only its owner gets a code, its own, in `ownerCode`.
  const owners = ok(await ledger.viewCopy(dune.copyId, natalie));
  expect(owners.ownerCode).toBe(codes[0]);
  const byId = [{ ...owners, ownerCode: null }, ok(await ledger.viewCopy(atBeach.copyId, sam))];
  for (const v of byId) {
    expect(v.code).toBeNull();
    expect(v.ownerCode).toBeNull();
    for (const code of codes) expect(JSON.stringify(v)).not.toContain(code);
  }
  const noCodeKey = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.every(noCodeKey);
    if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => k !== "code" && noCodeKey(x));
    return true;
  };
  for (const o of outputs) {
    const json = JSON.stringify(o);
    for (const code of codes) expect(json).not.toContain(code);
    expect(noCodeKey(o)).toBe(true);
  }
  expect(ok(await ledger.viewCopy(dune.copyId, natalie)).code).toBeNull();
});

test("no shelf or holding list contains an email address", async () => {
  const { ledger, beach } = await fixture();
  const home = ok(await ledger.collectionsOf(natalie.id)).collections[0];
  for (const o of [ok(await ledger.shelf(home.id)), ok(await ledger.shelf(beach.id)), await ledger.holding(sam), ok(await ledger.collectionsOf(natalie.id))]) {
    expect(JSON.stringify(o)).not.toContain("@");
  }
});

test("holding lists what Sam holds of Natalie's, with owner and collection, and not Sam's own books", async () => {
  const { ledger, dune, sams } = await fixture();
  const held = await ledger.holding(sam);
  expect(held).toHaveLength(1);
  expect(held[0]).toMatchObject({
    copyId: dune.copyId, book: DUNE, labelled: true, home: false,
    owner: { id: natalie.id, name: "Natalie" }, collection: { name: "Home library" },
    holder: { kind: "member", person: { id: sam.id } },
  });
  expect(held.map((i) => i.copyId)).not.toContain(sams.copyId);
  expect(await ledger.holding(kim)).toEqual([]);
});

test("viewCopy has the collection, no code, and offers return and move to the owner but never claim", async () => {
  const { ledger, dune } = await fixture();
  const v = ok(await ledger.viewCopy(dune.copyId, natalie));
  expect(v.code).toBeNull();
  expect(v.collection).toMatchObject({ name: "Home library" });
  expect(v.actions).toEqual(["return", "move", "relabel"]);
  expect(v.actions).not.toContain("claim");
  expect(v.history.length).toBeGreaterThan(0);
});

test("viewCopy offers label to the owner of an unlabelled copy", async () => {
  const { ledger } = await fixture();
  const v = ok(await ledger.viewCopy("c-raw", natalie));
  expect(v.actions).toEqual(["move", "label"]);
  expect(v.code).toBeNull();
});

test("viewCopy never offers claim to someone else either", async () => {
  const { ledger, emma } = await fixture();
  expect(ok(await ledger.viewCopy(emma.copyId, kim)).actions).toEqual([]);
});

test("a member viewing a friend's copy sees its collection", async () => {
  const { ledger, atBeach, dune, beach } = await fixture();
  expect(ok(await ledger.viewCopy(atBeach.copyId, sam)).collection).toEqual({ id: beach.id, name: "Beach house" });
  expect(ok(await ledger.viewCopy(dune.copyId, kim)).collection).toMatchObject({ name: "Home library" });
});

test("a copy's label view for a member carries its collection, home or out", async () => {
  const { ledger, codes } = await fixture();
  expect(asCopy(await ledger.view(codes[0], kim)).collection).toMatchObject({ name: "Home library" });
  expect(asCopy(await ledger.view(codes[2], kim)).collection).toMatchObject({ name: "Beach house" });
});

test("the public label view has no collection and no names", async () => {
  const { ledger, codes } = await fixture();
  expect(await ledger.view(codes[2], null)).toEqual({ kind: "public", code: codes[2], book: { title: "Sand", authors: ["A"], coverUrl: null } });
});

test.each(["shelf", "collectionsOf", "viewCopy"] as const)("%s of something unknown is not-found", async (name) => {
  const { ledger } = make();
  const r = name === "viewCopy" ? await ledger.viewCopy("nope", natalie) : await ledger[name]("nope");
  expect(r).toEqual({ rejected: "not-found" });
});

test("a shelf is its own collection's: the header is the one asked for, while others exist", async () => {
  const { ledger, beach } = await fixture();
  const s = ok(await ledger.shelf(beach.id));
  expect(s.collection.id).toBe(beach.id);
  expect(s.collection.name).toBe("Beach house");
  expect(s.owner.id).toBe(natalie.id);
  const samHome = ok(await ledger.collectionsOf(sam.id)).collections[0];
  const sh = ok(await ledger.shelf(samHome.id));
  expect(sh.owner).toMatchObject({ id: sam.id, name: "Sam" });
  expect(sh.collection.id).toBe(samHome.id);
  expect(await ledger.shelf("nope")).toEqual({ rejected: "not-found" });
});

test("a null-collection copy is in its own owner's default, not another member's", async () => {
  const { ledger, sams } = await fixture();
  await rawUnlabelled("c-sam-null", sam.id, null, "Sam old");
  const natHome = ok(await ledger.collectionsOf(natalie.id)).collections[0];
  const samHome = ok(await ledger.collectionsOf(sam.id)).collections[0];
  expect(samHome).toMatchObject({ count: 2, unlabelled: 1 });
  expect(natHome.count).toBe(3);
  expect(ok(await ledger.shelf(samHome.id)).items.map((i) => i.copyId).sort()).toEqual([sams.copyId, "c-sam-null"].sort());
  expect(ok(await ledger.shelf(natHome.id)).items.map((i) => i.copyId)).not.toContain("c-sam-null");
  await env.DB.prepare("delete from copies where id = 'c-sam-null'").run();
});

test("a null-collection copy of an owner with no default is on no shelf", async () => {
  const { ledger } = await fixture();
  await rawUnlabelled("c-kim-null", kim.id, null, "Kim old");
  for (const m of [natalie, sam]) {
    for (const k of ok(await ledger.collectionsOf(m.id)).collections) {
      expect(ok(await ledger.shelf(k.id)).items.map((i) => i.copyId)).not.toContain("c-kim-null");
    }
  }
  await env.DB.prepare("delete from copies where id = 'c-kim-null'").run();
});

test("a null-collection copy is in the owner's default, not their first collection", async () => {
  const { ledger } = make();
  const zoo = ok(await ledger.createCollection(kim, "Zoo")); // first made: the default
  const attic = ok(await ledger.createCollection(kim, "Attic"));
  ok(await ledger.makeDefault(kim, attic.id));
  await rawUnlabelled("c-k", kim.id, null, "Old");
  const list = ok(await ledger.collectionsOf(kim.id)).collections;
  expect(list.map((c) => [c.name, c.count])).toEqual([["Attic", 1], ["Zoo", 0]]);
  expect(ok(await ledger.viewCopy("c-k", kim)).collection).toEqual({ id: attic.id, name: "Attic" });
  expect(ok(await ledger.shelf(zoo.id)).items).toEqual([]);
  await env.DB.prepare("delete from copies where id = 'c-k'").run();
});

test("viewCopy on an ownerless copy has no collection", async () => {
  const { ledger } = make();
  await env.DB.batch([
    env.DB.prepare("insert into books (id, isbn, title, authors, cover_url, created_at) values ('b-o', null, 'Free', '[]', null, 0)"),
    env.DB.prepare("insert into copies (id, book_id, owner_id, holder_member_id, created_at, collection_id) values ('c-free', 'b-o', null, null, 0, null)"),
  ]);
  const v = ok(await ledger.viewCopy("c-free", natalie));
  expect(v.collection).toBeNull();
  expect(v.owner).toBeNull();
});

test("shelf, collection counts and the by-id join are served from copies_collection_id_idx", async () => {
  const plan = async (sql: string, ...binds: string[]) =>
    ((await env.DB.prepare(`explain query plan ${sql}`).bind(...binds).all<{ detail: string }>()).results.map((r) => r.detail)).join("\n");
  const { SHELF_SELECT, inCollection } = await import("./shelves");
  expect(await plan(`${SHELF_SELECT} where k.id = ?`, "x")).toMatch(/copies_collection_id_idx/);
  expect(await plan(`select count(*) from copies c, collections k where k.id = ? and ${inCollection("c", "k")}`, "x")).toMatch(/copies_collection_id_idx/);
});
