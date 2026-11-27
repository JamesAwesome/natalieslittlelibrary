# Label tools: print at once, past sheets, the owner's code, replace a label

Drafted 2026-11-26 from the maintainer's answers. It is the first of two releases for
roadmap step 4 ("Owner tools"); the second carries lending to a name, giving,
requests, release and adopt. It extends the main spec,
`docs/superpowers/specs/2026-11-16-little-library-design.md`. Calls made
without the maintainer are marked **(call)**.

## Why

Natalie is labelling about 247 imported books now. Three things got in her
way on the first night:

- Printing takes two steps: "Make labels", then "Print".
- A sheet that misprints, or a label that falls off, cannot be printed again.
- After pairing, the page does not show the book's label code.

"Replace a label", already in step 4, belongs with these: it is the fix for a
label that is damaged or lost for good.

## What the maintainer decided

- Two releases for step 4, labels first.
- Printing opens immediately after the labels are made.
- A list of previous sheets, so a sheet can be printed again.
- Re-printing may include labels already on a book, as an option, for when
  labels fall off.
- The label code is shown after pairing. **(call: to the copy's owner only;
  no objection when this was played back.)**
- A cover photo for books with none is wanted later, not in this release.

## Goals

- **Make and print in one tap.** "Make labels" makes the codes and opens the
  browser's print dialog as soon as they are on the page. A separate "Print"
  button stays, for printing the same labels again.
  **(call: "the PDF" is read as the browser's print dialog, where "Save as
  PDF" lives. The spec keeps browser printing, for exact sizes, over a PDF
  library.)**
- **Past sheets.** The labels page lists the sheets the member made, newest
  first: when, how many labels, how many are still blank, and how many are on
  books the member owns and not replaced (what the checkbox below would
  add).
  - "Print again" lays that sheet's labels out on the currently chosen sheet
    type and opens the print dialog. Labels keep their original order.
  - By default only the blank labels are printed.
  - A checkbox, "Also print labels already on my books", adds the labels
    bound to copies the member owns **(call: a bound label's code is shown
    only to the copy's current owner, the same rule as the code on the copy
    page)**. Labels on other people's books and replaced labels are never
    printed.
  - Printing again makes no new codes and changes nothing on the server.
- **The owner sees the code.** On a copy page, the owner sees the label code
  in the same small type as on the printed label. Anyone else, and the public
  view, still does not.
- **Replace a label.** The owner, from their copy's page, taps "Replace
  label" and scans or types a blank label.
  - The new label is bound to the copy.
  - The old label is retired: it stays in the database, pointing at the copy,
    with `retired_at` set. History gets one "relabelled" entry.
  - Scanning a retired label shows "This label has been replaced" and nothing
    about the book **(call: the old sticker may be on a book that has since
    been given away, so it reveals nothing)**. Claim through it is refused.
  - A copy with no label is labelled the existing way ("Put a label on it");
    replace is only offered when the copy has a label.

## Non-goals

- The ownership and lending tools (the second release).
- Cover photos.
- A PDF file made on the server or by a library.
- Printing a single label at a chosen spot on a part-used sheet.
- Showing past sheets made by other members, or sharing a sheet.

## Anti-goals

- A code shown to anyone but the person who made it (while blank) or the
  copy's owner (once bound). A code is the proof of having the book in hand:
  claim needs it.
- Re-printing creating a second working code for a copy. A re-printed label
  carries the same code; replace retires the old one.
- A schema change that rebuilds a table. Only added tables and nullable
  columns (D1 cannot turn foreign keys off).

## Design

### Data

- `labels.sheet_id`, text, nullable: the sheet a label was made in. Every
  `mintLabels` call is one sheet and gets one id.
- `labels.retired_at`, integer, nullable: set when the label is replaced.
- Existing labels form one sheet per member and minted second, computed when
  read (a label with no `sheet_id` is grouped by its minter and
  `minted_at / 1000`), so labels old code mints during the deploy also land in
  a sheet **(call: a quick three-sheet run can land in one second and so be
  listed as one sheet of up to three pages; it prints the same)**.
- A copy can now have several labels, at most one not retired. A partial
  unique index on `labels(copy_id) where retired_at is null and copy_id is
  not null` enforces it.
- Every read that joins a copy to its label joins the label that is not
  retired. A copy page reached by a code shows that code's state, not the
  joined row's (carry-over from step 2).

### Ledger

- `mintLabels(member, count)` stays, and stamps one `sheet_id`.
- `sheets(member)`: the member's sheets, newest first, with counts.
- `sheetCodes(member, sheetId, { includeMine })`: the codes to print, in
  order. Blank labels, plus, when asked, labels bound to copies the member
  owns and not retired. Someone else's sheet is `not-found`.
- `replaceLabel(owner, copyId, newCode)`: one batch, guarded in the
  statements on the state read: the actor owns the copy, the new label is
  blank, and the copy's current label is the one read. It retires the old
  label, binds the new one, and appends a `relabelled` event. A label already
  in use is `label-in-use`; an unknown one is `label-unknown`.
- `view(code)` on a retired code answers `{ kind: "retired" }`. `claim`
  through it is refused.
- `CopyView.code` keeps its meaning (the code the page was reached by, null
  by id), because claim depends on it. A new `CopyView.ownerCode` carries the
  copy's current label code for the owner, on any view, and is `null` for
  everyone else and for an unlabelled copy. Only `ownerCode` is displayed.

### Routes

- `GET /api/labels/sheets` and `GET /api/labels/sheets/:id?include=mine`,
  member-only, the second answering `{ labels: [{ code, url }] }`, as minting
  does.
- `POST /api/copies/:id/relabel` with `{ code, replacing }` to replace,
  where `replacing` is the code the owner is replacing (the "label read"
  guard) **(call: a route of its own, because the existing
  `POST /api/copies/:id/label` is "Put a label on it", which must keep
  refusing a copy that already has a label; one route choosing between the
  two by the copy's state could retire a working label unasked)**.
- The existing same-site and member guards apply.

### Client

- Labels page: "Make labels" calls `window.print()` once the new labels have
  rendered. A "Previous sheets" list below the controls, with "Print again"
  and the checkbox.
- Copy page: the owner sees the code under the cover. "Replace label" opens
  the existing label scanner (as pairing does) and confirms "Replace the
  label on <title>?" before saving.
- `/b/<retired code>`: "This label has been replaced."

## Left to the builder

- Where the past-sheets list sits on the page, and its wording.
- The date format in the list.
- Whether the alignment-test print also opens straight away (it already does).
