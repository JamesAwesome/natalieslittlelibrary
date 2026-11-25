import { env } from "cloudflare:workers";

// Both helpers intercept only `db.batch`, so a write meant to be raced must go through `db.batch([...])`, even one statement.

// A database whose batches wait until `n` of them have arrived, so n callers have all read state before any writes.
export function gated(n: number): D1Database {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return {
    prepare: (q: string) => env.DB.prepare(q),
    batch: async (stmts: D1PreparedStatement[]) => {
      if (++arrived >= n) release();
      await gate;
      return env.DB.batch(stmts);
    },
  } as unknown as D1Database;
}

// A database that runs `beforeBatch` once, just before the first batch: a change that lands between a read and its write.
export function racing(beforeBatch: () => Promise<unknown>): D1Database {
  let fired = false;
  return {
    prepare: (q: string) => env.DB.prepare(q),
    batch: async (stmts: D1PreparedStatement[]) => {
      if (!fired) {
        fired = true;
        await beforeBatch();
      }
      return env.DB.batch(stmts);
    },
  } as unknown as D1Database;
}

// A step for `racing`: runs one statement against the real database.
export const run = (sql: string, ...binds: unknown[]) => () => env.DB.prepare(sql).bind(...binds).run();
