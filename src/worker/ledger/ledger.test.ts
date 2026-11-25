import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isLabelCode } from "../../shared/labelCode";
import type { BookInfo, CopyView, Rejection } from "../../shared/types";
import { resetDatabase } from "../../../test/reset";
import { invariantViolations } from "../../../test/invariant";
import { gated, racing, run } from "../../../test/racing";
import { DUNE, EMMA, asCopy, count, homeCopy, insertMembers, kim, make, mint, natalie, ok, sam } from "../../../test/ledger-fixtures";

beforeEach(async () => {
  await resetDatabase(env.DB);
  await insertMembers();
});

// Every ledger test leaves the collections invariant holding.
afterEach(async () => {
  expect(await invariantViolations(env.DB)).toEqual([]);
});

test("minting gives distinct blank labels with links on the site", async () => {
  const { ledger } = make();
  const labels = ok(await ledger.mintLabels(natalie, 100));
  expect(labels).toHaveLength(100);
  expect(new Set(labels.map((l) => l.code)).size).toBe(100);
  for (const l of labels) {
    expect(isLabelCode(l.code)).toBe(true);
    expect(l.url).toBe(`https://books.test/b/${l.code}`);
  }
  expect(await count("labels")).toBe(100);
  expect(await ledger.view(labels[0].code, null)).toEqual({ kind: "blank", code: labels[0].code });
});

test.each([0, -1, 101, 1.5, NaN])("minting %s labels is invalid", async (n) => {
  const { ledger } = make();
  expect(await ledger.mintLabels(natalie, n)).toEqual({ rejected: "invalid" });
  expect(await count("labels")).toBe(0);
});

test("a code collision is retried, not surfaced", async () => {
  const seq = [0, 0, 1];
  let i = 0;
  const randomBytes = (n: number) => new Uint8Array(n).fill(seq[Math.min(i++, seq.length - 1)]);
  const { ledger } = make({ randomBytes });
  const labels = ok(await ledger.mintLabels(natalie, 2));
  expect(labels.map((l) => l.code)).toEqual(["2222222222", "3333333333"]);
  expect(await count("labels")).toBe(2);
});

test("random bytes at or above 248 are discarded, never mapped", async () => {
  const calls: number[] = [];
  const randomBytes = (n: number) => {
    calls.push(n);
    return new Uint8Array(n).fill(calls.length === 1 ? 255 : 0);
  };
  const { ledger } = make({ randomBytes });
  const [l] = ok(await ledger.mintLabels(natalie, 1));
  expect(l.code).toBe("2222222222");
  expect(calls.length).toBeGreaterThan(1);
});

test("a byte of exactly 248 is discarded and 247 is kept", async () => {
  const calls: number[][] = [];
  const randomBytes = (n: number) => {
    const b = new Uint8Array(n);
    if (calls.length === 0) b.fill(248, 0, 8).fill(247, 8);
    calls.push([...b]);
    return b;
  };
  const { ledger } = make({ randomBytes });
  const [l] = ok(await ledger.mintLabels(natalie, 1));
  expect(l.code).toBe("zzzzzzzz22"); // 247 % 31 = 30 = "z"; 248 would have given "2"
  expect(calls).toHaveLength(2);
});

test("adding by ISBN makes a copy owned and held by the adder", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  const copy = ok(await ledger.add(natalie, { code, book: { isbn: "978-0-441-17271-9" } }));
  expect(copy).toMatchObject({
    code, book: DUNE,
    owner: { id: natalie.id, name: "Natalie", pictureUrl: "https://p.test/n.jpg" },
    holder: { kind: "member", person: { id: natalie.id, name: "Natalie" } },
    home: true,
    actions: ["move"],
  });
  expect(copy.history.map((h) => h.type)).toEqual(["labelled", "added"]);
  expect(copy.history[0]).toEqual({
    at: 1000, type: "labelled", actor: { id: natalie.id, name: "Natalie", pictureUrl: "https://p.test/n.jpg" },
  });
  expect(copy.history[1]).toEqual({
    at: 1000, type: "added", actor: { id: natalie.id, name: "Natalie", pictureUrl: "https://p.test/n.jpg" },
  });
  expect(asCopy(await ledger.view(code, sam)).actions).toEqual(["claim"]);
});

test("adding the same ISBN twice reuses the book and does not look it up again", async () => {
  const { ledger, lookup } = make();
  const [a, b] = await mint(ledger, 2);
  const one = ok(await ledger.add(natalie, { code: a, book: { isbn: DUNE.isbn! } }));
  const two = ok(await ledger.add(sam, { code: b, book: { isbn: DUNE.isbn! } }));
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(one.copyId).not.toBe(two.copyId);
  expect(await count("copies")).toBe(2);
  expect(await count("books")).toBe(1);
});

test("adding by title and author stores no ISBN and no cover", async () => {
  const { ledger, lookup } = make();
  const [a, b] = await mint(ledger, 2);
  const copy = ok(await ledger.add(natalie, { code: a, book: { title: "  Home Made  ", authors: [" A. Writer ", "B. Writer"] } }));
  expect(copy.book).toEqual({ isbn: null, title: "Home Made", authors: ["A. Writer", "B. Writer"], coverUrl: null });
  ok(await ledger.add(natalie, { code: b, book: { title: "Home Made", authors: [] } }));
  expect(lookup).not.toHaveBeenCalled();
  expect(await count("books")).toBe(2);
});

test("the label can be given as a link in capitals", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  const copy = ok(await ledger.add(natalie, { code: ` HTTPS://OLD.HOST.TEST/B/${code.toUpperCase()} `, book: { isbn: DUNE.isbn! } }));
  expect(copy.code).toBe(code);
});

