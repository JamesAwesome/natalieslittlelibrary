# Antagonist techniques

The techniques that settled this project's false or untested claims: the claim,
and what settled it. Read the whole file before a pass; the same shapes recur.
Keep it under 100 lines: when it grows, cut or merge the entries whose shape
has not recurred.

## Steps 1 and 2 (2026-11-16, 2026-11-25)

- **"The tests run against the real schema."** Mutate the migration and dump
  `sqlite_master` in the test run; apply new migrations to a seeded database
  (an empty one hides failures that need rows).
- **"The cleaner blocks off-site redirects" / "the cleaned value is safe."**
  Its table passed. Remove each guard in turn and resolve every emitted
  `Location` with `new URL(loc, origin)` as a browser would, feeding inputs the
  code normalises (dot segments, `%2e`, tabs). Assert the property on what the
  code emits, not a list of bad inputs.
- **"PKCE is wired end to end."** A cross-seam pairing mutant (swap the value
  on one side) that leaves the suite green means the pairing is untested.
- **"The test proves X happens after Y."** Call order proves only the order
  calls started. Give the mock a deferred promise: assert X has not happened,
  resolve, assert it has.
- **"Only X can deploy" / "an environment gates it."** Ask which copy of the
  workflow runs (the triggering commit's own); test the guard against an older
  ref on main. A check a thing runs on itself stops mistakes, not intent.
- **"The problem path is covered" / "the spy proves it."** A stubbed fetch hid
  that workerd refuses `redirect: "error"`: build a real `Request` inside
  workerd. A spy proves nothing until the environment provides the object it
  watches (`localStorage` was undefined).
- **"The screen handles it" / "the handler sends the right thing."** Make a
  value read once at load go stale and assert the way forward; call the path
  with no render between set and read and assert the request body. When a
  screen combines two reads, each value must come from the read its rows did.
- **"The label prints and scans."** Decode under real tolerance (dark surround,
  1 mm shift).
- **"Every guard condition is tested."** Remove each singly, as `(1 or cond)`,
  and in pairs where guards mask each other.

## Step 3 (2026-11-25)

- **"The drift check covers the schema."** drizzle-kit rc.5 tracks indexes by
  name only; prove drift checks attribute by attribute.
- **"The guard is tested."** Three shapes of a guard that is not: (1) a
  cross-owner guard needs the other member to hold the protected state and no
  sibling guard to refuse first; (2) a guard that goes red only through a
  neighbour's FK or NOT NULL error is not tested, so re-run with the
  neighbour's precondition true; (3) a refusal test must aim at a request a
  same-site control proves would succeed, or it passes vacuously.
- **"A lookup by id works."** Ask for a non-first row and an unknown id while
  the table has rows; one row or none hides a missing filter.
- **"The new validator or writer is equivalent."** Run old against new over a
  generated corpus split by prefix and spelling, and check every disagreement
  against the authority's list (979-1x ISBN prefixes). Race a new writer
  against the old path in BOTH directions; one order can hide the other.
- **"Session loss is recovered" / "the scanner stops."** Test 401 recovery on
  every path a page can load by (first load, reload, after an action,
  back-forward), and every branch returning to a scanner (refusal, not-found,
  remount) against a camera still on the label.

## Pair faster (2026-11-27)

- **"The link's colour beats the global `:visited` rule."** A fresh profile has
  never visited the link, and `getComputedStyle` hides visited colours. Click
  the link first, then sample rendered pixels. Swap the stylesheets' import
  order: if the colour changes, the win was source order.
- **"Nothing from the last item leaks into the next."** A screen that resets
  in place keeps whatever its reset doesn't list. Inventory every piece of
  state and late async answer that leaving the page used to throw away; drive
  each across the reset with a deferred promise and mutate each removal alone.
- **"The layout fits" / "the drawn marks stay apart."** Eyeballed crops can't
  settle a claim off by a pixel or two. Measure boxes against the container's
  border box and each glyph's text box (`Range.getBoundingClientRect`) against
  its band, across width x scheme x root font size x safe-area inset and the
  shortest landscape heights (and the WCAG colour ratio under
  `prefers-color-scheme`: audits of geometry never look at colour), then do the arithmetic: a 40px Pair disc in a
  4rem bar couldn't fit, and the new first rail mark overlapped "A" by 6.6px.
- **"The tap is only taken over on the tab's own page."** `matchRoute` keys on
  the pathname, but screens read the query: probe every link into the route
  that carries one (`/pair?copy=`, `/pair?label=`).

## Standing facts about this codebase's tools

- D1 state is shared between tests in one file and isolated between files;
  tests clean tables themselves. D1 refuses `PRAGMA foreign_keys=OFF`, so
  Drizzle's table-rebuild migrations fail on a database with rows. Two
  concurrent D1 batches that each checked state beforehand both succeed unless
  every statement is conditional on that state.
- `wrangler types --check` compares a header hash: it misses hand edits to the
  generated file. A local `.dev.vars` overrides `vars` from a Wrangler config,
  including in tests; test values live in `miniflare.bindings`, and so must any
  env var the README tells the maintainer to set.
- Google only vouches for an email that is `@gmail.com` or on a Workspace
  domain (`hd` set); elsewhere `email_verified` can be stale. Google refuses
  OAuth in embedded browsers and Google Books refuses keyless requests.
- Fake timers do not drive `AbortSignal.timeout` in the Workers test runtime.
  workerd refuses fetch `redirect: "error"`; use `"manual"` and check status.
  Node 26's built-in `localStorage` is unusable in jsdom tests; stub it.
- Chrome drops CSS backgrounds when printing unless background graphics are on
  or `print-color-adjust: exact`; draw print marks with borders.
