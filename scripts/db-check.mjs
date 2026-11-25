// Fails unless schema.ts matches the committed Drizzle migrations.
// `--explain` is a dry run: it writes no migration.
// It does not cover index shape: indexes are compared by name only, so index SQL is pinned in src/worker/index.test.ts.
import { execFileSync } from "node:child_process";

const out = execFileSync("pnpm", ["exec", "drizzle-kit", "generate", "--explain", "--output", "json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const result = JSON.parse(out.slice(out.indexOf("{")));
if (result.status !== "no_changes") {
  console.error("db:check failed: src/worker/db/schema.ts has changes not in drizzle/. Run `pnpm db:generate` and commit.");
  process.exit(1);
}
console.log("db:check ok: schema matches migrations");
