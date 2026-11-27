# Antagonist techniques

The techniques that settled this project's false or untested claims. Each entry
is the claim, why it was believed, and what settled it. Read the whole file
before a pass; the same shapes recur. Keep it under 100 lines: when it grows,
cut or merge the entries whose shape has not recurred.

## Steps 1 and 2 (2026-11-16, 2026-11-25)

- **"The tests run against the real schema."** Believed because tests and
  production apply the same migrations. Settled by mutating the migration and
  dumping `sqlite_master` in the test run, and by applying a new migration to a
  seeded database (an empty one hides migrations that fail only with rows).
- **"The cleaner blocks off-site redirects" / "the cleaned value is safe."**
  Believed because its table passed. Settled by removing each guard in turn and
  resolving every emitted `Location` with `new URL(loc, origin)` as a browser
  would, feeding inputs the code normalises (dot segments, `%2e`, tabs). A list
  of bad inputs proves the list; assert the property on what the code emits.
- **"PKCE is wired end to end."** Believed because each half was unit tested.
  Settled with a cross-seam pairing mutant: swap the value on one side. If the
  suite stays green, the pairing is untested.
- **"The test proves X happens after Y."** Believed because it asserted call
  order, which proves only the order calls started. Settled by giving the mock
  a deferred promise: assert X has not happened, resolve, assert it has.
- **"Only X can deploy" / "an environment gates it."** Believed because the
  workflow says so. Settled by asking which copy of the workflow runs (the
  triggering commit's own) and testing the guard against an older ref on main.
  A check a thing runs on itself stops mistakes, not intent.
- **"The problem path is covered."** Believed because a mock pinned it. A
  stubbed fetch hid that workerd refuses `redirect: "error"`. Build a real
  `Request` inside workerd; send the credentials a real browser would.
- **"The screen handles it" / "the handler sends the right thing."** Believed
  because text was asserted or a render followed. Settled by making a value read
  once at load go stale and asserting the way forward (a link, a working
  button), and by calling the path with no render between set and read and
  asserting the request body (a stale closure sent the previous state).
- **"The label prints and scans."** Believed because it decodes nominally.
  Settled by decoding under real tolerance (dark surround, 1 mm shift).
- **"Every guard condition is tested."** Believed because a wholesale mutant
  turned a test red. Settled by removing each condition singly, as
  `(1 or cond)`, and singly and in pairs where guards mask each other.

## Step 3 (2026-11-25)

- **"The drift check covers the schema."** drizzle-kit rc.5 tracks indexes by
  name only, so a changed WHERE, uniqueness or column list passes. Prove a
  drift check attribute by attribute; the stored-shape test pins index SQL.
- **"The guard is tested."** Three shapes of a guard that is not:
  (1) a cross-owner guard is only tested when the other member holds the state
  the guard protects and no sibling guard refuses first; (2) a guard that goes
  red only through a neighbour's FK or NOT NULL error is not tested, so re-run
  with the neighbour's precondition true; (3) a refusal test must aim at a
  request a same-site control proves would succeed, or it passes vacuously.
- **"A lookup by id works."** Ask for a non-first row and an unknown id while
  the table has rows; one row and an empty table both hide a missing filter.
- **"The new validator is equivalent."** When one changes, run old against new
  over a generated corpus split by prefix and spelling, and check every
  disagreement against the authority's list. The 979-1x ISBN prefixes (France,
  Korea, Italy, Spain) were refused by a regex whose table all passed.
- **"The new writer is safe."** Race it against the old path in BOTH
  directions; one order can pass because the other side's guard is the one
  doing the work.
- **"Session loss is recovered."** Test 401 recovery on every path a page can
  load by (first load, reload, after an action, back-forward), not one.
- **"The screen is consistent."** When a screen combines two reads, every
  value must come from the same read as the rows it describes; a heading count
  from a summary beside rows from a shelf disagree after a change elsewhere.
- **"The scanner stops."** Check every branch that returns to a scanner (a
  refusal, a not-found, a remount) against a camera still on the label.
- **"The spy proves it."** A spy proves nothing until the environment provides
  the object it watches (`localStorage` was undefined, so the test was vacuous).
- **"The layout audit passed."** Geometry audits never look at colour; compute
  the WCAG ratio of computed link colour against background under
  `prefers-color-scheme` (default blue on dark was 1.89:1).
- **"The README setting is covered."** An env var the README tells the maintainer to set
  locally must be pinned in `miniflare.bindings`, or a real key changes tests.

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
- Google refuses OAuth in embedded browsers. Google Books refuses keyless
  requests.
- Fake timers do not drive `AbortSignal.timeout` in the Workers test runtime.
- Two concurrent D1 batches that each checked state beforehand both succeed
  unless every statement is conditional on that state.
- workerd refuses fetch `redirect: "error"`; use `"manual"` and check status.
- Node 26's built-in `localStorage` is unusable in jsdom tests; stub it.
- Chrome drops CSS backgrounds when printing unless background graphics are on
  or `print-color-adjust: exact`; draw print marks with borders.
