import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { resetDatabase } from "../../test/reset";

test("reset empties every table, parents and children alike", async () => {
  await env.DB.batch([
    env.DB.prepare("insert into members (id, name, email, created_at) values ('m1', 'N', 'n@example.com', 1)"),
    env.DB.prepare("insert into identities (provider, subject, member_id) values ('google', 'g-1', 'm1')"),
    env.DB.prepare("insert into sessions (token_hash, member_id, expires_at) values ('h', 'm1', 2)"),
  ]);
  await resetDatabase(env.DB);
  const { results } = await env.DB.prepare(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'd1_%' and name not like '_cf_%'",
  ).all<{ name: string }>();
  expect(results.length).toBeGreaterThanOrEqual(3);
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
