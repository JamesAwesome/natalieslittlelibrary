import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test } from "vitest";
import { resetDatabase } from "../../../test/reset";
import { invariantViolations } from "../../../test/invariant";
import { asCopy, count, homeCopy, insertMembers, kim, make, mint, natalie, ok, sam } from "../../../test/ledger-fixtures";

beforeEach(async () => {
  await resetDatabase(env.DB);
  await insertMembers();
});
afterEach(async () => {
  expect(await invariantViolations(env.DB)).toEqual([]);
});

const snapshot = async () =>
  JSON.stringify(await Promise.all(["copies", "events", "people"].map(async (t) => (await env.DB.prepare(`select * from ${t} order by 1`).all()).results)));

async function lendTo(ledger: ReturnType<typeof make>["ledger"], name: string, copyId: string, by = natalie) {
  return ok(await ledger.act(by, { type: "lend", copyId, to: { name } }));
}

test("people lists only the member's own placeholders, with what each holds", async () => {
  const { ledger } = make();
  const { copyId } = await homeCopy(ledger);
  await lendTo(ledger, "Sarah", copyId);
  const [code2] = await mint(ledger);
  const emma = ok(await ledger.add(natalie, { code: code2, book: { isbn: "9780141439587" } }));
  await lendTo(ledger, "Abe", emma.copyId);
  const [code3] = await mint(ledger);
  const k = ok(await ledger.add(kim, { code: code3, book: { isbn: "9780441172719" } }));
  await lendTo(ledger, "Zed", k.copyId, kim);

  const mine = await ledger.people(natalie);
  expect(mine.map((p) => p.name)).toEqual(["Abe", "Sarah"]);
  expect(mine[1].linked).toBeNull();
  expect(mine[1].holding.map((i) => i.copyId)).toEqual([copyId]);
  expect(mine[0].holding.map((i) => i.book.title)).toEqual(["Emma"]);
  expect((await ledger.people(kim)).map((p) => p.name)).toEqual(["Zed"]);
  expect(await ledger.people(sam)).toEqual([]);
});

test("a placeholder holding a copy with no owner still lists it", async () => {
  const { ledger } = make();
  const { copyId } = await homeCopy(ledger);
  await lendTo(ledger, "Sarah", copyId);
  await env.DB.prepare("update copies set owner_id = null, collection_id = null where id = ?").bind(copyId).run();
  const [sarah] = await ledger.people(natalie);
  expect(sarah.holding).toHaveLength(1);
  expect(sarah.holding[0]).toMatchObject({ copyId, owner: null });
});

test("rename", async () => {
  const { ledger } = make();
  const a = await homeCopy(ledger);
  await lendTo(ledger, "Sarah", a.copyId);
  const [code2] = await mint(ledger);
  const b = ok(await ledger.add(natalie, { code: code2, book: { isbn: "9780141439587" } }));
  await lendTo(ledger, "Abe", b.copyId);
  const [abe, sarah] = await ledger.people(natalie);

  expect(await ledger.renamePerson(kim, sarah.id, "Sally")).toEqual({ rejected: "not-found" });
  expect(await ledger.renamePerson(natalie, "nope", "Sally")).toEqual({ rejected: "not-found" });
  expect(await ledger.renamePerson(natalie, sarah.id, " abe ")).toEqual({ rejected: "name-taken" });
  for (const bad of ["", "   ", "a\u0000b", "x".repeat(61), 5 as unknown as string]) {
    expect(await ledger.renamePerson(natalie, sarah.id, bad)).toEqual({ rejected: "invalid" });
  }
  expect((await ledger.people(natalie)).map((p) => p.name)).toEqual(["Abe", "Sarah"]);

  const renamed = ok(await ledger.renamePerson(natalie, sarah.id, "  Sally "));
  expect(renamed).toMatchObject({ id: sarah.id, name: "Sally" });
  expect(renamed.holding).toHaveLength(1);
  // A change of case alone is not a clash with oneself.
  expect(ok(await ledger.renamePerson(natalie, abe.id, "ABE")).name).toBe("ABE");
  // Kim may use the name Natalie has.
  expect(await lendTo(ledger, "Sally", (await homeCopyFor(ledger, kim)).copyId, kim)).toBeTruthy();
  expect(await count("people")).toBe(3);
});

