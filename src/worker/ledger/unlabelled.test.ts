import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { BookInfo, ImportRow } from "../../shared/types";
import { LookupUnavailable } from "../booklookup";
import { resetDatabase } from "../../../test/reset";
import { invariantViolations } from "../../../test/invariant";
import { gated, racing, run } from "../../../test/racing";
import { DUNE, EMMA, asCopy, count, insertMembers, make, mint, natalie, ok, sam } from "../../../test/ledger-fixtures";

beforeEach(async () => {
  await resetDatabase(env.DB);
  await insertMembers();
});

afterEach(async () => {
  expect(await invariantViolations(env.DB)).toEqual([]);
});

const row = (title: string, isbn: string | null = null, authors: string[] = ["A. Author"]): ImportRow => ({ title, authors, isbn });
const MISSED = "9780306406157"; // a valid ISBN-13 the lookup does not know

const found = (...books: BookInfo[]) => async () => new Map(books.map((b) => [b.isbn!, b]));

async function copiesOf(ownerId: string) {
  const { results } = await env.DB.prepare(
    `select c.id, c.owner_id, c.holder_member_id, c.collection_id, c.import_isbn, b.isbn, b.title, b.cover_url,
       (select count(*) from labels l where l.copy_id = c.id) as labels
     from copies c join books b on b.id = c.book_id where c.owner_id = ? order by b.title`,
  ).bind(ownerId).all<{ id: string; owner_id: string; holder_member_id: string; collection_id: string; import_isbn: string | null; isbn: string | null; title: string; cover_url: string | null; labels: number }>();
  return results;
}

test("an import adds unlabelled copies owned and held by the importer, in the chosen collection, each with one added event", async () => {
  const { ledger } = make();
  const beach = ok(await ledger.createCollection(natalie, "Beach house"));
  const r = ok(await ledger.importCopies(natalie, { collectionId: beach.id, rows: [row("Alpha"), row("Beta")] }));
  expect(r).toEqual({ added: 2, skipped: 0 });
  const copies = await copiesOf(natalie.id);
  expect(copies.map((c) => [c.title, c.holder_member_id, c.collection_id, c.labels])).toEqual([
    ["Alpha", natalie.id, beach.id, 0],
    ["Beta", natalie.id, beach.id, 0],
  ]);
  const { results } = await env.DB.prepare("select copy_id, type, actor_id from events").all<{ copy_id: string; type: string; actor_id: string }>();
  expect(results.map((e) => [e.type, e.actor_id]).sort()).toEqual([["added", natalie.id], ["added", natalie.id]]);
  expect(new Set(results.map((e) => e.copy_id)).size).toBe(2);
});

test("an import with no collection goes into the default, creating Home library", async () => {
  const { ledger } = make();
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Alpha")] }));
  const k = await env.DB.prepare("select id, name, is_default from collections where owner_id = ?").bind(natalie.id).all<{ id: string; name: string; is_default: number }>();
  expect(k.results.map((c) => [c.name, c.is_default])).toEqual([["Home library", 1]]);
  expect((await copiesOf(natalie.id))[0].collection_id).toBe(k.results[0].id);
});

test("a found ISBN uses the lookup's facts and cover; a missed one keeps the CSV title on a book with no ISBN and the ISBN on the copy", async () => {
  const { ledger, lookupMany } = make();
  lookupMany.mockImplementation(found(DUNE));
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("dune (csv)", DUNE.isbn), row("Left Behind", MISSED, ["T. L."])] }));
  const copies = await copiesOf(natalie.id);
  const dune = copies.find((c) => c.import_isbn === DUNE.isbn)!;
  expect([dune.isbn, dune.title, dune.cover_url]).toEqual([DUNE.isbn, "Dune", DUNE.coverUrl]);
  const missed = copies.find((c) => c.import_isbn === MISSED)!;
  expect([missed.isbn, missed.title]).toEqual([null, "Left Behind"]);
  expect(await env.DB.prepare("select count(*) as n from books where isbn = ?").bind(MISSED).first<{ n: number }>()).toEqual({ n: 0 });
});

