# Google Books suggestions when Open Library misses

> **Superseded.** What ships is **Revision 2** at the end of this document:
> Google Books fills in books Open Library lacks, automatically, covers
> included. The pre-fill design, goals, non-goals and anti-goals below are
> kept as the record of the detour.

Approved by James, 2026-11-25. Revised the same day, after the antagonist pass,
from "Google Books fills in the book" to "Google Books pre-fills the typing
form" (see Approaches).

## Why

Open Library missed two of three real books in the step 0 test, so typing the
title is common. Natalie's StoryGraph import in step 3 (about 240 books) and
everyday pairing both get easier if a second catalogue can suggest the title
and author for the person to check. Google Books was ruled out only because
it refuses requests without an API key (spec, "Lookup sources").

## Goals

- When Open Library has no answer for a scanned or typed ISBN, ask Google
  Books for a suggestion. The "type the title" form then opens with Google's
  title and author already filled in, under a "Suggested by Google Books"
  line that links to the book's Google Books page.
- The person checks or edits the form and saves it. The book is saved the way
  a typed title is saved today.
- Without a key nothing changes: if `GOOGLE_BOOKS_API_KEY` is not set, no
  suggestion is made.

## Non-goals

- Covers from Google, and any Google result saved without the person's
  confirmation.
- Caching Google answers.
- Searching Google Books by title.

## Anti-goals

- Keeping a store of Google's content. Google's API terms (§5(e)(1)) forbid
  permanent copies or databases beyond what its cache headers allow, and its
  branding rules require attribution and a link wherever results are shown.
- Members' browsers contacting Google. They only reach Google if someone taps
  the attribution link. Google cover images would load from books.google.com
  on every page view, including the public label page.
- Sending anything about a member to Google: the server's request carries the
  ISBN, the key and the app's User-Agent (its name and repo URL), and no member data.

## Approaches

1. **Google fills the book in automatically** (built first, then rejected).
   This stores Google's data permanently, which the terms forbid, and has
   members' browsers load Google covers.
2. **Pre-fill only (chosen).** Google's title and author become a suggestion
   in the typing form, with attribution and a link. There is no Google cover
   and no Google cache. This lowers the terms problem without fully removing
   it: what is saved is the person's confirmed entry, not a copy kept
   automatically. Books found this way have no cover.
3. **Drop Google Books.** Open Library and typing only, as today.

## Design

- **Lookup is unchanged.** It asks Open Library only and caches as today. The
  ledger's add-by-ISBN still uses it. The earlier change that let
  `safeCoverUrl` accept `books.google.com` is reverted.
- **Suggestion.**
  - The booklookup module gains `suggest(isbn): Promise<Suggestion | null>`,
    where `Suggestion = { title: string; authors: string[]; link: string }`.
  - It asks Google Books (`volumes?q=isbn:…&key=…`, the adapter already
    built). The volume must list the scanned ISBN (as an ISBN-13, or the
    ISBN-10 it maps to).
  - Title and authors are cleaned with the same rules as book facts.
  - `link` is built from the volume's `id`:
    `https://books.google.com/books?id=<id>`. The id must match
    `^[A-Za-z0-9_-]{1,64}$`; otherwise there is no suggestion. Google's own
    links are not used (`canonicalVolumeLink` can be on play.google.com, and
    `infoLink` is http), and the pattern means the link cannot carry the key.
  - Nothing is cached or written.
  - It has its own time limit, and any failure means no suggestion.
- **Route.** `GET /api/books/lookup` returns `{ book, suggestion }`. The
  suggestion is fetched only when `book` is null and a key is set; otherwise
  it is null. The route's existing member and same-site rules apply.
- **Client.**
  - On a miss, the "We couldn't find that book." screen stays as it is.
  - **Type the title** opens the form with the suggestion's title and first
    author filled in. Above the fields is a line, "Suggested by Google
    Books", linking to `link` (new tab, `rel="noopener noreferrer"`).
  - Saving goes through the existing typed-title path.
  - With no suggestion the form is empty, as today.
- **Key and tests.**
  - The key is made in the natalieslittlelibrary Google Cloud project, with
    the Books API enabled and the key restricted to it. It is stored with
    `wrangler secret put GOOGLE_BOOKS_API_KEY` and in `.dev.vars`.
  - `vitest.worker.config.ts` pins `GOOGLE_BOOKS_API_KEY: ""` in
    `miniflare.bindings`, so a real key in `.dev.vars` never changes test
    behaviour. One route test overrides it with a key.
- **Docs.**
  - README: item 7 says Open Library supplies books, and Google Books, when
    keyed, suggests a title to confirm.
  - The setup notes list the optional key.
  - The spec's "Lookup sources" note records the change and the terms.

## Left to the builder

How the route test sets a key, and the exact wording around the attribution
line, which must contain "Google Books" and link to the book's page.

## Revision 2 (James, 2026-11-25): automatic fill again

James decided this is a small private app and Google's API terms (no permanent
copies, attribution, per-book links) are not a concern for it, so Google
Books answers are saved automatically, with their covers, as in the first
design. The pre-fill suggestion (Revision 1) is removed. Saving by ISBN means
later scans and the step 3 import match these books.

What stays from the review rounds: the volume must list the scanned ISBN
(ISBN-13, or the ISBN-10 that maps to it); the key goes in the request
through `URLSearchParams`; a non-2xx answer is a failure; each source has its
own time limit; tests pin `GOOGLE_BOOKS_API_KEY: ""`; and no stored row, cover
URL or response contains the key.

One mitigation for the risk that was accepted: cover images are requested with
`referrerPolicy="no-referrer"`, so Google (and Open Library) are not told which
page showed the cover. Members' browsers still contact `books.google.com` to
load those covers; that is the cost of showing them.