test.each([
  ["a label that was never minted", "label-unknown"],
  ["a label already on a book", "label-in-use"],
])("adding to %s is refused", async (_which, reason) => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  const target = reason === "label-unknown" ? "abcdefghjk" : code;
  expect(await ledger.add(sam, { code: target, book: { isbn: EMMA.isbn! } })).toEqual({ rejected: reason });
  expect(await count("copies")).toBe(1);
  expect(await count("events")).toBe(2);
});

test("a code that is not a label is label-unknown", async () => {
  const { ledger } = make();
  expect(await ledger.add(natalie, { code: "nonsense", book: { isbn: DUNE.isbn! } })).toEqual({ rejected: "label-unknown" });
});

test("an ISBN the lookup cannot find is book-not-found and writes nothing", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  expect(await ledger.add(natalie, { code, book: { isbn: "9780306406157" } })).toEqual({ rejected: "book-not-found" });
  expect(await count("books")).toBe(0);
  expect(await count("copies")).toBe(0);
  expect(await count("events")).toBe(0);
  expect(await ledger.view(code, null)).toEqual({ kind: "blank", code });
});

test.each(["not-an-isbn", "0794972486008"])("adding ISBN %s is invalid", async (isbn) => {
  const { ledger, lookup } = make();
  const [code] = await mint(ledger);
  expect(await ledger.add(natalie, { code, book: { isbn } })).toEqual({ rejected: "invalid" });
  expect(lookup).not.toHaveBeenCalled();
});

test.each([
  ["", ["A"]],
  ["   ", ["A"]],
  ["x".repeat(301), ["A"]],
  ["T", Array(11).fill("A")],
  ["T", [""]],
  ["T", ["x".repeat(201)]],
])("title %j authors %j is invalid", async (title, authors) => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  expect(await ledger.add(natalie, { code, book: { title, authors } })).toEqual({ rejected: "invalid" });
  expect(await count("books")).toBe(0);
});

test("the limits themselves are accepted", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  ok(await ledger.add(natalie, { code, book: { title: "x".repeat(300), authors: Array(10).fill("y".repeat(200)) } }));
});

test("if the write fails nothing is half-written", async () => {
  const failing = { prepare: (q: string) => env.DB.prepare(q), batch: async () => { throw new Error("boom"); } } as unknown as D1Database;
  const { ledger } = make({ db: failing });
  const [code] = await mint(make().ledger);
  await expect(ledger.add(natalie, { code, book: { title: "T", authors: [] } })).rejects.toThrow("boom");
  for (const t of ["books", "copies", "events"]) expect(await count(t)).toBe(0);
  expect(await make().ledger.view(code, null)).toEqual({ kind: "blank", code });
});

test("a failure part-way through the batch rolls the whole batch back", async () => {
  // Same real database, but a statement that cannot succeed is appended to the add's batch.
  const poisoned = {
    prepare: (q: string) => env.DB.prepare(q),
    batch: (stmts: D1PreparedStatement[]) => env.DB.batch([...stmts, env.DB.prepare("insert into no_such_table values (1)")]),
  } as unknown as D1Database;
  const [code] = await mint(make().ledger);
  await expect(make({ db: poisoned }).ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } })).rejects.toThrow();
  for (const t of ["books", "copies", "events"]) expect(await count(t)).toBe(0);
  expect(await make().ledger.view(code, null)).toEqual({ kind: "blank", code });
});

test("two adds to one label at once: exactly one succeeds, one is label-in-use, one copy exists", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  const results = await Promise.all([
    ledger.add(natalie, { code, book: { title: "First", authors: ["A"] } }),
    ledger.add(sam, { code, book: { title: "Second", authors: ["B"] } }),
  ]);
  const rejected = results.filter((r) => "rejected" in r);
  expect(rejected).toEqual([{ rejected: "label-in-use" }]);
  expect(results.filter((r) => !("rejected" in r))).toHaveLength(1);
  expect(await count("copies")).toBe(1);
  expect(await count("events")).toBe(2);
  expect(await count("books")).toBe(1); // no orphan from the loser
});

test("two ISBN adds to one label at once leave no orphan book", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  const results = await Promise.all([
    ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }),
    ledger.add(sam, { code, book: { isbn: EMMA.isbn! } }),
  ]);
  expect(results.filter((r) => "rejected" in r)).toEqual([{ rejected: "label-in-use" }]);
  expect(await count("copies")).toBe(1);
  expect(await count("books")).toBe(1);
});

test("two adds of the same new ISBN to two labels at once both succeed and share one book", async () => {
  const { ledger } = make();
  const [a, b] = await mint(ledger, 2);
  const results = await Promise.all([
    ledger.add(natalie, { code: a, book: { isbn: DUNE.isbn! } }),
    ledger.add(sam, { code: b, book: { isbn: DUNE.isbn! } }),
  ]);
  expect(results.every((r) => !("rejected" in r))).toBe(true);
  expect(await count("books")).toBe(1);
  expect(await count("copies")).toBe(2);
  expect(await count("events")).toBe(4);
});

test("someone signed out sees title, authors, and cover only", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  expect(await ledger.view(code, null)).toEqual({
    kind: "public", code, book: { title: "Dune", authors: ["Frank Herbert"], coverUrl: DUNE.coverUrl },
  });
});

test("a member sees owner, holder, history newest first, and their actions", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  const view = asCopy(await ledger.view(code, sam));
  expect(view.owner).toEqual({ id: natalie.id, name: "Natalie", pictureUrl: "https://p.test/n.jpg" });
  expect(view.holder).toEqual({ kind: "member", person: view.owner });
  expect(view.home).toBe(true);
  expect(view.history.map((h) => h.type)).toEqual(["labelled", "added"]);
  expect(view.actions).toEqual(["claim"]);
  expect(asCopy(await ledger.view(code, natalie)).actions).toEqual(["move"]);
});