test("an ISBN already in books is not looked up", async () => {
  const { ledger, lookupMany } = make();
  const [code] = await mint(ledger);
  ok(await ledger.add(sam, { code, book: { isbn: DUNE.isbn! } }));
  lookupMany.mockImplementation(found(EMMA));
  const r = ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Dune", DUNE.isbn), row("Emma", EMMA.isbn)] }));
  expect(r).toEqual({ added: 2, skipped: 0 });
  expect(lookupMany).toHaveBeenCalledTimes(1);
  expect(lookupMany.mock.calls[0][0]).toEqual([EMMA.isbn]);
  expect((await copiesOf(natalie.id)).map((c) => c.isbn)).toEqual([DUNE.isbn, EMMA.isbn]);
});

test("lookupMany is called once per chunk", async () => {
  const { ledger, lookupMany } = make();
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("A", DUNE.isbn), row("B", EMMA.isbn), row("C", MISSED), row("D")] }));
  expect(lookupMany).toHaveBeenCalledTimes(1);
  expect([...lookupMany.mock.calls[0][0]].sort()).toEqual([DUNE.isbn, EMMA.isbn, MISSED].sort());
});

test("a cover from lookupMany that is not https on covers.openlibrary.org is stored as null", async () => {
  const { ledger, lookupMany } = make();
  lookupMany.mockImplementation(found({ ...DUNE, coverUrl: "http://evil.test/c.jpg" }));
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Dune", DUNE.isbn)] }));
  expect((await copiesOf(natalie.id))[0].cover_url).toBeNull();
});

test("importing the same rows again adds nothing and reports them skipped", async () => {
  const { ledger, lookupMany } = make();
  lookupMany.mockImplementation(found(DUNE));
  const rows = [row("Dune", DUNE.isbn), row("Left Behind", MISSED), row("No Isbn Book", null, ["X", "Y"])];
  expect(ok(await ledger.importCopies(natalie, { collectionId: null, rows }))).toEqual({ added: 3, skipped: 0 });
  expect(ok(await ledger.importCopies(natalie, { collectionId: null, rows }))).toEqual({ added: 0, skipped: 3 });
  expect(await count("copies")).toBe(3);
  expect(await count("events")).toBe(3);
  expect(await count("books")).toBe(3); // no orphan title-only book from the skipped rows
});

test("a repeated row within one chunk is added once", async () => {
  const { ledger } = make();
  const r = ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Same"), row("Same"), row("Other", MISSED), row("Other", MISSED)] }));
  expect(r).toEqual({ added: 2, skipped: 2 });
  expect(await count("books")).toBe(2);
});

test("a row matching a copy Natalie paired by scanning is skipped", async () => {
  const { ledger } = make();
  const [code, code2] = await mint(ledger, 2);
  ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  ok(await ledger.add(natalie, { code: code2, book: { title: "Typed", authors: ["Z"] } }));
  const r = ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Dune (edition)", DUNE.isbn), row("Typed", null, ["Z"]), row("Typed", null, ["Other"])] }));
  expect(r).toEqual({ added: 1, skipped: 2 });
});

test("two identical chunks at once add each book once", async () => {
  const db = gated(2);
  const a = make({ db }).ledger;
  const b = make({ db }).ledger;
  const rows = [row("One"), row("Two", MISSED)];
  const [x, y] = await Promise.all([a.importCopies(natalie, { collectionId: null, rows }), b.importCopies(natalie, { collectionId: null, rows })]);
  const added = [ok(x).added, ok(y).added].sort();
  expect(added).toEqual([0, 2]);
  expect(await count("copies")).toBe(2);
  expect(await count("books")).toBe(2);
});

