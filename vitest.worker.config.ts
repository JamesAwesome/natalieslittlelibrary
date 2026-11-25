import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations({ migrationsDir: "./drizzle", migrationsPattern: "drizzle/*/migration.sql" });
      return {
        wrangler: { configPath: "./wrangler.test.jsonc" },
        // Bindings here, not `vars` in wrangler.test.jsonc: a local .dev.vars overrides vars but not these.
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SITE_URL: "https://books.test",
            GOOGLE_CLIENT_ID: "test-client",
            GOOGLE_CLIENT_SECRET: "test-secret",
            ALLOWLIST_EMAILS: "natalie@example.com",
            ADMIN_EMAILS: "natalie@example.com",
            // Pinned empty so a real key in .dev.vars never changes test behaviour; a test that needs a key passes its own env.
            GOOGLE_BOOKS_API_KEY: "",
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    include: ["src/worker/**/*.test.ts", "src/shared/**/*.test.ts"],
  },
});
