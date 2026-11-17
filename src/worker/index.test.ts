import { env, exports } from "cloudflare:workers";
import { expect, test } from "vitest";

test("health check answers", async () => {
  const res = await exports.default.fetch("https://books.test/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

// Literal expected shape, deliberately not derived from schema.ts.
// Columns are [name, type, notnull, pk position (0 = not in key)].
const expectedShape: Record<
  string,
  { columns: [string, string, number, number][]; foreignKeys: [string, string, string][] }
> = {
  identities: {
    columns: [
      ["provider", "TEXT", 1, 1],
      ["subject", "TEXT", 1, 2],
      ["member_id", "TEXT", 1, 0],
    ],
    foreignKeys: [["member_id", "members", "id"]],
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
  },
  sessions: {
    columns: [
      ["token_hash", "TEXT", 1, 1],
      ["member_id", "TEXT", 1, 0],
      ["expires_at", "INTEGER", 1, 0],
    ],
    foreignKeys: [["member_id", "members", "id"]],
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

    const fks = await env.DB.prepare('select "from", "table", "to" from pragma_foreign_key_list(?) order by id, seq')
      .bind(table)
      .all<{ from: string; table: string; to: string }>();
    expect(
      fks.results.map((f) => [f.from, f.table, f.to]),
      `${table} foreign keys`,
    ).toEqual(expected.foreignKeys);
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