test("a blank label is blank; an unknown or malformed code is unknown", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  expect(await ledger.view(code, sam)).toEqual({ kind: "blank", code });
  expect(await ledger.view(`https://books.test/b/${code.toUpperCase()}`, null)).toEqual({ kind: "blank", code });
  expect(await ledger.view("abcdefghjk", sam)).toEqual({ kind: "unknown" });
  expect(await ledger.view("nonsense", sam)).toEqual({ kind: "unknown" });
  expect(await ledger.view("", null)).toEqual({ kind: "unknown" });
});

test("no view contains an email address", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  expect(JSON.stringify(await ledger.view(code, sam))).not.toContain("@");
  const added = ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  expect(JSON.stringify(added)).not.toContain("@");
  expect(JSON.stringify(await ledger.view(code, sam))).not.toContain("@");
  expect(JSON.stringify(await ledger.view(code, null))).not.toContain("@");
});

const lookupReturning = (v: unknown) => vi.fn(async () => v as BookInfo | null);

async function addWith(v: unknown) {
  const { ledger } = make({ lookup: lookupReturning(v) });
  const [code] = await mint(ledger);
  return { ledger, code, result: await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }) };
}

test("a bad cover from the lookup is stored as null", async () => {
  const { result } = await addWith({ ...DUNE, coverUrl: "javascript:alert(1)" });
  expect(ok(result).book.coverUrl).toBeNull();
  expect((await env.DB.prepare("select cover_url from books").first<{ cover_url: string | null }>())!.cover_url).toBeNull();
});

test("a 5000-character title from the lookup is stored cut to 300", async () => {
  const { result } = await addWith({ ...DUNE, title: "x".repeat(5000) });
  expect(ok(result).book.title).toHaveLength(300);
  expect((await env.DB.prepare("select title from books").first<{ title: string }>())!.title).toHaveLength(300);
});

test("undefined authors from the lookup are stored as an empty list", async () => {
  const { result } = await addWith({ isbn: DUNE.isbn, title: "Dune", coverUrl: null });
  expect(ok(result).book.authors).toEqual([]);
});

test.each([[{ isbn: DUNE.isbn, authors: ["A"], coverUrl: null }], [{ title: "  " }], [undefined]])(
  "a lookup returning %j is book-not-found and writes nothing", async (v) => {
    const { ledger, code, result } = await addWith(v);
    expect(result).toEqual({ rejected: "book-not-found" });
    for (const t of ["books", "copies", "events"]) expect(await count(t)).toBe(0);
    expect(await ledger.view(code, null)).toEqual({ kind: "blank", code });
  });

test("a lookup that throws is book-not-found", async () => {
  const { ledger } = make({ lookup: async () => { throw new Error("down"); } });
  const [code] = await mint(ledger);
  expect(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } })).toEqual({ rejected: "book-not-found" });
  expect(await count("books")).toBe(0);
});

test("the book is stored under the requested ISBN even when the lookup says another", async () => {
  const { result } = await addWith({ ...DUNE, isbn: "9780141439587" });
  expect(ok(result).book.isbn).toBe(DUNE.isbn);
  expect((await env.DB.prepare("select isbn from books").first<{ isbn: string }>())!.isbn).toBe(DUNE.isbn);
});

test("titles and authors are counted in characters, not UTF-16 units", async () => {
  const { ledger } = make();
  const [a, b] = await mint(ledger, 2);
  ok(await ledger.add(natalie, { code: a, book: { title: "📚".repeat(300), authors: ["📚".repeat(200)] } }));
  expect(await ledger.add(natalie, { code: b, book: { title: "📚".repeat(301), authors: [] } })).toEqual({ rejected: "invalid" });
  expect(await ledger.add(natalie, { code: b, book: { title: "T", authors: ["📚".repeat(201)] } })).toEqual({ rejected: "invalid" });
});

test.each([
  ["code is not a string", { code: 5, book: { isbn: DUNE.isbn } }],
  ["code is missing", { book: { isbn: DUNE.isbn } }],
  ["book is missing", { code: "CODE" }],
  ["book is null", { code: "CODE", book: null }],
  ["book is a string", { code: "CODE", book: "Dune" }],
  ["book has neither isbn nor title", { code: "CODE", book: {} }],
  ["isbn is a number", { code: "CODE", book: { isbn: 9780441172719 } }],
  ["title is a number", { code: "CODE", book: { title: 5, authors: [] } }],
  ["authors is a string", { code: "CODE", book: { title: "T", authors: "A" } }],
  ["authors is missing", { code: "CODE", book: { title: "T" } }],
  ["an author is a number", { code: "CODE", book: { title: "T", authors: [5] } }],
  ["input is null", null],
])("add answers invalid, not a throw, when %s", async (_name, raw) => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  const input = raw && typeof raw === "object" && (raw as { code?: unknown }).code === "CODE" ? { ...raw, code } : raw;
  expect(await ledger.add(natalie, input as never)).toEqual({ rejected: "invalid" });
  for (const t of ["books", "copies", "events"]) expect(await count(t)).toBe(0);
});

async function eventRows(): Promise<Record<string, unknown>[]> {
  return (await env.DB.prepare("select * from events order by id").all()).results;
}

const rejections = (rs: (CopyView | Rejection)[]) => rs.filter((r): r is Rejection => "rejected" in r);
const successes = (rs: (CopyView | Rejection)[]) => rs.filter((r): r is CopyView => !("rejected" in r));

