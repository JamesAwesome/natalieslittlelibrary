import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations("./migrations");
      return {
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    include: ["src/worker/**/*.test.ts"],
  },
});
