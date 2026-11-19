# Roadmap

Design: [specs/2026-11-16-little-library-design.md](superpowers/specs/2026-11-16-little-library-design.md)

Each step ends with something Natalie or James can use on a real phone. Don't
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

Dropped: the label size sheet (James chose 1×1 inch) and the test of matching
ten of Natalie's books against her StoryGraph ISBNs (James: "we don't need to
scan her personal books").

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

Done when: Natalie labels five books, James claims one by scanning it with his
camera, and Natalie sees that he has it.

Carry-overs from step 1:

- Resolve the member once per `/api/*` request in middleware so the ledger can ask who is calling.
- A shared test helper that empties all tables.
- A public member shape without email (members see names, not addresses).
- A refusal should keep `returnTo` so a person is not bounced off the book page they scanned.
- Decide whether a database outage should look different from being signed out.

## 3. Collections

My collection, what I'm holding, other members' shelves. StoryGraph import.

Done when: Natalie's ~240 books show in her collection and she can label them
without typing.

Notes carried in from step 0 and step 2:

- How well StoryGraph ISBNs match real barcodes is unknown, so the import must
  not depend on it. Keep the "is it this one?" and pick-from-unlabelled paths.
- Shelf and collection views must not include label codes. A code is the proof
  of having the book in hand, and `CopyView.code` would hand it to anyone
  browsing a shelf.
- Lookups for an import must be batched. Open Library asks clients not to send
  hundreds of single-book requests.

## 4. Owner tools

Loan to a named person without an account. Give to a member. Request and
approve ownership. Release. Replace a label.

Done when: each has been done once with a real book.

## 5. Open up

Settle the domain. Scheduled database export. Switch from the allowlist to
entry-by-label. Big print run.

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