test("a friend claims by label and becomes the holder", async () => {
  const { ledger } = make();
  const { code } = await homeCopy(ledger);
  const copy = ok(await ledger.act(sam, { type: "claim", code }));
  expect(copy.holder).toEqual({ kind: "member", person: { id: sam.id, name: "Sam", pictureUrl: null } });
  expect(copy.home).toBe(false);
  expect(copy.history[0]).toEqual({ at: 1000, type: "claimed", actor: { id: sam.id, name: "Sam", pictureUrl: null } });
  expect(copy.history.map((h) => h.type)).toEqual(["claimed", "labelled", "added"]);
  expect(copy.actions).toEqual([]);
});

test("the label can be given as a link when claiming", async () => {
  const { ledger } = make();
  const { code } = await homeCopy(ledger);
  const copy = ok(await ledger.act(sam, { type: "claim", code: ` HTTPS://OLD.HOST.TEST/B/${code.toUpperCase()} ` }));
  expect(copy.holder).toMatchObject({ kind: "member", person: { id: sam.id } });
});

test("the next friend claims it from the first", async () => {
  const { ledger } = make();
  const { code } = await homeCopy(ledger);
  ok(await ledger.act(sam, { type: "claim", code }));
  const copy = ok(await ledger.act(kim, { type: "claim", code }));
  expect(copy.holder).toMatchObject({ kind: "member", person: { id: kim.id } });
  expect(copy.history.slice(0, 2).map((h) => [h.type, h.actor.id])).toEqual([["claimed", kim.id], ["claimed", sam.id]]);
});

test("claiming twice is refused the second time and recorded once", async () => {
  const { ledger } = make();
  const { code } = await homeCopy(ledger);
  ok(await ledger.act(sam, { type: "claim", code }));
  expect(await ledger.act(sam, { type: "claim", code })).toEqual({ rejected: "not-allowed" });
  expect(await count("events")).toBe(3);
});

test("two members claim at the same moment: exactly one CopyView, exactly one Rejection, exactly one new event", async () => {
  const { ledger } = make({ db: gated(2) });
  const { code } = await homeCopy(make().ledger);
  const results = await Promise.all([ledger.act(sam, { type: "claim", code }), ledger.act(kim, { type: "claim", code })]);
  expect(rejections(results)).toEqual([{ rejected: "not-allowed" }]);
  const [winner] = successes(results);
  expect(winner).toBeDefined();
  const holderId = (await env.DB.prepare("select holder_member_id as h from copies").first<{ h: string }>())!.h;
  expect(winner.holder).toMatchObject({ kind: "member", person: { id: holderId } });
  expect(winner.history[0]).toMatchObject({ type: "claimed", actor: { id: holderId } });
  expect(await count("events")).toBe(3);
});

test("one member double-taps claim at the same moment: one success, one refusal, one event", async () => {
  const { ledger } = make({ db: gated(2) });
  const { code } = await homeCopy(make().ledger);
  const results = await Promise.all([ledger.act(sam, { type: "claim", code }), ledger.act(sam, { type: "claim", code })]);
  expect(successes(results)).toHaveLength(1);
  expect(rejections(results)).toEqual([{ rejected: "not-allowed" }]);
  expect(await count("events")).toBe(3);
});

test("a claim and the owner's return at the same moment: the history has no entry that contradicts the holder", async () => {
  const setup = make().ledger;
  const { code, copyId } = await homeCopy(setup);
  ok(await setup.act(sam, { type: "claim", code })); // out with Sam; Kim claims while Natalie takes it back
  const { ledger } = make({ db: gated(2) });
  const results = await Promise.all([ledger.act(kim, { type: "claim", code }), ledger.act(natalie, { type: "return", copyId })]);
  expect(successes(results)).toHaveLength(1);
  expect(rejections(results)).toEqual([{ rejected: "not-allowed" }]);
  expect(await count("events")).toBe(4);
  const last = asCopy(await setup.view(code, natalie));
  const { type, actor } = last.history[0];
  expect(last.holder).toMatchObject({ kind: "member", person: { id: actor.id } });
  expect(type).toBe(actor.id === natalie.id ? "returned" : "claimed");
});

test("the owner marks it returned", async () => {
  const { ledger } = make();
  const { code, copyId } = await homeCopy(ledger);
  ok(await ledger.act(sam, { type: "claim", code }));
  const copy = ok(await ledger.act(natalie, { type: "return", copyId }));
  expect(copy.holder).toMatchObject({ kind: "member", person: { id: natalie.id } });
  expect(copy.home).toBe(true);
  expect(copy.history[0]).toMatchObject({ type: "returned", actor: { id: natalie.id } });
  expect(copy.code).toBeNull();
});

test("only the owner can mark a return", async () => {
  const { ledger } = make();
  const { code, copyId } = await homeCopy(ledger);
  ok(await ledger.act(sam, { type: "claim", code }));
  for (const who of [sam, kim]) expect(await ledger.act(who, { type: "return", copyId })).toEqual({ rejected: "not-allowed" });
  expect(await count("events")).toBe(3);
});

test("returning a book that is home is refused and recorded nowhere", async () => {
  const { ledger } = make();
  const { copyId } = await homeCopy(ledger);
  expect(await ledger.act(natalie, { type: "return", copyId })).toEqual({ rejected: "not-allowed" });
  expect(await count("events")).toBe(2);
});

test("claiming your own book is refused", async () => {
  const { ledger } = make();
  const { code } = await homeCopy(ledger);
  expect(await ledger.act(natalie, { type: "claim", code })).toEqual({ rejected: "not-allowed" });
  expect(await count("events")).toBe(2);
});

test("a copy with no owner cannot be claimed", async () => {
  const { ledger } = make();
  const { code, copyId } = await homeCopy(ledger);
  await env.DB.prepare("update copies set owner_id = null, collection_id = null where id = ?").bind(copyId).run();
  expect(await ledger.act(sam, { type: "claim", code })).toEqual({ rejected: "not-allowed" });
  expect(await count("events")).toBe(2);
});

