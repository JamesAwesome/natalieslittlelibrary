// drizzle-kit writes drizzle/<name>/migration.sql; wrangler and the tests
// need flat files at migrations/<name>.sql.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";

execFileSync("pnpm", ["exec", "drizzle-kit", "generate", ...process.argv.slice(2)], { stdio: "inherit" });

mkdirSync("migrations", { recursive: true });
for (const entry of readdirSync("drizzle", { withFileTypes: true })) {
  const source = `drizzle/${entry.name}/migration.sql`;
  if (entry.isDirectory() && existsSync(source)) {
    copyFileSync(source, `migrations/${entry.name}.sql`);
  }
}