async function homeCopyFor(ledger: ReturnType<typeof make>["ledger"], owner: typeof kim) {
  const [code] = (await ledger.mintLabels(owner, 1)) as { code: string }[];
  return ok(await ledger.add(owner, { code: code.code, book: { isbn: "9780441172719" } }));
}

test("link moves every copy the placeholder holds to the member, whoever owns it", async () => {
  const { ledger } = make();
  const { code, copyId } = await homeCopy(ledger);
  await lendTo(ledger, "Sarah", copyId);
  ok(await ledger.act(natalie, { type: "give", copyId, to: kim.id }));
  const events = async () => (await env.DB.prepare("select * from events order by id").all()).results;
  const before = await events();
  const [sarah] = await ledger.people(natalie);
  expect(sarah.holding[0].owner).toMatchObject({ id: kim.id });

  const linked = ok(await ledger.linkPerson(natalie, sarah.id, sam.id));
  expect(linked.linked).toMatchObject({ id: sam.id, name: "Sam" });
  expect(linked.holding).toEqual([]);
  const row = await env.DB.prepare("select owner_id, holder_member_id, holder_person_id from copies where id = ?").bind(copyId).first();
  expect(row).toEqual({ owner_id: kim.id, holder_member_id: sam.id, holder_person_id: null });
  expect(await events()).toEqual(before);

  const view = asCopy(await ledger.view(code, kim));
  expect(view.holder).toMatchObject({ kind: "member", person: { id: sam.id } });
  const lent = view.history.find((h) => h.type === "lent")!;
  expect(lent.subject).toMatchObject({ kind: "member", person: { id: sam.id } });
  expect((await ledger.holding(sam)).map((i) => i.copyId)).toEqual([copyId]);
  expect((await ledger.people(natalie))[0].linked).toMatchObject({ id: sam.id });
});

test("link refuses and changes nothing", async () => {
  const { ledger } = make();
  const { copyId } = await homeCopy(ledger);
  await lendTo(ledger, "Sarah", copyId);
  const [sarah] = await ledger.people(natalie);
  const before = await snapshot();

  expect(await ledger.linkPerson(natalie, sarah.id, natalie.id)).toEqual({ rejected: "not-allowed" });
  expect(await ledger.linkPerson(kim, sarah.id, sam.id)).toEqual({ rejected: "not-allowed" });
  expect(await ledger.linkPerson(natalie, sarah.id, "m-nobody")).toEqual({ rejected: "not-allowed" });
  await env.DB.prepare("update members set removed_at = 5 where id = ?").bind(kim.id).run();
  expect(await ledger.linkPerson(natalie, sarah.id, kim.id)).toEqual({ rejected: "not-allowed" });
  expect(await snapshot()).toBe(before);

  ok(await ledger.linkPerson(natalie, sarah.id, sam.id));
  const after = await snapshot();
  expect(await ledger.linkPerson(natalie, sarah.id, sam.id)).toEqual({ rejected: "not-allowed" });
  expect(await snapshot()).toBe(after);
});

test("requests lists open requests on my copies, newest first, and nothing once answered", async () => {
  const { ledger } = make();
  const a = await homeCopy(ledger);
  const [code2] = await mint(ledger);
  const b = ok(await ledger.add(natalie, { code: code2, book: { isbn: "9780141439587" } }));
  ok(await ledger.act(sam, { type: "claim", code: a.code }));
  ok(await ledger.act(kim, { type: "claim", code: code2 }));
  let t = 1000;
  const later = make({ now: () => ++t }).ledger;
  ok(await later.act(sam, { type: "request", copyId: a.copyId }));
  ok(await later.act(kim, { type: "request", copyId: b.copyId }));

  const list = await ledger.requests(natalie);
  expect(list.map((r) => [r.copyId, r.by.id, r.book.title])).toEqual([
    [b.copyId, kim.id, "Emma"],
    [a.copyId, sam.id, "Dune"],
  ]);
  expect(list[0].at).toBeGreaterThan(list[1].at);
  expect(await ledger.requests(sam)).toEqual([]);

  await env.DB.prepare("update members set removed_at = 5 where id = ?").bind(kim.id).run();
  expect((await ledger.requests(natalie)).map((r) => r.copyId)).toEqual([a.copyId]);

  ok(await ledger.act(natalie, { type: "decline", copyId: a.copyId }));
  expect(await ledger.requests(natalie)).toEqual([]);
});