test("a chunk of 21 rows, or a row with a 301-character title or an ISBN that isn't one, is invalid and writes nothing", async () => {
  const { ledger, lookupMany } = make();
  const bad: ImportRow[][] = [
    Array.from({ length: 21 }, (_, i) => row("T" + i)),
    [],
    [row("ok"), row("x".repeat(301))],
    [row("ok"), row("t", "9780306406158")],
    [row("ok"), { title: "t", authors: Array.from({ length: 11 }, () => "a"), isbn: null }],
    [row("ok"), { title: "t", authors: ["a".repeat(201)], isbn: null }],
    [row("ok"), { title: "t", authors: [""], isbn: null }],
    [row("ok"), { title: "t", authors: ["a"] } as unknown as ImportRow],
  ];
  for (const rows of bad) {
    expect(await ledger.importCopies(natalie, { collectionId: null, rows })).toEqual({ rejected: "invalid" });
  }
  expect(await ledger.importCopies(natalie, { collectionId: null, rows: "nope" as unknown as ImportRow[] })).toEqual({ rejected: "invalid" });
  expect(await count("copies")).toBe(0);
  expect(await count("books")).toBe(0);
  expect(await count("collections")).toBe(0);
  expect(lookupMany).not.toHaveBeenCalled();
});

test("a chunk of 20 rows is accepted", async () => {
  const { ledger } = make();
  const rows = Array.from({ length: 20 }, (_, i) => row("T" + i));
  expect(ok(await ledger.importCopies(natalie, { collectionId: null, rows }))).toEqual({ added: 20, skipped: 0 });
  expect(await count("copies")).toBe(20);
});

test("an import into Sam's collection is not-found and writes nothing", async () => {
  const { ledger } = make();
  const sams = ok(await ledger.createCollection(sam, "Sam's"));
  expect(await ledger.importCopies(natalie, { collectionId: sams.id, rows: [row("A")] })).toEqual({ rejected: "not-found" });
  expect(await ledger.importCopies(natalie, { collectionId: "nope", rows: [row("A")] })).toEqual({ rejected: "not-found" });
  expect(await count("copies")).toBe(0);
  expect(await count("books")).toBe(0);
});

test("an import into a collection deleted after the read adds nothing and is not-found", async () => {
  const setup = make();
  const beach = ok(await setup.ledger.createCollection(natalie, "Beach house"));
  const { ledger } = make({ db: racing(run("delete from collections where id = ?", beach.id)) });
  expect(await ledger.importCopies(natalie, { collectionId: beach.id, rows: [row("A"), row("B", MISSED)] })).toEqual({ rejected: "not-found" });
  expect(await count("copies")).toBe(0);
  expect(await count("books")).toBe(0);
});

test("a removed importer adds nothing and is not-allowed", async () => {
  const { ledger } = make({ db: racing(run("update members set removed_at = 5 where id = ?", natalie.id)) });
  expect(await ledger.importCopies(natalie, { collectionId: null, rows: [row("A")] })).toEqual({ rejected: "not-allowed" });
  expect(await count("copies")).toBe(0);
});

test("Sam's import of the same ISBN does not skip because Natalie owns it", async () => {
  const { ledger, lookupMany } = make();
  lookupMany.mockImplementation(found(DUNE));
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Dune", DUNE.isbn), row("Left", MISSED), row("Plain")] }));
  const r = ok(await ledger.importCopies(sam, { collectionId: null, rows: [row("Dune", DUNE.isbn), row("Left", MISSED), row("Plain")] }));
  expect(r).toEqual({ added: 3, skipped: 0 });
  expect((await copiesOf(sam.id)).length).toBe(3);
});

test("scanning an imported ISBN binds the label to the imported copy: no lookup, no new copy, history added then labelled", async () => {
  const { ledger, lookup, lookupMany } = make();
  lookupMany.mockImplementation(found(DUNE));
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Dune", DUNE.isbn)] }));
  const [code] = await mint(ledger);
  const copy = ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  expect(lookup).not.toHaveBeenCalled();
  expect(await count("copies")).toBe(1);
  expect(copy.code).toBe(code);
  expect(copy.history.map((h) => h.type)).toEqual(["labelled", "added"]);
  expect((await copiesOf(natalie.id))[0].labels).toBe(1);
});

