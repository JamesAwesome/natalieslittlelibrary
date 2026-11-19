import { env } from "cloudflare:workers";
import { beforeEach, expect, test, vi } from "vitest";
import { isLabelCode } from "../../shared/labelCode";
import type { BookInfo, CopyView, LabelView, Member, Rejection } from "../../shared/types";
import { resetDatabase } from "../../../test/reset";
import { createLedger, type Ledger } from "./index";

const natalie: Member = { id: "m-natalie", name: "Natalie", email: "natalie@example.com", pictureUrl: "https://p.test/n.jpg", isAdmin: true };
const sam: Member = { id: "m-sam", name: "Sam", email: "sam@example.com", pictureUrl: null, isAdmin: false };

const DUNE: BookInfo = { isbn: "9780441172719", title: "Dune", authors: ["Frank Herbert"], coverUrl: "https://covers.openlibrary.org/b/id/1-L.jpg" };
const EMMA: BookInfo = { isbn: "9780141439587", title: "Emma", authors: ["Jane Austen"], coverUrl: null };

type Deps = Partial<Parameters<typeof createLedger>[0]>;

function make(deps: Deps = {}) {
  const lookup = vi.fn(async (isbn: string): Promise<BookInfo | null> => (isbn === DUNE.isbn ? DUNE : isbn === EMMA.isbn ? EMMA : null));
  const ledger = createLedger({ db: env.DB, siteUrl: "https://books.test", lookup, now: () => 1000, ...deps });
  return { ledger, lookup };
}

async function count(table: string): Promise<number> {
  return (await env.DB.prepare(`select count(*) as n from ${table}`).first<{ n: number }>())!.n;
}

async function mint(ledger: Ledger, n = 1): Promise<string[]> {
  const r = await ledger.mintLabels(natalie, n);
  if ("rejected" in r) throw new Error(r.rejected);
  return r.map((l) => l.code);
}

function ok<T>(r: T | Rejection): T {
  if (r && typeof r === "object" && "rejected" in r) throw new Error(`rejected: ${(r as Rejection).rejected}`);
  return r as T;
}

function asCopy(v: LabelView): CopyView {
  if (v.kind !== "copy") throw new Error(`expected copy, got ${v.kind}`);
  return v.copy;
}

beforeEach(async () => {
  await resetDatabase(env.DB);
  for (const m of [natalie, sam]) {
    await env.DB.prepare("insert into members (id, name, email, picture_url, created_at) values (?, ?, ?, ?, 0)")
      .bind(m.id, m.name, m.email, m.pictureUrl).run();
  }
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

test("adding by ISBN makes a copy owned and held by the adder", async () => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  const copy = ok(await ledger.add(natalie, { code, book: { isbn: "978-0-441-17271-9" } }));
  expect(copy).toMatchObject({
    code, book: DUNE,
    owner: { id: natalie.id, name: "Natalie", pictureUrl: "https://p.test/n.jpg" },
    holder: { kind: "member", person: { id: natalie.id, name: "Natalie" } },
    home: true,
    actions: [],
  });
  expect(copy.history.map((h) => h.type)).toEqual(["labelled", "added"]);
  expect(copy.history.every((h) => h.actor.id === natalie.id && h.at === 1000)).toBe(true);
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
])("adding to %s is refused", async (which, reason) => {
  const { ledger } = make();
  const [code] = await mint(ledger);
  ok(await ledger.add(natalie, { code, book: { isbn: DUNE.isbn! } }));
  const target = reason === "label-unknown" ? "abcdefghjk" : code;
  expect(await ledger.add(sam, { code: target, book: { isbn: EMMA.isbn! } })).toEqual({ rejected: reason });
  expect(await count("copies")).toBe(1);
  expect(await count("events")).toBe(2);
  expect(which).toBeTruthy();
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
  expect(asCopy(await ledger.view(code, natalie)).actions).toEqual([]);
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
