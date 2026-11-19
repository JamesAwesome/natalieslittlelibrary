import { env, exports } from "cloudflare:workers";
import { expect, test } from "vitest";
import { resetDatabase } from "../../test/reset";

test("health check answers", async () => {
  const res = await exports.default.fetch("https://books.test/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

// Literal expected shape, deliberately not derived from schema.ts.
// Columns are [name, type, notnull, pk position (0 = not in key)].
// Foreign keys are [from, table, to, on_update, on_delete], sorted by column (SQLite lists them in reverse declaration order).
// Indexes are every index SQLite reports, including the automatic ones behind PRIMARY KEY and UNIQUE constraints:
// [name, unique, origin (c = CREATE INDEX, u = UNIQUE constraint, pk = primary key), partial, ordered columns], sorted by name.
const expectedShape: Record<
  string,
  {
    columns: [string, string, number, number][];
    foreignKeys: [string, string, string, string, string][];
    indexes: [string, number, string, number, string[]][];
  }
> = {
  identities: {
    columns: [
      ["provider", "TEXT", 1, 1],
      ["subject", "TEXT", 1, 2],
      ["member_id", "TEXT", 1, 0],
    ],
    foreignKeys: [["member_id", "members", "id", "NO ACTION", "NO ACTION"]],
    indexes: [["sqlite_autoindex_identities_1", 1, "pk", 0, ["provider", "subject"]]],
  },
  members: {
    columns: [
      ["id", "TEXT", 1, 1],
      ["name", "TEXT", 1, 0],
      ["email", "TEXT", 1, 0],
      ["picture_url", "TEXT", 0, 0],
      ["created_at", "INTEGER", 1, 0],
      ["removed_at", "INTEGER", 0, 0],
    ],
    foreignKeys: [],
    indexes: [["sqlite_autoindex_members_1", 1, "pk", 0, ["id"]]],
  },
  sessions: {
    columns: [
      ["token_hash", "TEXT", 1, 1],
      ["member_id", "TEXT", 1, 0],
      ["expires_at", "INTEGER", 1, 0],
    ],
    foreignKeys: [["member_id", "members", "id", "NO ACTION", "NO ACTION"]],
    indexes: [["sqlite_autoindex_sessions_1", 1, "pk", 0, ["token_hash"]]],
  },
  books: {
    columns: [
      ["id", "TEXT", 1, 1],
      ["isbn", "TEXT", 0, 0],
      ["title", "TEXT", 1, 0],
      ["authors", "TEXT", 1, 0],
      ["cover_url", "TEXT", 0, 0],
      ["created_at", "INTEGER", 1, 0],
    ],
    foreignKeys: [],
    indexes: [
      ["books_isbn_unique", 1, "c", 0, ["isbn"]],
      ["sqlite_autoindex_books_1", 1, "pk", 0, ["id"]],
    ],
  },
  copies: {
    columns: [
      ["id", "TEXT", 1, 1],
      ["book_id", "TEXT", 1, 0],
      ["owner_id", "TEXT", 0, 0],
      ["holder_member_id", "TEXT", 0, 0],
      ["created_at", "INTEGER", 1, 0],
    ],
    foreignKeys: [
      ["book_id", "books", "id", "NO ACTION", "NO ACTION"],
      ["holder_member_id", "members", "id", "NO ACTION", "NO ACTION"],
      ["owner_id", "members", "id", "NO ACTION", "NO ACTION"],
    ],
    indexes: [
      ["copies_holder_member_id_idx", 0, "c", 0, ["holder_member_id"]],
      ["copies_owner_id_idx", 0, "c", 0, ["owner_id"]],
      ["sqlite_autoindex_copies_1", 1, "pk", 0, ["id"]],
    ],
  },
  labels: {
    columns: [
      ["code", "TEXT", 1, 1],
      ["minted_by", "TEXT", 1, 0],
      ["minted_at", "INTEGER", 1, 0],
      ["copy_id", "TEXT", 0, 0],
      ["bound_at", "INTEGER", 0, 0],
    ],
    foreignKeys: [
      ["copy_id", "copies", "id", "NO ACTION", "NO ACTION"],
      ["minted_by", "members", "id", "NO ACTION", "NO ACTION"],
    ],
    indexes: [
      ["labels_copy_id_idx", 0, "c", 0, ["copy_id"]],
      ["sqlite_autoindex_labels_1", 1, "pk", 0, ["code"]],
    ],
  },
  events: {
    // The one key not declared at table level: AUTOINCREMENT needs a column-level INTEGER PRIMARY KEY, which reports notnull 0.
    columns: [
      ["id", "INTEGER", 0, 1],
      ["copy_id", "TEXT", 1, 0],
      ["at", "INTEGER", 1, 0],
      ["actor_id", "TEXT", 1, 0],
      ["type", "TEXT", 1, 0],
    ],
    foreignKeys: [
      ["actor_id", "members", "id", "NO ACTION", "NO ACTION"],
      ["copy_id", "copies", "id", "NO ACTION", "NO ACTION"],
    ],
    indexes: [["events_copy_id_id_idx", 0, "c", 0, ["copy_id", "id"]]],
  },
  book_lookups: {
    columns: [
      ["isbn", "TEXT", 1, 1],
      ["title", "TEXT", 1, 0],
      ["authors", "TEXT", 1, 0],
      ["cover_url", "TEXT", 0, 0],
      ["source", "TEXT", 1, 0],
      ["fetched_at", "INTEGER", 1, 0],
    ],
    foreignKeys: [],
    indexes: [["sqlite_autoindex_book_lookups_1", 1, "pk", 0, ["isbn"]]],
  },
};

test("migrations created the tables", async () => {
  for (const [table, expected] of Object.entries(expectedShape)) {
    const columns = await env.DB.prepare(
      "select name, type, \"notnull\", pk from pragma_table_info(?) order by cid",
    )
      .bind(table)
      .all<{ name: string; type: string; notnull: number; pk: number }>();
    expect(
      columns.results.map((c) => [c.name, c.type, c.notnull, c.pk]),
      `${table} columns`,
    ).toEqual(expected.columns);

    const fks = await env.DB.prepare('select "from", "table", "to", on_update, on_delete from pragma_foreign_key_list(?) order by "from"')
      .bind(table)
      .all<{ from: string; table: string; to: string; on_update: string; on_delete: string }>();
    expect(
      fks.results.map((f) => [f.from, f.table, f.to, f.on_update, f.on_delete]),
      `${table} foreign keys`,
    ).toEqual(expected.foreignKeys);

    const list = await env.DB.prepare('select name, "unique", origin, partial from pragma_index_list(?) order by name')
      .bind(table)
      .all<{ name: string; unique: number; origin: string; partial: number }>();
    const indexes: [string, number, string, number, string[]][] = [];
    for (const i of list.results) {
      const cols = await env.DB.prepare("select name from pragma_index_info(?) order by seqno")
        .bind(i.name)
        .all<{ name: string }>();
      indexes.push([i.name, i.unique, i.origin, i.partial, cols.results.map((c) => c.name)]);
    }
    expect(indexes, `${table} indexes`    ).toEqual(expected.indexes);
  }
});

test("the database holds exactly these tables", async () => {
  const { results } = await env.DB.prepare(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'd1_%' and name not like '_cf_%' order by name",
  ).all<{ name: string }>();
  expect(results.map((t) => t.name)).toEqual(Object.keys(expectedShape).sort());
});

test("events is created with AUTOINCREMENT, so ids are never reused", async () => {
  const row = await env.DB.prepare("select sql from sqlite_master where type = 'table' and name = 'events'").first<{
    sql: string;
  }>();
  expect(row!.sql).toContain("AUTOINCREMENT");
});

test("books: many NULL isbns coexist, a repeated isbn is refused", async () => {
  await resetDatabase(env.DB);
  const insert = (id: string, isbn: string | null) =>
    env.DB.prepare("insert into books (id, isbn, title, authors, created_at) values (?, ?, 'T', '[]', 1)").bind(id, isbn);
  await env.DB.batch([insert("n1", null), insert("n2", null), insert("i1", "9780000000002")]);
  await expect(insert("i2", "9780000000002").run()).rejects.toThrow(/UNIQUE/);
  await resetDatabase(env.DB);
});

test("me is null when signed out", async () => {
  const res = await exports.default.fetch("https://books.test/api/me");
  expect(await res.json()).toEqual({ member: null });
});

test("login redirects to Google with our client id", async () => {
  const res = await exports.default.fetch("https://books.test/auth/login?returnTo=/b/abc", { redirect: "manual" });
  expect(res.status).toBe(302);
  const to = new URL(res.headers.get("location")!);
  expect(to.hostname).toBe("accounts.google.com");
  expect(to.searchParams.get("client_id")).toBe("test-client");
});

test("logout by GET is not allowed", async () => {
  const res = await exports.default.fetch("https://books.test/auth/logout");
  expect(res.status).toBe(404);
});

test("me and login are marked no-store", async () => {
  const me = await exports.default.fetch("https://books.test/api/me");
  expect(me.headers.get("cache-control")).toBe("no-store");
  const login = await exports.default.fetch("https://books.test/auth/login", { redirect: "manual" });
  expect(login.headers.get("cache-control")).toBe("no-store");
});

test("a callback without a login cookie is refused as failed, uncached", async () => {
  const res = await exports.default.fetch("https://books.test/auth/callback?code=x&state=y", { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?refused=failed");
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("logout without a session answers 204, uncached", async () => {
  const res = await exports.default.fetch("https://books.test/auth/logout", { method: "POST" });
  expect(res.status).toBe(204);
  expect(res.headers.get("cache-control")).toBe("no-store");
});