test("scanning an ISBN known only as import_isbn, which the lookup still misses, binds the title-only copy", async () => {
  const { ledger, lookup } = make();
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Left Behind", MISSED)] }));
  const [code] = await mint(ledger);
  const copy = ok(await ledger.add(natalie, { code, book: { isbn: MISSED } }));
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(await count("copies")).toBe(1);
  expect([copy.book.isbn, copy.book.title, copy.code]).toEqual([null, "Left Behind", code]);
});

test("scanning an imported miss that the lookup now finds re-points the copy at the ISBN's book", async () => {
  const { ledger, lookup } = make();
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("dune (csv)", DUNE.isbn)] })); // lookupMany missed
  expect((await copiesOf(natalie.id))[0].isbn).toBeNull();
  const [code] = await mint(ledger);
  const copy = ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(copy.book).toEqual(DUNE);
  expect(copy.history.map((h) => h.type)).toEqual(["labelled", "added"]);
  expect(await count("copies")).toBe(1);
  expect(await count("books")).toBe(1); // the title-only book is gone, not orphaned
  const c = (await copiesOf(natalie.id))[0];
  expect([c.isbn, c.import_isbn, c.labels]).toEqual([DUNE.isbn, DUNE.isbn, 1]);
});

test("scanning an imported miss reuses an ISBN book that already exists, and survives a lookup that throws", async () => {
  const { ledger, lookup } = make();
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("dune (csv)", DUNE.isbn), row("emma (csv)", EMMA.isbn)] }));
  const [c1, c2, c3] = await mint(ledger, 3);
  ok(await ledger.add(sam, { code: c3, book: { isbn: DUNE.isbn! } })); // the ISBN book now exists
  lookup.mockClear();
  expect(ok(await ledger.add(natalie, { code: c1, book: { isbn: DUNE.isbn! } })).book).toEqual(DUNE);
  expect(await env.DB.prepare("select count(*) as n from books where isbn = ?").bind(DUNE.isbn).first<{ n: number }>()).toEqual({ n: 1 });
  lookup.mockImplementation(async () => { throw new Error("down"); });
  const emma = ok(await ledger.add(natalie, { code: c2, book: { isbn: EMMA.isbn! } }));
  expect([emma.book.isbn, emma.book.title]).toEqual([null, "emma (csv)"]);
});

test("an import whose lookup is unavailable is refused and writes nothing; the retry stores the facts", async () => {
  const { ledger, lookupMany } = make();
  lookupMany.mockImplementation(async () => { throw new LookupUnavailable(); });
  const rows = [row("Dune", DUNE.isbn), row("Plain")];
  expect(await ledger.importCopies(natalie, { collectionId: null, rows })).toEqual({ rejected: "unavailable" });
  expect(await count("copies")).toBe(0);
  expect(await count("books")).toBe(0);
  expect(await count("events")).toBe(0);
  lookupMany.mockImplementation(found(DUNE));
  expect(ok(await ledger.importCopies(natalie, { collectionId: null, rows }))).toEqual({ added: 2, skipped: 0 });
  const dune = (await copiesOf(natalie.id)).find((c) => c.import_isbn === DUNE.isbn)!;
  expect([dune.isbn, dune.title, dune.cover_url]).toEqual([DUNE.isbn, "Dune", DUNE.coverUrl]);
});

