# Roadmap

Design: [specs/2026-11-16-little-library-design.md](superpowers/specs/2026-11-16-little-library-design.md)

Each step ends with something Natalie or James can use on a real phone. Don't
start a step until the one before it has been tried for real.

## 0. Phone test (throwaway)

Answer three questions before building anything:

- Does ISBN barcode scanning work in the browser on Natalie's iPhone and on an
  Android phone?
- How small can a printed QR label be and still scan in poor light?
- Scan ten of Natalie's books: how many barcodes match the ISBN in her
  StoryGraph export?
- Does Google sign-in complete when a link is opened from the phone's camera,
  and what happens inside another app's built-in browser (a link tapped in
  Instagram or Messenger, a third-party scanner app)? Google refuses sign-in
  in embedded browsers and shows its own error page
  ([policy](https://developers.google.com/identity/protocols/oauth2/policies),
  "Use secure browsers").

Done when: all four have answers and a label size is chosen. The code is
thrown away.

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

## 3. Collections

My collection, what I'm holding, other members' shelves. StoryGraph import.

Done when: Natalie's ~240 books show in her collection and she can label them
without typing.

## 4. Owner tools

Loan to a named person without an account. Give to a member. Request and
approve ownership. Release. Replace a label.

Done when: each has been done once with a real book.

## 5. Open up

Settle the domain. Scheduled database export. Switch from the allowlist to
entry-by-label. Big print run.

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
