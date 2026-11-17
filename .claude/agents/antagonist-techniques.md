# Antagonist techniques

The techniques that settled this project's false or untested claims. Each entry
is the claim, why it was believed, and what settled it. Read the whole file
before a pass; the same shapes recur. Keep it under 100 lines: when it grows,
cut the entries whose shape has not recurred.

## From step 1 (2026-11-16)

- **"The tests run against the real schema."** Believed because tests and
  production apply the same migration files. Settled by mutating the migration
  and dumping `sqlite_master` inside the test run, and by applying a newly
  generated migration to a seeded database rather than an empty one. (An empty
  database hides every migration that only fails when rows exist.)

- **"The `returnTo` cleaner blocks off-site redirects."** Believed because its
  table of cases passed. Settled by removing each guard in turn, running the
  suite, and resolving every resulting `Location` with `new URL(loc, origin)`
  the way a browser would. That exposed the tab-stripping case the table never
  covered. A list of bad inputs proves the list; assert the property.

- **"PKCE is wired end to end."** Believed because unit tests proved the
  challenge maths and that a verifier is sent at exchange. Settled with a
  cross-seam pairing mutant: swap the value on one side of the seam (authorize
  versus exchange). If the suite stays green, the pairing is untested even
  though each half is.

- **"The test proves the reload happens after logout."** Believed because the
  test asserted call order, which only proves the order the calls started.
  Settled by giving the mocked call a deferred promise: assert the second thing
  has not happened, resolve, then assert it has.

- **"A GitHub environment gates this deploy."** Believed because the workflow
  says `environment:`. Settled by checking the repository's visibility and plan
  against GitHub's per-plan availability table. Before endorsing any platform
  protection, confirm the platform offers it for this account.

- **"Only X can deploy."** Believed because the guard step refuses X's
  negatives. Settled by asking which copy of the workflow GitHub runs (the
  triggering commit's own), then testing the guard against an older ref that is
  legitimately on main, not only against illegitimate refs. A check a thing
  runs on itself stops mistakes, not intent.

## Standing facts about this codebase's tools

- D1 state is shared between tests in one file and isolated between files.
  Tests clean tables themselves.
- `wrangler types --check` compares a header hash. It catches config changes
  that were not regenerated; it does not notice hand edits to the generated
  file.
- D1 does not allow `PRAGMA foreign_keys=OFF`, so Drizzle's table-rebuild
  migrations fail on a database with rows.
- A local `.dev.vars` overrides `vars` from a Wrangler config, including in
  tests; test values live in `miniflare.bindings` for that reason.
- Google only vouches for an email that is `@gmail.com` or on a Workspace
  domain (`hd` set). Elsewhere `email_verified` can be stale.
- Google refuses OAuth in embedded browsers (in-app webviews).