test("a re-import does not ask the lookup about ISBNs the importer already holds", async () => {
  const { ledger, lookupMany } = make();
  lookupMany.mockImplementation(found(DUNE));
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Dune", DUNE.isbn), row("Left", MISSED)] }));
  expect(lookupMany).toHaveBeenCalledTimes(1);
  lookupMany.mockClear();
  expect(ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Dune", DUNE.isbn), row("Left", MISSED)] }))).toEqual({ added: 0, skipped: 2 });
  expect(lookupMany).not.toHaveBeenCalled();
  // a new ISBN beside held ones: only the new one is asked (a held-by-import_isbn one included)
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Left", MISSED), row("Emma", EMMA.isbn)] }));
  expect(lookupMany.mock.calls.map((c) => c[0])).toEqual([[EMMA.isbn]]);
});

test("an import that lands between add's read and its write: the label goes on the imported copy, not a second one", async () => {
  const setup = make();
  const [code] = await mint(setup.ledger);
  const importer = make();
  importer.lookupMany.mockImplementation(found(DUNE));
  const { ledger } = make({ db: racing(() => importer.ledger.importCopies(natalie, { collectionId: null, rows: [row("Dune", DUNE.isbn)] })) });
  const v = ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  expect(await count("copies")).toBe(1);
  expect(v.code).toBe(code);
  expect(v.history.map((h) => h.type)).toEqual(["labelled", "added"]);
  expect((await copiesOf(natalie.id))[0].labels).toBe(1);
});

test("an import by a member who already has a default, removed in a race, is not-allowed and writes no copy", async () => {
  ok(await make().ledger.importCopies(natalie, { collectionId: null, rows: [row("First")] }));
  const { ledger } = make({ db: racing(run("update members set removed_at = 5 where id = ?", natalie.id)) });
  expect(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Second"), row("Third", MISSED)] })).toEqual({ rejected: "not-allowed" });
  expect(await count("copies")).toBe(1);
  expect(await count("books")).toBe(1);
});

test("scanning binds the oldest unlabelled copy and ignores the picked collection", async () => {
  const { ledger, lookupMany } = make();
  lookupMany.mockImplementation(found(DUNE));
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Dune", DUNE.isbn)] }));
  const beach = ok(await ledger.createCollection(natalie, "Beach house"));
  const [c1, c2] = await mint(ledger, 2);
  const first = ok(await ledger.add(natalie, { code: c1, book: { isbn: DUNE.isbn! }, collectionId: beach.id }));
  expect(first.collection?.name).toBe("Home library");
  expect(await count("copies")).toBe(1);
  // now the only copy is labelled, so the next scan makes a new copy
  const second = ok(await ledger.add(natalie, { code: c2, book: { isbn: DUNE.isbn! } }));
  expect(second.copyId).not.toBe(first.copyId);
  expect(await count("copies")).toBe(2);
});

test("a scan does not bind Sam's imported copy, and two scans race for one copy", async () => {
  const setup = make();
  ok(await setup.ledger.importCopies(sam, { collectionId: null, rows: [row("Left", MISSED)] }));
  const [c1, c2] = await mint(setup.ledger, 2);
  const mine = await setup.ledger.add(natalie, { code: c1, book: { isbn: MISSED } });
  expect(mine).toEqual({ rejected: "book-not-found" });
  ok(await setup.ledger.importCopies(natalie, { collectionId: null, rows: [row("Left", MISSED)] }));
  const db = gated(2);
  const a = make({ db }).ledger;
  const b = make({ db }).ledger;
  const [x, y] = await Promise.all([a.add(natalie, { code: c1, book: { isbn: MISSED } }), b.add(natalie, { code: c2, book: { isbn: MISSED } })]);
  const out = [x, y].map((r) => ("rejected" in r ? r.rejected : "ok")).sort();
  expect(out).toEqual(["not-allowed", "ok"]);
  expect(await count("copies")).toBe(2);
});

async function importedUnlabelled(ledger: ReturnType<typeof make>["ledger"], title = "Left Behind") {
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row(title)] }));
  return (await copiesOf(natalie.id)).find((c) => c.title === title)!.id;
}

test("labelCopy binds a label to an unlabelled copy the owner picked", async () => {
  const { ledger } = make();
  const id = await importedUnlabelled(ledger);
  const [code] = await mint(ledger);
  const v = ok(await ledger.labelCopy(natalie, id, code));
  expect(v.code).toBe(code);
  expect(v.copyId).toBe(id);
  expect(v.history.map((h) => h.type)).toEqual(["labelled", "added"]);
  const again = await ledger.view(code, natalie);
  expect(asCopy(again).copyId).toBe(id);
});

test("labelCopy accepts a pasted link", async () => {
  const { ledger } = make();
  const id = await importedUnlabelled(ledger);
  const [code] = await mint(ledger);
  expect(ok(await ledger.labelCopy(natalie, id, `https://books.test/b/${code}`)).code).toBe(code);
});

