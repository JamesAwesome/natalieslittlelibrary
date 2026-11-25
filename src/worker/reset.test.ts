import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { resetDatabase } from "../../test/reset";

test("reset empties every table, parents and children alike", async () => {
  await env.DB.batch([
    env.DB.prepare("insert into members (id, name, email, created_at) values ('m1', 'N', 'n@example.com', 1)"),
    env.DB.prepare("insert into identities (provider, subject, member_id) values ('google', 'g-1', 'm1')"),
    env.DB.prepare("insert into sessions (token_hash, member_id, expires_at) values ('h', 'm1', 2)"),
    env.DB.prepare("insert into books (id, isbn, title, authors, created_at) values ('b1', '9780000000002', 'T', '[\"A\"]', 1)"),
    env.DB.prepare("insert into collections (id, owner_id, name, name_key, is_default, created_at) values ('k1', 'm1', 'Home library', 'home library', 1, 1)"),
    env.DB.prepare("insert into copies (id, book_id, owner_id, holder_member_id, collection_id, created_at) values ('c1', 'b1', 'm1', 'm1', 'k1', 1)"),
    env.DB.prepare("insert into labels (code, minted_by, minted_at, copy_id, bound_at) values ('abcdefghjk', 'm1', 1, 'c1', 2)"),
    env.DB.prepare("insert into events (copy_id, at, actor_id, type) values ('c1', 3, 'm1', 'claimed')"),
    env.DB.prepare("insert into book_lookups (isbn, title, authors, source, fetched_at) values ('9780000000002', 'T', '[\"A\"]', 'openlibrary', 1)"),
  ]);
  await resetDatabase(env.DB);
  const { results } = await env.DB.prepare(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'd1_%' and name not like '_cf_%'",
  ).all<{ name: string }>();
  expect(results.length).toBeGreaterThanOrEqual(9);
  for (const { name } of results) {
    const row = await env.DB.prepare(`select count(*) as n from "${name}"`).first<{ n: number }>();
    expect(row!.n, name).toBe(0);
  }
});

test("reset leaves the migrations table alone", async () => {
  await resetDatabase(env.DB);
  const row = await env.DB.prepare("select count(*) as n from d1_migrations").first<{ n: number }>();
  expect(row!.n).toBeGreaterThan(0);
});
