import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      // Test values for these come from miniflare.bindings in vitest.worker.config.ts.
    }
  }
}
