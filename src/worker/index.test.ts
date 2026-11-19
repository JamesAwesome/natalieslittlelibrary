import { env, exports } from "cloudflare:workers";
import { expect, test } from "vitest";

test("health check answers", async () => {
  const res = await exports.default.fetch("https://books.test/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

// Literal expected shape, deliberately not derived from schema.ts.
// Columns are [name, type, notnull, pk position (0 = not in key)]; foreign keys are sorted by column, since SQLite lists them in reverse declaration order.
const expectedShape: Record<
  string,
  {
    columns: [string, string, number, number][];
    foreignKeys: [string, string, string][];
    indexes: string[];
  }
> = {
  identities: {
    columns: [
      ["provider", "TEXT", 1, 1],
      ["subject", "TEXT", 1, 2],
      ["member_id", "TEXT", 1, 0],
    ],
    foreignKeys: [["member_id", "members", "id"]],
    indexes: [],
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
    indexes: [],
  },
  sessions: {
    columns: [
      ["token_hash", "TEXT", 1, 1],
      ["member_id", "TEXT", 1, 0],
      ["expires_at", "INTEGER", 1, 0],
    ],
    foreignKeys: [["member_id", "members", "id"]],
    indexes: [],
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
    indexes: ["books_isbn_unique"],
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
      ["book_id", "books", "id"],
      ["holder_member_id", "members", "id"],
      ["owner_id", "members", "id"],
    ],
    indexes: ["copies_holder_member_id_idx", "copies_owner_id_idx"],
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
      ["copy_id", "copies", "id"],
      ["minted_by", "members", "id"],
    ],
    indexes: ["labels_copy_id_idx"],
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
      ["actor_id", "members", "id"],
      ["copy_id", "copies", "id"],
    ],
    indexes: ["events_copy_id_id_idx"],
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
    indexes: [],
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

    const fks = await env.DB.prepare('select "from", "table", "to" from pragma_foreign_key_list(?) order by "from"')
      .bind(table)
      .all<{ from: string; table: string; to: string }>();
    expect(
      fks.results.map((f) => [f.from, f.table, f.to]),
      `${table} foreign keys`,
    ).toEqual(expected.foreignKeys);

    const indexes = await env.DB.prepare("select name from pragma_index_list(?) where origin = 'c' order by name")
      .bind(table)
      .all<{ name: string }>();
    expect(
      indexes.results.map((i) => i.name),
      `${table} indexes`,
    ).toEqual(expected.indexes);
  }
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
