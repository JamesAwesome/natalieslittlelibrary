# Roadmap

Design: [specs/2026-11-16-little-library-design.md](superpowers/specs/2026-11-16-little-library-design.md)

Each step ends with something Natalie or the maintainer can use on a real phone. Don't
start a step until the one before it has been tried for real.

## 0. Phone test (throwaway)

Done, apart from one item that has to wait for a deployed app. Results from
the test on an iPhone (2026-11-17):

- ISBN scanning works in the browser on iOS with a bundled decoder, at about
  55 ms a frame. iOS has no built-in decoder.
- Single frames are unreliable: one barcode gave four different numbers, all
  passing the check digit. Pairing needs three matching frames and a title
  confirmation.
- Labels default to 1×1 inch, on a sheet chosen from a list of common sizes.

Dropped: the label size sheet (1×1 inch was chosen) and the test of matching
ten of Natalie's books against her StoryGraph ISBNs (not needed for her personal books).

Still open: whether Google sign-in completes from inside another app's
built-in browser (a link tapped in Instagram or Messenger, a third-party
scanner app). Google refuses sign-in in embedded browsers
([policy](https://developers.google.com/identity/protocols/oauth2/policies),
"Use secure browsers"). This can only be tried after the app is deployed.
The code is thrown away.

## 1. Skeleton

Deployed at `books.waffle.haus`. Google login. Testing allowlist. Empty
database with migrations. CI.

Done when: an allowlisted person can log in on their phone and see their name;
anyone else is refused.

## 2. The core loop

Print a sheet of blank labels. Pair a book by scanning its ISBN then a label.
Copy page. Claim. Mark returned. History. The copy page detects an embedded
browser and tells the person to open it in Safari or Chrome before offering
sign-in; pages refetch who is signed in when restored from the back-forward
cache.

Built and released as v0.2.0 (2026-11-25): label sheets for six Avery layouts and plain paper, with
an alignment test and nudge; pairing by ISBN scan or typed title; the copy page
with claim, return and history; embedded-browser detection. Still to do:
the maintainer's check below, which needs the app deployed and two phones, after a
release tag. Not yet confirmed on a device: printer registration on real Avery
sheets, phone decoding of printed labels, and the sign-in round trip back to
`/pair?label=`.

Done when: Natalie labels five books, the maintainer claims one by scanning it with a
camera, and Natalie sees who has it.

Carry-overs from step 1:

- Done: resolve the member once per `/api/*` request in middleware (`src/worker/index.ts:69-77`).
- Done: a shared test helper that empties all tables (`resetDatabase`, `test/reset.ts:3`).
- Done: a public member shape without email (`Person` in `src/shared/types.ts:4` is what a copy view carries; `Member` keeps email for the viewer only, `types.ts:1`; Google's name fallback no longer uses the email, `google.ts:95`).
- Done: a refusal keeps `returnTo` (`src/worker/membership/membership.ts:163-164, 279`).
- Done: a database outage looks different from being signed out (503 `unavailable` at `src/worker/index.ts:74`, shown at `src/client/App.tsx:75`).

## 3. Collections

My collection, what I'm holding, other members' shelves. StoryGraph import.

Built and released as v0.3.0: collections with a default and a picker, shelves (mine, holding,
friends'), copies by id, moving a copy, pairing into a collection, labelling an
imported copy from its shelf, and the StoryGraph import parsed in the browser.
Still to do: the maintainer's CSV header check (the column map is a guess from
StoryGraph's public format, in `src/client/storygraph/parse.ts`), then the check
below, which needs the app deployed and Natalie's real export.

Done when: Natalie's ~240 books show in her collection and she can label them
without typing.

Carry-overs from step 3:

- A migration that backfills defaults for removed owners and pins their
  null-collection copies (old code rolled out during the migrate, build, deploy
  window can create an owned copy with a null `collection_id` for an owner with
  no default; the "next write sets it" rule cannot work for a removed owner).
  Also backfill any owned copy still null from the rollout window, creating
  defaults where missing.
- Non-UTF-8 import files: a decoded file with U+FFFD gets a warning, but the
  file is not re-decoded (Windows-1252, UTF-16).
- An owner is offered "Put a label on it" for a lent-out unlabelled copy.
- No home links on holding, copy-by-id, member shelves, or `/b/<code>`, and the
  404 pages are dead ends.
- Minors left from review: a wrong Owned value gives "0 books" with no reason;
  no feedback during the 503 backoff waits and the plural "1 books"; a
  240-row shelf renders at once and covers lack `loading="lazy"`; Mine treats a
  404 shelf as empty; Members filters the viewer twice; `useLoaded` has no
  direct test; correlated count subqueries are O(collections x copies); the byte bound on import chunks is
  not probed at its edge; stray-quote and whitespace-line CSV cases; three
  concurrent identical import chunks make three lookups; a refused `add` still
  creates the adder's default; move and label copy placeholders are plain.
- Dark-mode and 44px targets were fixed for links found in the browser pass;
  audit new screens under `prefers-color-scheme`, not only geometry.

Notes carried in from step 0 and step 2 (done in step 3 unless listed below):

- Done: import does not depend on StoryGraph ISBNs matching real barcodes;
  shelves carry no label codes; lookups are batched.

Carry-overs from step 2 taken into step 3: `parseLabelLink` now accepts one
trailing slash; eslint ignores `dist` at any depth; `toIsbn13` now accepts
979-1x ISBNs (it refused them). 979-0 is refused; an "ISBN 978-" prefix and
en/em dashes are accepted.

## 4. Owner tools

First release (label tools, `docs/superpowers/specs/2026-11-26-label-tools-design.md`):
built and released as v0.4.0: print at once, past sheets, the owner's code,
replace a label.

Second release (owner tools, `docs/superpowers/specs/2026-11-26-owner-tools-design.md`):
built and released as v0.5.0 (2026-11-26): lending to a member or a named person, giving,
requests and approval, release and take, the People page, and tombstones for
removed members.

Loan to a named person without an account. Give to a member. Request and
approve ownership. Release. Replace a label.

Carry-overs from step 3:

- Retiring a label without binding its successor in the same batch breaks the
  any-label checks and lets a stale relabel bind through relabel.ts statement 3.
  Still open: release 2 added no writer that retires a label, so nothing new
  to re-check; do it when one is added.
- Done: (owner tools) Give, adopt and approve-request ensure the new owner's
  default in the same batch and set both `owner_id` and `collection_id` in one
  statement; release nulls both.
- Done: (owner tools) `ensureDefault`'s name clash with an existing non-default
  "Home library": the default is named "Home library 2".
- "Free to claim" (a per-collection setting) has open questions: does claiming
  move ownership or only the holder, can a non-owner leave a book in the
  collection, and if books can be ownerless the first invariant needs an
  explicit exception for that collection.

Carry-overs from step 2, not touched by step 3:

- Scanner tidies: `bundledDecoder` is exported only for `check.ts`; `onRead`
  runs inside the detect try; the not-a-book message is not cleared on
  hide/show; Scanner tests do not restore `visibilityState`.
- Printing: after a partial mint, changing the sheet count drops the visible
  made labels without a message and the "N of M sheets" line lingers.
- `fetched_at` is never read, so an Open Library correction is never picked up.
  Refreshing the cache would change no stored book, because the ledger copies
  facts when a copy is added; it needs a design, not a patch.
- `returnTo` is tested only at the root route in the client; re-pin it on a
  `/b/<code>` page.

Carry-overs from step 2:

- The `type as ActionType` cast in the ledger, and its return does not
  distinguish not-allowed from not-found for a copy id.
- Removing a copy is a soft delete: events reference copies.
- Done: (label tools) Replacing a label retires the old one (`retired_at`); it
  does not unbind it.
- Columns added to existing tables must be nullable (see Known hazards).
- Done: (label tools) When a copy can have two labels, the copy view must be
  given the requested code rather than reading it from the joined label row.
  `renderCopy` takes the code in hand.
- Done: (owner tools) A copy with no member holder renders as `holder: null`, or as a placeholder holder, never as "".
- Done: (owner tools) The claim guard SQL is generalized rather than copied per action.
- The view and `COPY_SELECT` are
  near-duplicate selects. Claim on a blank label is not-found while add says
  label-unknown.

Done when: each has been done once with a real book.

## Design round (before step 5)

Added 2026-11-26: step 5 was put on hold for a full design round, inspired
by reading apps like Apple Books and Kindle. Handoff:
`docs/superpowers/handoffs/2026-11-26-design-round.md`.

Released as v0.6.0 (2026-11-27): walls of covers with an A–Z rail and filter
chips, a tab bar (Books · Holding · Friends · More), a cover-first book page,
warm light and dark looks in Fraunces and Geist, and a home-screen icon. Spec:
`docs/superpowers/specs/2026-11-26-design-round-design.md`. Still to do: the maintainer's
phone checks (listed in PR #18), including whether the home-screen icon opens in
Safari or as a web app on iOS 26. Release 2 of the round is cover photos.

## 5. Open up

Settle the domain. Scheduled database export. Switch from the allowlist to
entry-by-label. Big print run.

Carry-overs from step 2:

- `toPage`'s post-build check has no direct pin beyond the end-to-end tests;
  no tests for `%5c` / `%09` in `returnTo`; the `given_name` branch in
  `google.ts` is practically dead (Google omits it when there is no name).
- `act` does not check `removed_at`; membership does, leaving a one-request
  window after a removal.
- Refusals re-serialise the query (`%20` becomes `+`, `?a` becomes `?a=`), and
  percent-encoding can grow a 1000-character `returnTo` to about 9 KB of
  `Location`. The API's `onError` matches `/api/` but not a bare `/api`. The
  16 KB body-limit test cannot tell "refused unread" from "read then measured".
- Unconfirmed until it runs for real: the 10 ms CPU limit under large bodies,
  and Cloudflare decoding percent-encoded `/auth` paths before routing.

Carry-overs from step 1:

- Removing a member has to survive them signing in with a different Google
  account on the same email address. Today membership is keyed by Google
  account, so a removed person could rejoin that way.
- Admin rights follow whatever email Google currently reports for an account.
  Decide whether admin should be pinned to the account instead.

Done when: a friend who was never on the allowlist scans a book and claims it.

## Later, not planned

Cover-photo recognition. A second login provider. Due dates. Borrow requests.
Notifications.

## Known hazards

- Drizzle rebuilds a table to make a column nullable (and similar changes),
  and that migration begins with `PRAGMA foreign_keys=OFF`. D1 does not allow
  turning foreign keys off, so the migration fails on a database that already
  has rows; this was demonstrated locally during step 1. Before the first
  schema change after real data exists, work out a rebuild recipe and test it
  against a populated local database. See
  [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/).
- A migration that fails after it applied, or a deploy that fails after the
  migration, leaves new schema under old code and nothing rolls back. Every
  migration must work with the code already deployed (add first, remove in a
  later release). D1 Time Travel is the way back
  ([docs](https://developers.cloudflare.com/d1/reference/time-travel/); the
  free plan keeps 7 days).

## Decisions still open

- Final domain (blocks step 5, and any label meant to last).