test("claim on an unknown label and return on an unknown copy are not-found", async () => {
  const { ledger } = make();
  const [blank] = await mint(ledger);
  await homeCopy(ledger);
  expect(await ledger.act(sam, { type: "claim", code: "abcdefghjk" })).toEqual({ rejected: "not-found" });
  expect(await ledger.act(sam, { type: "claim", code: "nonsense" })).toEqual({ rejected: "not-found" });
  expect(await ledger.act(sam, { type: "claim", code: blank })).toEqual({ rejected: "not-found" });
  expect(await ledger.act(natalie, { type: "return", copyId: "no-such-copy" })).toEqual({ rejected: "not-found" });
  expect(await count("events")).toBe(2);
});

test("history is never rewritten", async () => {
  let t = 1000;
  const { ledger } = make({ now: () => (t += 10) });
  const { code, copyId } = await homeCopy(ledger);
  const rows: Record<string, unknown>[][] = [await eventRows()];
  ok(await ledger.act(sam, { type: "claim", code }));
  rows.push(await eventRows());
  ok(await ledger.act(kim, { type: "claim", code }));
  rows.push(await eventRows());
  ok(await ledger.act(natalie, { type: "return", copyId }));
  rows.push(await eventRows());
  expect(rows.map((r) => r.length)).toEqual([2, 3, 4, 5]);
  expect(new Set(rows[3].slice(2).map((r) => r.at)).size).toBe(3); // the clock advanced, so a rewritten `at` would show
  const final = rows[3];
  for (const before of rows.slice(0, 3)) expect(final.slice(0, before.length)).toEqual(before);
});

test("no code path updates or deletes an events row", async () => {
  await env.DB.batch([
    env.DB.prepare("create trigger events_no_update before update on events begin select raise(abort, 'events are append-only'); end"),
    env.DB.prepare("create trigger events_no_delete before delete on events begin select raise(abort, 'events are append-only'); end"),
  ]);
  try {
    const { ledger } = make();
    const { code, copyId } = await homeCopy(ledger);
    ok(await ledger.act(sam, { type: "claim", code }));
    ok(await ledger.act(kim, { type: "claim", code }));
    ok(await ledger.act(natalie, { type: "return", copyId }));
    expect(await ledger.act(natalie, { type: "return", copyId })).toEqual({ rejected: "not-allowed" });
    expect(await count("events")).toBe(5);
  } finally {
    await env.DB.batch([env.DB.prepare("drop trigger events_no_update"), env.DB.prepare("drop trigger events_no_delete")]);
  }
});

test("the acting viewer's actions reflect the new state", async () => {
  const { ledger } = make();
  const { code, copyId } = await homeCopy(ledger);
  expect(ok(await ledger.act(sam, { type: "claim", code })).actions).toEqual([]);
  expect(asCopy(await ledger.view(code, natalie)).actions).toEqual(["return", "move"]);
  expect(asCopy(await ledger.view(code, kim)).actions).toEqual(["claim"]);
  expect(ok(await ledger.act(natalie, { type: "return", copyId })).actions).toEqual(["move"]);
});

// A raw owner change that keeps the invariant, as a step 4 owner change will: Kim's default first, then both columns at once.
const giveAllCopiesTo = (memberId: string) => async () => {
  await env.DB.batch([
    env.DB.prepare(
      `insert into collections (id, owner_id, name, name_key, is_default, created_at)
       select ?, ?, 'Home library', 'home library', 1, 0 where not exists (select 1 from collections where owner_id = ? and is_default = 1)`,
    ).bind(`k-${memberId}`, memberId, memberId),
    env.DB.prepare(
      "update copies set owner_id = ?, collection_id = (select id from collections where owner_id = ? and is_default = 1)",
    ).bind(memberId, memberId),
  ]);
};

const holders = async () =>
  (await env.DB.prepare("select id, owner_id, holder_member_id from copies order by id").all()).results;

test("a claim made stale by a change of holder after the read records nothing", async () => {
  const { code } = await homeCopy(make().ledger);
  const db = racing(run("update copies set holder_member_id = ?", kim.id));
  expect(await make({ db }).ledger.act(sam, { type: "claim", code })).toEqual({ rejected: "not-allowed" });
  expect(await count("events")).toBe(2);
  expect((await env.DB.prepare("select holder_member_id as h from copies").first<{ h: string }>())!.h).toBe(kim.id);
});

test("a claim made stale by a change of owner after the read records nothing", async () => {
  const { code } = await homeCopy(make().ledger);
  const db = racing(giveAllCopiesTo(kim.id));
  expect(await make({ db }).ledger.act(sam, { type: "claim", code })).toEqual({ rejected: "not-allowed" });
  expect(await count("events")).toBe(2);
  expect((await holders())[0]).toMatchObject({ owner_id: kim.id, holder_member_id: natalie.id });
});

test("a return made stale by a change of owner after the read records nothing", async () => {
  const setup = make().ledger;
  const { code, copyId } = await homeCopy(setup);
  ok(await setup.act(sam, { type: "claim", code }));
  const db = racing(giveAllCopiesTo(kim.id));
  expect(await make({ db }).ledger.act(natalie, { type: "return", copyId })).toEqual({ rejected: "not-allowed" });
  expect(await count("events")).toBe(3);
  expect((await holders())[0]).toMatchObject({ owner_id: kim.id, holder_member_id: sam.id });
});

