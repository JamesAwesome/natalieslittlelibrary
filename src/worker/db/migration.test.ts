import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { invariantViolations } from "../../../test/invariant";

const db = env.MIGRATION_DB;
const migrations = env.TEST_MIGRATIONS;
const i = migrations.findIndex((m) => m.queries.some((q) => q.includes("CREATE TABLE `collections`")));

const tables = ["members", "books", "copies", "labels", "events"] as const;
async function dump(): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of tables) {
    const { results } = await db.prepare(`select * from ${t} order by 1`).all<Record<string, unknown>>();
    out[t] = results;
  }
  return out;
}

// One test: the second assertion needs the pre-migration database the first one migrates.
test("the migration backfills a default per owner, and leaves the seeded rows as they were", async () => {
  expect(i).toBeGreaterThan(0);
  await applyD1Migrations(db, migrations.slice(0, i));
  await db.batch([
    db.prepare("insert into members (id, name, email, created_at) values ('natalie', 'Natalie', 'n@example.com', 1), ('sam', 'Sam', 's@example.com', 1), ('kim', 'Kim', 'k@example.com', 1)"),
    db.prepare("insert into books (id, isbn, title, authors, created_at) values ('b1', '9780000000002', 'One', '[\"A\"]', 1), ('b2', null, 'Two', '[\"B\"]', 1)"),
    db.prepare(
      `insert into copies (id, book_id, owner_id, holder_member_id, created_at) values
       ('c1', 'b1', 'natalie', 'natalie', 1), ('c2', 'b2', 'natalie', 'sam', 1), ('c3', 'b1', 'sam', 'sam', 1), ('c4', 'b2', null, 'kim', 1)`,
    ),
    db.prepare("insert into labels (code, minted_by, minted_at, copy_id, bound_at) values ('abcdefghjk', 'natalie', 1, 'c1', 2), ('bcdefghjkm', 'natalie', 1, null, null)"),
    db.prepare("insert into events (copy_id, at, actor_id, type) values ('c1', 2, 'natalie', 'added'), ('c2', 3, 'sam', 'claimed')"),
  ]);
  const before = await dump();

  await applyD1Migrations(db, migrations.slice(0, i + 1));

  const { results: collections } = await db
    .prepare("select id, owner_id, name, name_key, is_default from collections order by owner_id")
    .all<{ id: string; owner_id: string; name: string; name_key: string; is_default: number }>();
  expect(collections.map((c) => [c.owner_id, c.name, c.name_key, c.is_default])).toEqual([
    ["natalie", "Home library", "home library", 1],
    ["sam", "Home library", "home library", 1],
  ]);
  for (const c of collections) expect(c.id).toMatch(/^[0-9a-f]{32}$/);

  const { results: copies } = await db.prepare("select id, collection_id, import_isbn from copies order by id").all<{ id: string; collection_id: string | null; import_isbn: string | null }>();
  const defaultOf = Object.fromEntries(collections.map((c) => [c.owner_id, c.id]));
  expect(copies).toEqual([
    { id: "c1", collection_id: defaultOf.natalie, import_isbn: null },
    { id: "c2", collection_id: defaultOf.natalie, import_isbn: null },
    { id: "c3", collection_id: defaultOf.sam, import_isbn: null },
    { id: "c4", collection_id: null, import_isbn: null },
  ]);
  expect(await invariantViolations(db)).toEqual([]);

  const after = await dump();
  const strip = (row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(row).filter(([k]) => k !== "collection_id" && k !== "import_isbn"));
  expect({ ...after, copies: after.copies.map(strip) }).toEqual({ ...before, copies: before.copies.map(strip) });
});
