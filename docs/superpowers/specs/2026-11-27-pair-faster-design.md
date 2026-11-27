# Pair faster

Drafted 2026-11-27 from a brainstorm with mockups. A small change, client only.
Calls made without the maintainer are marked **(call)**.

## Why

Pairing is two taps deep (More → Pair a book), and a finished pair lands on
the book's page, so every next book goes through More again. Pairing will be
bulk at first (the imported books still need labels), then two or three at a
time, sometimes one.

## Goals

1. Pairing is one tap from your own wall.
2. In a run of books, the scanner comes back after each pair with no tap in
   between.
3. Pairing one book still has an obvious way to see it and to stop.

## Non-goals

- Any server change, or any change to what pairing saves or refuses.
- Changing the tab bar. It keeps its four tabs.
- Changing pairing that starts from a book (`/pair?copy=`, `&replace=1`) or
  from a scanned blank label (`/pair?label=`). Those still end on the book's
  page, as today.

## Anti-goals

- A second copy saved by a double read or a double tap.
- The camera getting slower to come back, or asking for permission again
  between books.
- The plus competing with the covers or sitting on the A–Z rail.

## Approaches considered

Where the plus goes:

- **A. A round plus beside "My books" on your wall (chosen by the
  maintainer).** The tab bar doesn't change, and the app opens on the wall.
- **B. A fifth, centre "Pair" tab.** One tap from every screen, but it
  reopens the four-tab bar from the design round and narrows every tab.
- **C. A floating round button, bottom right.** Dropped: the A–Z rail runs
  down to the bottom right, so the button would sit on it.

After a pair:

- **1. A "Paired" screen with a big "Pair another" button.** One tap per
  book.
- **2. Straight back to scanning, with a note saying what was paired
  (chosen, (call): the maintainer picked A and didn't pick here; 2 was the
  recommendation).** No tap per book; "See it" and "Done" cover the one-off.

## The design

### The plus

- On `CoverWall` with `kind="mine"` only, never on a friend's wall. The `h1`
  and the button share a row, with the button at the end.
- A link to `/pair`, drawn as a 44px accent circle with a plus (drawn like the
  tab icons). Its accessible name is "Pair a book".
- It shows whether the wall is loading, empty or full.
- More keeps its "Pair a book" entry, and the empty wall keeps its link
  **(call)**: both are harmless and someone may look for them there.

### After a pair (plain `/pair` only)

When a new pair started from plain `/pair` saves (an ISBN or typed book, then
a label), Pair goes back to the barcode step instead of going to `/b/<label>`:

- A note at the top with `role="status"` reads "Paired *Title*", with a small
  cover and a "See it" link to `/b/<label>`. Under it: "*n* paired this time",
  counted for this visit to the page **(call)**.
- If the book was an imported copy that stays in its own collection, the note
  says so: "Paired *Title*. It stays in *Collection*." This replaces today's
  separate "stays" screen for plain `/pair`.
- The prompt reads "Scan the barcode on the back of the next book." The
  scanner starts again. "No barcode? Type it in" stays, and a "Done" link goes
  to `/` (My books).
- The collection picker already remembers the last pick (`writePick`), so a
  run stays in one collection without picking again.
- Each new pair replaces the note; only the latest one shows.
- The paired label is held as refused (`refused` in `Pair.tsx`), so a label
  still in view can't be saved again.

## Constraints

- React 19, no router library, plain CSS under `src/client/styles/`, colours
  from `tokens.css` only. Light and dark settings, 44px targets, text at 4.5:1
  or better.
- Must render at 320, 375, 414 and 768px wide (`scripts/shoot.mjs`).
- Tests by role and visible text, updated in the same pull request.
- One pull request from its own branch; the maintainer merges and tags.

## Left to the builder

- How Pair's state resets between books (step, book, typed fields, code,
  pending), as long as nothing from the last book leaks into the next one.
- Where focus goes after the reset, so a screen reader hears the note and
  lands near the scanner.
- A re-read of the book just paired needs no new guard. It stops at "Is this
  the book?", and the candidates list only offers unlabelled copies
  (`unlabelled.ts` `candidates`), so the copy just labelled isn't offered
  again. Saving it a second time would take a "Yes" and a different, unused
  label: a deliberate second copy, not an accident.
