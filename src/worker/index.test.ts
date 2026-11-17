import { env, exports } from "cloudflare:workers";
import { expect, test } from "vitest";

test("health check answers", async () => {
  const res = await exports.default.fetch("https://books.test/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("migrations created the tables", async () => {
  const { results } = await env.DB.prepare(
    "select name from sqlite_master where type = 'table' and name in ('members','identities','sessions') order by name",
  ).all();
  expect(results.map((r) => r.name)).toEqual(["identities", "members", "sessions"]);
});
