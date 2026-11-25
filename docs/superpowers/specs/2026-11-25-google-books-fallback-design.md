# Google Books as a lookup fallback

Approved by James, 2026-11-25. A small change to the book lookup module.

## Why

Open Library missed two of three real books in the step 0 test, so typing the
title is common. Natalie's StoryGraph import in step 3 (about 240 books) and
everyday pairing both get better when a second catalogue fills Open Library's
gaps. Google Books was ruled out only because it refuses requests without an API
key (spec, "Lookup sources").

## Goals

- When Open Library has no answer for an ISBN, or fails or times out, ask Google
  Books before telling the person "We couldn't find that book."
- Keep Open Library first: its covers and data are what the app was built and
  checked against.
- Work unchanged without a key: if `GOOGLE_BOOKS_API_KEY` is not set, lookups
  are Open Library only, exactly as today.

## Non-goals

- Asking both catalogues at once, or choosing between their answers.
- Searching Google Books by title (the typed-title path stays as it is).
- Re-checking books already cached from Open Library.

## Anti-goals

- Sending anything about a member to Google: the request carries the ISBN and
  the key only.
- A lookup that hangs: each source keeps its own time limit.

## Approaches

1. **Open Library first, Google Books on a miss or failure (chosen).** Uses the
   existing ordered `sources` list in `createBookLookup`. Worst case for a miss
   rises from about 4 s to about 8 s, and only on a miss.
2. Ask both in parallel and prefer Open Library's answer. Faster on a miss but
   spends Google quota on every uncached lookup, including the hits Open Library
   already answers.
3. Google Books first. Fewer misses up front, but gives up Open Library's covers
   and changes the answers the app has been tested against.

## Design

- **Adapter.** A new `BookSource` named `google-books`, built by a function that
  takes the key: `googleBooks(apiKey: string): BookSource`. It requests
  `https://www.googleapis.com/books/v1/volumes?q=isbn:<isbn13>&key=<key>` and
  reads the first item's `volumeInfo`: `title` (without `subtitle`, matching
  what Open Library gives), `authors`, and `imageLinks.thumbnail`. `totalItems: 0`
  or no items is a miss; anything unexpected is a miss; a non-2xx is a failure.
  The answer goes through `cleanBookFacts` like every source.
- **Wiring.** `src/worker/index.ts` passes `sources: [openLibrary,
  googleBooks(env.GOOGLE_BOOKS_API_KEY)]` when the key is a non-empty string,
  and the default `[openLibrary]` otherwise. The secret is optional, so it is
  not added to `secrets.required` in `wrangler.jsonc`; `pnpm types` is re-run.
- **Covers.** `safeCoverUrl` in `src/shared/bookFacts.ts` also accepts
  `books.google.com`, https only, with the same no-credentials, no-port rules.
  Google returns its thumbnail as `http://books.google.com/books/content?...`;
  the adapter upgrades it to https before cleaning, and drops `&edge=curl`.
  The ledger shares this cleaner, so a Google cover is accepted on save too.
- **Cache.** Unchanged: a found book is written to `book_lookups` with
  `source = "google-books"`; misses are not cached.
- **Key and quota.** The key is made in the existing natalieslittlelibrary
  Google Cloud project: enable the Books API, restrict the key to the Books API.
  It is stored with `wrangler secret put GOOGLE_BOOKS_API_KEY` and in
  `.dev.vars`. The free quota (about 1,000 requests a day) covers the step 3
  import and everyday pairing.
- **Tests.** The adapter against recorded fixtures (found, `totalItems: 0`,
  malformed, non-2xx, http thumbnail upgraded); lookup order (Open Library hit
  never calls Google; Open Library miss, failure, or timeout then Google; no key
  means no Google call); `safeCoverUrl` accepts the Google host and refuses
  look-alikes (`books.google.com.evil.test`, http, credentials, port). Fixtures
  are recorded once by hand with a generic client name; the key is never
  committed or written into a fixture.
- **Docs.** README "Things to know" and setup gain the optional key; the spec's
  "Lookup sources" note is updated.

## Left to the builder

The exact fixture ISBNs (one Google has and Open Library lacks is ideal), the
User-Agent string for Google requests (the app name and repo URL, as for Open
Library), and how the http-to-https upgrade is written.