test("labelCopy refuses an unminted code, a bound code, and bad input", async () => {
  const { ledger } = make();
  const id = await importedUnlabelled(ledger);
  const [code, other] = await mint(ledger, 2);
  expect(await ledger.labelCopy(natalie, id, "ZZZZZZZZZZ")).toEqual({ rejected: "label-unknown" });
  expect(await ledger.labelCopy(natalie, id, "x")).toEqual({ rejected: "label-unknown" });
  ok(await ledger.add(natalie, { code: other, book: { title: "Typed", authors: [] } }));
  expect(await ledger.labelCopy(natalie, id, other)).toEqual({ rejected: "label-in-use" });
  expect(await ledger.labelCopy(natalie, 5 as unknown as string, code)).toEqual({ rejected: "invalid" });
  expect(await count("events")).toBe(3); // the import's added, plus the typed add's added and labelled
});

test("labelCopy on a copy that already has a label is not-allowed; on someone else's copy, not-allowed; on a missing one, not-found", async () => {
  const { ledger } = make();
  const id = await importedUnlabelled(ledger);
  const [c1, c2, c3] = await mint(ledger, 3);
  ok(await ledger.labelCopy(natalie, id, c1));
  expect(await ledger.labelCopy(natalie, id, c2)).toEqual({ rejected: "not-allowed" });
  expect(await ledger.labelCopy(sam, id, c2)).toEqual({ rejected: "not-allowed" });
  const id2 = await importedUnlabelled(ledger, "Second");
  expect(await ledger.labelCopy(sam, id2, c3)).toEqual({ rejected: "not-allowed" });
  expect(await ledger.labelCopy(natalie, "no-such-copy", c3)).toEqual({ rejected: "not-found" });
  const blank = await env.DB.prepare("select copy_id from labels where code in (?, ?)").bind(c2, c3).all<{ copy_id: string | null }>();
  expect(blank.results.map((r) => r.copy_id)).toEqual([null, null]);
});

test("labelCopy by a removed member is not-allowed and changes nothing", async () => {
  const { ledger } = make({ db: racing(run("update members set removed_at = 5 where id = ?", natalie.id)) });
  const id = await importedUnlabelled(make().ledger);
  const [code] = await mint(make().ledger);
  expect(await ledger.labelCopy(natalie, id, code)).toEqual({ rejected: "not-allowed" });
  expect((await env.DB.prepare("select copy_id from labels where code = ?").bind(code).first<{ copy_id: string | null }>())!.copy_id).toBeNull();
});

test("two labels for one copy at once: one binds, one is refused, the other label stays blank", async () => {
  const setup = make();
  const id = await importedUnlabelled(setup.ledger);
  const [c1, c2] = await mint(setup.ledger, 2);
  const db = gated(2);
  const [x, y] = await Promise.all([make({ db }).ledger.labelCopy(natalie, id, c1), make({ db }).ledger.labelCopy(natalie, id, c2)]);
  const out = [x, y].map((r) => ("rejected" in r ? r.rejected : "ok")).sort();
  expect(out).toEqual(["not-allowed", "ok"]);
  const bound = await env.DB.prepare("select count(*) as n from labels where copy_id = ?").bind(id).first<{ n: number }>();
  expect(bound!.n).toBe(1);
  expect(await count("events")).toBe(2); // added, labelled
});

test("one label for two copies at once: one binds, one is label-in-use", async () => {
  const setup = make();
  const id1 = await importedUnlabelled(setup.ledger, "First");
  const id2 = await importedUnlabelled(setup.ledger, "Second");
  const [code] = await mint(setup.ledger);
  const db = gated(2);
  const [x, y] = await Promise.all([make({ db }).ledger.labelCopy(natalie, id1, code), make({ db }).ledger.labelCopy(natalie, id2, code)]);
  const out = [x, y].map((r) => ("rejected" in r ? r.rejected : "ok")).sort();
  expect(out).toEqual(["label-in-use", "ok"]);
  expect(await count("events")).toBe(3);
});