test("a claim made stale by the label being unbound after the read records nothing", async () => {
  const { code } = await homeCopy(make().ledger);
  const db = racing(run("update labels set copy_id = null where code = ?", code));
  expect(await make({ db }).ledger.act(sam, { type: "claim", code })).toEqual({ rejected: "not-allowed" });
  expect(await count("events")).toBe(2);
  expect((await holders())[0]).toMatchObject({ holder_member_id: natalie.id });
});

test("a claim made stale by the label moving to another copy after the read records nothing", async () => {
  const setup = make().ledger;
  const first = await homeCopy(setup);
  const second = await homeCopy(setup);
  const before = await holders();
  const db = racing(async () => {
    await env.DB.batch([
      env.DB.prepare("update labels set copy_id = null where code = ?").bind(second.code),
      env.DB.prepare("update labels set copy_id = ? where code = ?").bind(second.copyId, first.code),
    ]);
  });
  expect(await make({ db }).ledger.act(sam, { type: "claim", code: first.code })).toEqual({ rejected: "not-allowed" });
  expect(await count("events")).toBe(4);
  expect(await holders()).toEqual(before);
});

// A db that, just before its first batch, lets Kim claim the copy: another person's action landing mid-act.
function kimClaimsBeforeFirstBatch(code: string): D1Database {
  return racing(async () => {
    ok(await make().ledger.act(kim, { type: "claim", code }));
  });
}

test("a returned view agrees with itself when another claim lands after the write", async () => {
  const { code } = await homeCopy(make().ledger);
  // act's own write is the first batch; the claim lands before its second (the view's read).
  let batches = 0;
  const inner = kimClaimsBeforeFirstBatch(code);
  const db = {
    prepare: (q: string) => env.DB.prepare(q),
    batch: (stmts: D1PreparedStatement[]) => (++batches === 1 ? env.DB.batch(stmts) : inner.batch(stmts)),
  } as unknown as D1Database;
  const copy = ok(await make({ db }).ledger.act(sam, { type: "claim", code }));
  expect(copy.holder).toMatchObject({ kind: "member", person: { id: copy.history[0].actor.id } });
  expect(copy.history[0].type).toBe("claimed");
});

test("a view agrees with itself when another claim lands during the read", async () => {
  const { code } = await homeCopy(make().ledger);
  const db = kimClaimsBeforeFirstBatch(code);
  const copy = asCopy(await make({ db }).ledger.view(code, sam));
  expect(copy.holder).toMatchObject({ kind: "member", person: { id: copy.history[0].actor.id } });
});

test.each([
  ["code is a number", { type: "claim", code: 5 }],
  ["code is missing", { type: "claim" }],
  ["code is null", { type: "claim", code: null }],
  ["copyId is a number", { type: "return", copyId: 5 }],
  ["copyId is missing", { type: "return" }],
  ["the type is unknown", { type: "steal", code: "abcdefghjk" }],
  ["the type is missing", { code: "abcdefghjk" }],
  ["the action is null", null],
  ["the action is a string", "claim"],
])("act answers invalid, not a throw, when %s", async (_name, raw) => {
  const { ledger } = make();
  await homeCopy(ledger);
  expect(await ledger.act(sam, raw as never)).toEqual({ rejected: "invalid" });
  expect(await count("events")).toBe(2);
});

// ---- collections: adding into one, moving between them, lending keeps them ----

const collectionOf = async (copyId: string) =>
  (await env.DB.prepare("select collection_id as c from copies where id = ?").bind(copyId).first<{ c: string | null }>())!.c;
const collectionRows = async () =>
  (await env.DB.prepare("select id, owner_id, name, is_default from collections order by created_at, id").all()).results;
const defaultOf = async (ownerId: string) =>
  (await env.DB.prepare("select id from collections where owner_id = ? and is_default = 1").bind(ownerId).first<{ id: string }>())!.id;

test("a first add creates Home library as the default and puts the copy in it", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  expect(await collectionRows()).toEqual([]);
  const copy = ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  expect(await collectionRows()).toEqual([
    { id: expect.any(String), owner_id: natalie.id, name: "Home library", is_default: 1 },
  ]);
  expect(await collectionOf(copy.copyId)).toBe(await defaultOf(natalie.id));
});

test("an add with a collection puts the copy there", async () => {
  const { ledger } = make();
  const [a, b] = await mint(ledger, 2);
  ok(await ledger.createCollection(natalie, "Beach house"));
  const shed = ok(await ledger.createCollection(natalie, "Shed"));
  const copy = ok(await ledger.add(natalie, { code: a, book: { isbn: DUNE.isbn! }, collectionId: shed.id }));
  expect(await collectionOf(copy.copyId)).toBe(shed.id);
  const home = ok(await ledger.add(natalie, { code: b, book: { isbn: EMMA.isbn! }, collectionId: null }));
  expect(await collectionOf(home.copyId)).toBe(await defaultOf(natalie.id));
});

test("an add into someone else's collection is not-found and writes nothing", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  const theirs = ok(await ledger.createCollection(sam, "Sam's shelf"));
  const before = await collectionRows();
  for (const book of [{ isbn: DUNE.isbn! }, { title: "Home Made", authors: ["A"] }]) {
    expect(await ledger.add(natalie, { code, book, collectionId: theirs.id })).toEqual({ rejected: "not-found" });
  }
  expect(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! }, collectionId: "no-such" })).toEqual({ rejected: "not-found" });
  for (const t of ["books", "copies", "events"]) expect(await count(t)).toBe(0);
  expect(await collectionRows()).toEqual(before);
  expect(await ledger.view(code, null)).toEqual({ kind: "blank", code });
});

test("an add with a collection id that is not a string is invalid", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  expect(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! }, collectionId: 5 as never })).toEqual({ rejected: "invalid" });
  expect(await count("copies")).toBe(0);
});

