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

- **"A GitHub environment gates this deploy" / "Only X can deploy."** Believed
  because the workflow says `environment:` and the guard refuses X's negatives.
  Settled by checking the plan's per-platform availability, and by testing the
  guard against an older ref legitimately on main. A check a thing runs on
  itself stops mistakes, not intent.

## From step 2 (2026-11-25)

- **"The cleaned value is safe after we rebuild it with URL."** Believed because
  the cleaner's table passed. Settled by feeding inputs the transformation
  normalises (dot segments, `%2e`) and resolving the output as a browser would.
  Validate what the code emits, not what it was given.

- **"The problem path is covered."** Believed because a mock pinned it. Settled
  by checking how the real dependency fails: a stubbed fetch hid that workerd
  refuses `redirect: "error"`, which broke every real sign-in. Build a real
  `Request` inside workerd.

- **"The screen handles it."** Believed because the text was asserted. Settled
  by changing the state that makes a value read once at load go stale, then
  asserting the way forward (a link, a working button), not only the words.

- **"The handler sends the right thing."** Believed because a render followed
  the state change. Settled by calling the path with no render between set and
  read, asserting the request body. A stale closure sent the previous state.

- **"The label prints and scans."** Believed because it decodes at nominal
  position. Settled by decoding under real-world tolerance (dark surround,
  1 mm shift). A physical artefact is proven under the error the world adds.

- **"The failure path works."** Believed because the dependency was broken in
  the test. Settled by sending the credentials a real browser would, so the
  dependent path actually runs instead of stopping at the front door.

- **"The table covers the cases."** Believed because every row passed. Rows
  written to fit a regex prove nothing; check against an independently
  maintained list (user-agent tokens, here).

- **"Every guard condition is tested."** Believed because a wholesale mutant
  turned a test red. Settled by removing each condition singly, as
  `(1 or cond)`, and watching a test go red. Guards that mask each other need
  a direct test each; remove layers singly and in pairs.

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
- Google Books refuses keyless requests.
- Fake timers do not drive `AbortSignal.timeout` in the Workers test runtime.
- Two concurrent D1 batches that each checked state beforehand both succeed
  unless every statement is conditional on that state.
- workerd refuses fetch `redirect: "error"`; use `"manual"` and check status.
- Node 26's built-in `localStorage` is unusable in jsdom tests; stub it.
- Chrome drops CSS backgrounds when printing unless background graphics are on
  or `print-color-adjust: exact`; draw print marks with borders.