test("candidates finds the same-ISBN copy and title matches across editions", async () => {
  const { ledger, lookupMany } = make();
  lookupMany.mockImplementation(found(DUNE));
  const rows = [
    row("Dune: Deluxe Edition"),
    row("DUNE", DUNE.isbn),
    row("The Left Hand of Darkness"),
    row("Dune Messiah"),
    row("Other"),
  ];
  ok(await ledger.importCopies(natalie, { collectionId: null, rows }));
  const c = ok(await ledger.candidates(natalie, { isbn: DUNE.isbn!, title: "Dune" }));
  expect(c.sameIsbn?.book.isbn).toBe(DUNE.isbn);
  expect(c.sameIsbn?.labelled).toBe(false);
  expect(c.similar.map((s) => s.book.title)).toEqual(["Dune: Deluxe Edition"]);
  const d = ok(await ledger.candidates(natalie, { title: "the left-hand of darkness" }));
  expect(d.sameIsbn).toBeNull();
  expect(d.similar.map((s) => s.book.title)).toEqual(["The Left Hand of Darkness"]);
  // a copy known only by import_isbn is the same-ISBN copy
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Left Behind", MISSED)] }));
  expect(ok(await ledger.candidates(natalie, { isbn: MISSED })).sameIsbn?.book.title).toBe("Left Behind");
});

test("candidates never offers labelled copies, Sam's copies, or more than 10, oldest first", async () => {
  let t = 1;
  const { ledger } = make({ now: () => t++ });
  const rows = Array.from({ length: 12 }, (_, i) => row("Dune: x", null, [`A${i}`]));
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: rows.slice(0, 12) }));
  ok(await ledger.importCopies(sam, { collectionId: null, rows: [row("Dune", null, ["S"])] }));
  const { results } = await env.DB.prepare("select c.id, b.authors from copies c join books b on b.id = c.book_id where c.owner_id = ? order by b.authors").bind(natalie.id).all<{ id: string; authors: string }>();
  // age the copies in author order so "oldest first" is checkable, then label the oldest
  for (const [i, r] of results.entries()) await env.DB.prepare("update copies set created_at = ? where id = ?").bind(100 + i, r.id).run();
  const [code] = await mint(ledger);
  ok(await ledger.labelCopy(natalie, results[0].id, code));
  const c = ok(await ledger.candidates(natalie, { title: "dune" }));
  expect(c.similar.length).toBe(10);
  expect(c.similar.map((s) => s.copyId)).toEqual(results.slice(1, 11).map((r) => r.id));
  expect(c.similar.every((s) => s.owner?.id === natalie.id && !s.labelled)).toBe(true);
});

test("candidates: an empty key matches nothing; bad or missing input is invalid", async () => {
  const { ledger } = make();
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("???"), row("!!!")] }));
  expect(ok(await ledger.candidates(natalie, { title: "???" })).similar).toEqual([]);
  expect(await ledger.candidates(natalie, {})).toEqual({ rejected: "invalid" });
  expect(await ledger.candidates(natalie, { isbn: "9780306406158" })).toEqual({ rejected: "invalid" });
  expect(await ledger.candidates(natalie, { title: "" })).toEqual({ rejected: "invalid" });
  expect(await ledger.candidates(natalie, { title: "x".repeat(301) })).toEqual({ rejected: "invalid" });
});

test("candidates contain no label code", async () => {
  const { ledger, lookupMany } = make();
  lookupMany.mockImplementation(found(DUNE));
  ok(await ledger.importCopies(natalie, { collectionId: null, rows: [row("Dune", DUNE.isbn), row("Dune: Again")] }));
  const codes = await mint(ledger, 3);
  const c = ok(await ledger.candidates(natalie, { isbn: DUNE.isbn!, title: "Dune" }));
  const json = JSON.stringify(c);
  for (const code of codes) expect(json).not.toContain(code);
  expect(json).not.toContain('"code"');
  // after labelling, the candidates still show no code
  const labelled = ok(await ledger.labelCopy(natalie, c.sameIsbn!.copyId, codes[0]));
  expect(labelled.code).toBe(codes[0]);
  const after = JSON.stringify(ok(await ledger.candidates(natalie, { title: "dune" })));
  for (const code of codes) expect(after).not.toContain(code);
});