test("an add into a collection deleted after the read is not-found and the label stays blank", async () => {
  const setup = make().ledger;
  const [code] = await mint(setup);
  ok(await setup.createCollection(natalie, "Home"));
  const shed = ok(await setup.createCollection(natalie, "Shed"));
  const db = racing(run("delete from collections where id = ?", shed.id));
  // A title book, so an orphan books row from a half-applied batch would show.
  expect(await make({ db }).ledger.add(natalie, { code, book: { title: "T", authors: [] }, collectionId: shed.id })).toEqual({ rejected: "not-found" });
  for (const t of ["books", "copies", "events"]) expect(await count(t)).toBe(0);
  expect(await setup.view(code, null)).toEqual({ kind: "blank", code });
});

test("two first adds at once by one member: one default, both copies in it", async () => {
  const { ledger } = make({ db: gated(2) });
  const [a, b] = await mint(make().ledger, 2);
  const results = await Promise.all([
    ledger.add(natalie, { code: a, book: { isbn: DUNE.isbn! } }),
    ledger.add(natalie, { code: b, book: { isbn: EMMA.isbn! } }),
  ]);
  const copies = results.map((r) => ok(r));
  expect(await collectionRows()).toHaveLength(1);
  const home = await defaultOf(natalie.id);
  for (const c of copies) expect(await collectionOf(c.copyId)).toBe(home);
});

test("a first add racing the member's first createCollection: one default, and the copy is in it", async () => {
  const { ledger } = make({ db: gated(2) });
  const [code] = await mint(make().ledger);
  const [added, created] = await Promise.all([
    ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }),
    ledger.createCollection(natalie, "Beach house"),
  ]);
  const copy = ok(added);
  ok(created);
  const rows = await collectionRows();
  expect(rows.filter((r) => r.is_default === 1)).toHaveLength(1);
  expect(await collectionOf(copy.copyId)).toBe(await defaultOf(natalie.id));
});

test("a removed member's add is not-allowed and writes nothing", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  await env.DB.prepare("update members set removed_at = 5 where id = ?").bind(sam.id).run();
  expect(await ledger.add(sam, { code, book: { isbn: DUNE.isbn! } })).toEqual({ rejected: "not-allowed" });
  expect(await ledger.add(sam, { code, book: { title: "T", authors: [] } })).toEqual({ rejected: "not-allowed" });
  for (const t of ["books", "copies", "events", "collections"]) expect(await count(t)).toBe(0);
  expect(await ledger.view(code, null)).toEqual({ kind: "blank", code });
});

test("claim then return leave the copy in its collection", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  ok(await ledger.createCollection(natalie, "Home"));
  const shed = ok(await ledger.createCollection(natalie, "Shed"));
  const { copyId } = ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! }, collectionId: shed.id }));
  ok(await ledger.act(sam, { type: "claim", code }));
  expect(await collectionOf(copyId)).toBe(shed.id);
  ok(await ledger.act(natalie, { type: "return", copyId }));
  expect(await collectionOf(copyId)).toBe(shed.id);
});

test("a claim on a copy with no collection_id fills in its owner's default", async () => {
  const { ledger } = make();
  const { code, copyId } = await homeCopy(ledger);
  await env.DB.prepare("update copies set collection_id = null where id = ?").bind(copyId).run();
  ok(await ledger.act(sam, { type: "claim", code }));
  expect(await collectionOf(copyId)).toBe(await defaultOf(natalie.id));
});

test("an owned copy with no collection_id and an owner with no default row comes out correct after a claim, a return and an add", async () => {
  const { ledger } = make();
  const first = await homeCopy(ledger);
  const second = await homeCopy(ledger);
  // What the old Worker leaves behind: owned copies with no collection, and the owner with no collections at all.
  await env.DB.batch([env.DB.prepare("update copies set collection_id = null"), env.DB.prepare("delete from collections")]);
  ok(await ledger.act(sam, { type: "claim", code: first.code }));
  expect(await collectionOf(first.copyId)).toBe(await defaultOf(natalie.id));
  expect(await collectionOf(second.copyId)).toBe(await defaultOf(natalie.id));
  await env.DB.batch([env.DB.prepare("update copies set collection_id = null"), env.DB.prepare("delete from collections")]);
  ok(await ledger.act(natalie, { type: "return", copyId: first.copyId }));
  expect(await collectionOf(first.copyId)).toBe(await defaultOf(natalie.id));
  await env.DB.batch([env.DB.prepare("update copies set collection_id = null"), env.DB.prepare("delete from collections")]);
  const [code] = await mint(ledger);
  const added = ok(await ledger.add(natalie, { code, book: { isbn: EMMA.isbn! } }));
  expect(await collectionOf(added.copyId)).toBe(await defaultOf(natalie.id));
  expect(await collectionOf(second.copyId)).toBe(await defaultOf(natalie.id));
});

async function twoCollections() {
  const { ledger } = make();
  const { code, copyId } = await homeCopy(ledger);
  const home = await defaultOf(natalie.id);
  const shed = ok(await ledger.createCollection(natalie, "Shed"));
  return { ledger, code, copyId, home, shed };
}

test("the owner moves a copy between their collections; holder and history are unchanged", async () => {
  const { ledger, code, copyId, home, shed } = await twoCollections();
  const events = await eventRows();
  const moved = ok(await ledger.moveCopy(natalie, copyId, shed.id));
  expect(moved.copyId).toBe(copyId);
  expect(moved.code).toBeNull();
  expect(JSON.stringify(moved)).not.toContain(code);
  expect(moved.home).toBe(true);
  expect(moved.actions).toEqual(["move"]);
  expect(await collectionOf(copyId)).toBe(shed.id);
  expect(await eventRows()).toEqual(events);
  expect((await holders())[0]).toMatchObject({ owner_id: natalie.id, holder_member_id: natalie.id });
  ok(await ledger.moveCopy(natalie, copyId, home));
  expect(await collectionOf(copyId)).toBe(home);
});

test("moving a lent-out copy works and does not bring it home", async () => {
  const { ledger, code, copyId, shed } = await twoCollections();
  ok(await ledger.act(sam, { type: "claim", code }));
  const moved = ok(await ledger.moveCopy(natalie, copyId, shed.id));
  expect(moved.home).toBe(false);
  expect(moved.holder).toMatchObject({ kind: "member", person: { id: sam.id } });
  expect(await collectionOf(copyId)).toBe(shed.id);
  expect((await holders())[0]).toMatchObject({ holder_member_id: sam.id });
  expect(await count("events")).toBe(3);
});

test("moving someone else's copy is not-allowed; into someone else's collection is not-found", async () => {
  const { ledger, copyId, home, shed } = await twoCollections();
  const theirs = ok(await ledger.createCollection(sam, "Sam's shelf"));
  expect(await ledger.moveCopy(sam, copyId, theirs.id)).toEqual({ rejected: "not-allowed" });
  expect(await ledger.moveCopy(sam, copyId, shed.id)).toEqual({ rejected: "not-allowed" });
  expect(await ledger.moveCopy(natalie, copyId, theirs.id)).toEqual({ rejected: "not-found" });
  expect(await ledger.moveCopy(natalie, copyId, "no-such")).toEqual({ rejected: "not-found" });
  expect(await ledger.moveCopy(natalie, "no-such", shed.id)).toEqual({ rejected: "not-found" });
  expect(await ledger.moveCopy(natalie, 5 as never, shed.id)).toEqual({ rejected: "invalid" });
  expect(await ledger.moveCopy(natalie, copyId, 5 as never)).toEqual({ rejected: "invalid" });
  expect(await collectionOf(copyId)).toBe(home);
});

test("a removed owner cannot move a copy", async () => {
  const { ledger, copyId, home, shed } = await twoCollections();
  await env.DB.prepare("update members set removed_at = 5 where id = ?").bind(natalie.id).run();
  expect(await ledger.moveCopy(natalie, copyId, shed.id)).toEqual({ rejected: "not-allowed" });
  expect(await collectionOf(copyId)).toBe(home);
});

test("a move racing a delete of the destination never leaves the copy in a deleted collection", async () => {
  const { copyId, home, shed } = await twoCollections();
  const db = racing(run("delete from collections where id = ?", shed.id));
  expect(await make({ db }).ledger.moveCopy(natalie, copyId, shed.id)).toEqual({ rejected: "not-found" });
  expect(await collectionOf(copyId)).toBe(home);
  expect(await count("collections")).toBe(1);
});

const dangling = async () =>
  (await env.DB.prepare("select count(*) as n from copies where collection_id is not null and collection_id not in (select id from collections)").first<{ n: number }>())!.n;

test("a delete of an empty collection racing an add into it: one wins, nothing dangles", async () => {
  const setup = make().ledger;
  const [code] = await mint(setup);
  ok(await setup.createCollection(natalie, "Home"));
  const shed = ok(await setup.createCollection(natalie, "Shed"));
  // The delete lands first, between the add's read and its write.
  const lost = await make({ db: racing(run("delete from collections where id = ?", shed.id)) }).ledger.add(natalie, {
    code, book: { isbn: DUNE.isbn! }, collectionId: shed.id,
  });
  expect(lost).toEqual({ rejected: "not-found" });
  expect(await dangling()).toBe(0);
  expect(await count("copies")).toBe(0);

  // The add lands first, between the delete's read and its write.
  const shed2 = ok(await setup.createCollection(natalie, "Shed 2"));
  const db = racing(async () => {
    ok(await make().ledger.add(natalie, { code, book: { isbn: DUNE.isbn! }, collectionId: shed2.id }));
  });
  expect(await make({ db }).ledger.deleteCollection(natalie, shed2.id)).toEqual({ rejected: "not-allowed" });
  expect(await dangling()).toBe(0);
  expect(await count("copies")).toBe(1);
});

test("a delete of an empty collection racing a move into it: one wins, nothing dangles", async () => {
  const { ledger, copyId, home, shed } = await twoCollections();
  // The delete lands first.
  const lost = await make({ db: racing(run("delete from collections where id = ?", shed.id)) }).ledger.moveCopy(natalie, copyId, shed.id);
  expect(lost).toEqual({ rejected: "not-found" });
  expect(await collectionOf(copyId)).toBe(home);
  // The move lands first.
  const shed2 = ok(await ledger.createCollection(natalie, "Shed 2"));
  const db = racing(async () => {
    ok(await make().ledger.moveCopy(natalie, copyId, shed2.id));
  });
  expect(await make({ db }).ledger.deleteCollection(natalie, shed2.id)).toEqual({ rejected: "not-allowed" });
  expect(await collectionOf(copyId)).toBe(shed2.id);
  expect(await dangling()).toBe(0);
});

test("a delete and an add into the same collection at once: one wins, nothing dangles", async () => {
  const setup = make().ledger;
  const [code] = await mint(setup);
  ok(await setup.createCollection(natalie, "Home"));
  const shed = ok(await setup.createCollection(natalie, "Shed"));
  const { ledger } = make({ db: gated(2) });
  const [added, deleted] = await Promise.all([
    ledger.add(natalie, { code, book: { isbn: DUNE.isbn! }, collectionId: shed.id }),
    ledger.deleteCollection(natalie, shed.id),
  ]);
  expect("rejected" in added !== "rejected" in deleted).toBe(true);
  expect(await dangling()).toBe(0);
  expect(await count("copies")).toBe("rejected" in added ? 0 : 1);
});
