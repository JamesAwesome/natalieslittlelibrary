# Natalie's Little Library: design

Date: 2026-11-16. Status: draft for James's approval.

Lines marked **(call)** are choices made by the designer, not by James or
Natalie. Everything unmarked is what they said they want.

## Why

Natalie lent a book to a friend and forgot who. She has a few hundred books and
lends them freely, and so do her friends. Nothing records the handoff, so books
vanish. This is a shared lending record: scan the label in a book, and the
record of who has it updates itself.

Success is that the scan is easier than not scanning. A handoff that goes
unrecorded because the app was slow, down, or asked too much is the failure
this exists to prevent.

## Goals

- Every physical book has an owner, a current holder, and a permanent history
  of who has had it.
- A friend standing in a living room can scan a label with their phone's normal
  camera, log in, and claim the book in well under a minute, first time.
- Natalie can get ~240 books labelled in an afternoon without typing titles.
- Natalie can see her whole collection and who holds each book.
- Friends have collections too. Books can change owners.

## Non-goals

- Ratings, reviews, reading status. StoryGraph does that.
- Due dates, overdue reminders, notifications of any kind.
- Borrow requests inside the app. People ask each other the normal way.
- Native apps. Web only.
- Cover-photo recognition **(call: deferred, typing the title is the fallback)**.

## Anti-goals

- Feeling like a library with rules. This is friends lending to friends.
- Leaking who has what to someone who is not a member.
- Depending on a home machine being up.
- Natalie's StoryGraph reviews, ratings, or reading history ending up in the
  database or the git repo.

## The things in the system

- **Member**: a person with a Google login.
- **Book**: bibliographic facts shared by every copy: ISBN, title, authors,
  cover image link.
- **Copy**: one physical book. Has an owner (a member, or nobody once
  released), a holder, and a history. Two members can each own a copy of the
  same book **(call)**.
- **Holder** of a copy is one of: the owner (it is home), another member, or a
  named person with no account.
- **Label**: a printed QR code containing a link with a random code. Starts
  blank, then gets bound to exactly one copy.
- **History**: an append-only list of events on a copy. Nothing in it is ever
  edited or deleted.

## Labels

- We print our own, on off-the-shelf blank label sheets. Labels are blank and
  interchangeable; binding to a copy happens by scanning.
- The default label is 1×1 inch (James's decision). The sheet is picked from a
  list of common pre-cut sheets, or entered as a custom one, and the code is
  scaled to fit the label. A nudge setting corrects for printer alignment.
- A label's content is `https://<domain>/b/<code>`. The code is random and
  unguessable, because scanning a label is what lets a person in. **(call: 10
  characters from an alphabet without lookalikes, about 50 bits.)**
- The domain is one configuration value. It starts as `books.waffle.haus` and
  may become a dedicated domain. James has not committed. Test labels printed
  against the first domain must keep working, so the old hostname has to
  redirect if the domain changes. **The domain must be settled before the big
  print run.**
- The code is also printed in small human-readable text under the QR, so a
  label that will not scan can be typed in **(call)**.
- Any member can generate a sheet of blank labels **(call)**. The sheet is
  laid out in inches on a web page and printed with the browser's own print,
  not rendered to a PDF by a library **(call: fewer moving parts, and exact
  sizes)**. Either way it is done in the browser, not on the server (see
  Constraints).
- An owner can replace a damaged label by binding a fresh one to the same
  copy; the old code stops working **(call)**.

## Flows

**Pairing (getting a book in).** A member scans the book's ISBN barcode with
the in-page scanner. A barcode is accepted only after three matching frames in
a row, and the looked-up title is shown for the person to confirm before
anything is saved. This is because a single frame cannot be trusted: on an
iPhone, one barcode produced four different numbers in a row, all of which
passed the check digit, one of them starting with 978. Three frames is a
heuristic chosen from a small sample, not a measured bound; the confirmation is
what actually stops a wrong book being saved. Title, author, and cover fill in
from a lookup. They then
scan a blank label, and the copy exists with them as owner and holder. If the
member already has an unlabelled copy with that ISBN (from an import), the
label binds to that copy and no new one is made. If the ISBN does not match
but the looked-up title matches one of their unlabelled copies (a different
edition than the one recorded), the app asks "is it this one?" before making a
new copy **(call)**. No barcode, or the lookup finds nothing: type title and
author. An unlabelled copy can also be labelled straight from the collection
screen: pick it, scan a label. That is the path for imported books with no
ISBN **(call)**.

**StoryGraph import.** Natalie's export is parsed in her browser. Only rows
marked owned and in a physical format are kept, and only title, authors, ISBN,
and format leave the browser. Each becomes an unlabelled copy she owns, so her
collection is visible at once and a barcode scan should find its copy. Whether
it does depends on the edition StoryGraph recorded matching the barcode on the
physical book, which is unverified. James dropped the test of this on ten real books, so the
import must not depend on it.
Counted from the current export: 290 rows marked owned, of which 240 are
hardcover or paperback (4 without an ISBN), 42 are digital or audio and are
skipped, and 8 have no format and no ISBN and are imported as unlabelled
copies she can remove **(call)**. Importing again skips anything she already
has a copy of, matched by ISBN, or by title and author where there is no ISBN
**(call)**. The export file lives at the repo root for testing and is
gitignored.

**Claiming.** Someone scans a label with their phone camera. The link opens the
copy's page. Not logged in: they see title, authors, cover, and a login button, and no
people's names **(call)**. After Google login they land back on that same
copy's page. One tap claims it: they are now the holder, immediately, with no
approval from anyone **(call)**. The next person to do this takes it from them;
passing books along without going home first is fine.

**Coming home.** The owner marks it returned, either by scanning the label or
from their collection by hand. Only the owner can mark a return **(call)**.
When an owner opens their own copy that is out, the page offers "mark
returned"; owners never "claim" their own copy.

**Loan to someone without an account.** The owner records a loan by typing a
name. The holder is then that name.

**Changing owners.** The owner gives the copy to another member, effective
immediately **(call: no acceptance step, since it happens in person)**. Or a
member who is holding the copy requests ownership and the owner approves or
declines. Changing owner does not move the book: if it was home with the old
owner, the new owner becomes the holder; if someone else holds it, they still
do **(call)**. An open request is cancelled whenever the copy's owner or
holder changes for any other reason **(call)**.

**Releasing.** The owner releases a copy from their collection. It keeps its
label and history but has no owner, and it drops out of their collection. The
holder does not change: if it was home, the former owner is still recorded as
holding it until someone else scans it. Any member can adopt an ownerless copy
with one tap and becomes its owner and holder, including whoever is already
holding it. A book given away to a stranger simply never gets scanned again
**(call: one rule meant to cover both "I gave it away for good" and "it's free
to whoever has it"; James did not object when a shorter version was played
back)**.

### Who may do what

Claim and adopt require the label: the request must carry the copy's current
label code, which a person only has by scanning (or typing) it. A copy page
reached from someone's shelf shows the book and its history but offers neither.
Unlabelled copies cannot be claimed. Owner actions need no label, so Natalie
can manage her books from her collection by hand **(call)**.

| Action | Who | When |
|---|---|---|
| Claim | any member who is neither holder nor owner | when the copy has an owner |
| Adopt | any member, including the holder | when the copy has no owner; they become owner and holder |
| Mark returned | owner | when the holder is not the owner |
| Loan to a name | owner | any time |
| Give to a member | owner | any time |
| Request ownership | the holder, if not the owner | when no request is already open |
| Approve or decline request | owner | when a request is open |
| Release | owner | any time |
| Set or replace label | owner | any time; the label must be blank, and any previous label stops working |
| Remove a copy | owner | only if its history has no handoffs, to undo a mistake **(call)** |

## Seeing things

- **A copy's page**: book, owner, holder, history, and the actions this viewer
  may take.
- **My collection**: every copy I own, with who holds each, and which are
  still unlabelled.
- **What I'm holding**: copies I hold that someone else owns.
- **Another member's shelf**: their collection, viewable by any member.
- Members see names and history. Non-members see title, authors, and cover
  only (the first design said title and cover; authors are added
  deliberately).

## Membership

- Google login only for now. A second provider later must be an addition, not
  a rewrite: a member is keyed by provider plus the provider's user id, not by
  email **(call)**.
- Normal rule: a person can become a member only by arriving through a real
  label link (blank or bound). There is no public sign-up page.
- Testing rule: an email allowlist, held in configuration, overrides the above.
  It is checked inside the app, not with an edge gate, so nobody logs in twice
  **(call)**.
- Admins are named by email in configuration (James and Natalie to start). An
  admin can remove a member, which ends their sessions and stops them logging
  in again; their past entries in book histories stay **(call)**.
- Next to the bookshelf goes one ordinary printed QR code that opens the site,
  for pairing sessions **(call)**.

## How it gets made

Decided by James: React; Cloudflare-native hosting; Google OAuth only; web only.

Designer's calls, open to the builder to revise with reason:

- One TypeScript project. React 19 + Vite for the client, a Cloudflare Worker
  for the API, built and served together with Cloudflare's Vite plugin
  (single-page app with an integrated API is a documented use).
- D1 for data, Drizzle for schema and migrations (James already uses Drizzle).
- Hono for Worker routing.
- Google login done with a small OAuth library and our own session table in
  D1, not a full auth framework.
- Tests run in the Workers runtime against a local D1 through Cloudflare's
  Vitest integration (`@cloudflare/vitest-plugin`; the docs describe
  `@cloudflare/vitest-pool-workers` as the older package). The docs confirm D1
  bindings and `applyD1Migrations` are available in tests.
- Book lookup from Open Library only for now (see Book lookup).
- pnpm, matching James's other projects.

## Constraints

Verified against Cloudflare's docs on 2026-11-16, Workers Free plan:

- 100,000 requests a day. 10 ms of CPU per request. 50 outbound requests per
  invocation.
- D1: 5 million rows read and 100,000 rows written a day, 500 MB per database,
  point-in-time restore going back 7 days. Since September 2026, queries fail
  outright once a daily limit is passed.

What follows from that:

- The 10 ms CPU ceiling is the one that bites. Sheet layout, QR drawing, CSV
  parsing, and barcode decoding all happen in the browser. The Worker does
  short database work and little else.
- Seven days of restore is not a backup. A scheduled export of the database is
  on the roadmap before the app is opened up.
- iPhone Safari has no usable built-in barcode reader for web pages (the
  `BarcodeDetector` API is off by default), so ISBN scanning needs a bundled
  WebAssembly decoder. A throwaway test on an iPhone (2026-11-17) showed this
  works: the bundled decoder reads ISBN barcodes in the browser at about 55 ms
  a frame. iOS has no built-in decoder.
- A browser can advertise a built-in decoder that never answers (seen in
  headless Chrome). So the page proves a decoder on a code it draws itself
  before trusting it.
- Single-frame reads are unreliable, so a barcode needs three matching frames
  (see Pairing). That number is a heuristic from a small sample.
- Label scanning for claims needs no in-page scanner at all: the phone's
  camera opens the link. The in-page scanner is only for pairing and returns.
- Google refuses sign-in inside embedded browsers (in-app webviews), so a label
  link opened from inside another app cannot complete login. The phone's own
  camera and browser are the supported path, and the app must tell people in an
  embedded browser to open the link in Safari or Chrome
  ([Google's policy](https://developers.google.com/identity/protocols/oauth2/policies),
  "Use secure browsers").

## Structure

Vocabulary follows the codebase-design skill: module, interface, seam,
adapter, depth. Routes and screens are kept deliberately thin; the behaviour
lives in four deep modules and a few small ones.

```
src/
  shared/          types that cross the wire, label-link and ISBN parsing
  worker/
    index.ts       routes: translate HTTP to module calls, nothing else
    ledger/        the lending rules, labels included
    booklookup/    ISBN to book facts
    membership/    login, sessions, who may join
    db/            Drizzle schema and migrations
  client/
    scanner/       camera to a typed reading
    labelsheet/    codes to a printable page
    storygraph/    export file to a list of copies to add
    screens/       copy page, collection, holding, shelf, pair, print, import
    api.ts         typed calls to the Worker
```

### Ledger (worker)

The heart. Every rule in "Who may do what" lives here and nowhere else.

Interface:

- `view(labelCodeOrCopy, viewer)` returns unknown label, blank label, or the
  copy as this viewer may see it, including its history and **the list of
  actions this viewer may take right now**.
- `act(copy, viewer, action)` applies one action from the table; claim and
  adopt carry the label code as proof of having the book in hand (claim, adopt,
  return, loan to a name, give, request, answer request, release, set label,
  remove) and returns the new view, or a rejection saying why.
- `add(owner, book, label?)` creates a copy, or binds the label to the owner's
  matching unlabelled copy if there is one. `candidates(owner, book)` lists
  unlabelled copies that might be the same book, for the "is it this one?"
  step.
- `mintLabels(member, count)` returns fresh blank codes.
- `collection(member, viewer)` and `holding(member)`.

Why it is deep: ten actions, the permission table, the history, request
cancellation, and the ownerless-copy rule sit behind `view` and `act`. Screens
never decide whether a button shows; they render the actions `view` returned,
so what is offered and what is enforced cannot drift apart. The deletion test:
remove this module and the rules reappear in every route and every screen.

Labels live here rather than in a module of their own. A label's whole life
(blank, bound to a copy, retired) is ledger state that must change in the same
write as the copy, and a separate labels module would have had one caller.
The code alphabet, length, and collision handling are a private detail.

Inside, private to the module: a pure function that takes a copy's current
state, the viewer, and an action, and returns the events to record or a
rejection. That is an internal seam, tested directly and exhaustively against
the table. Each action writes its events and the copy's new owner, holder, and
label in one D1 batch, so history and current state cannot disagree.

Dependencies: D1, which has a local stand-in. So there is no storage port at
the interface; tests cross the same interface callers do, against local D1.

### Book lookup (worker)

Interface: `lookup(isbn)` returns book facts or not-found. It never throws for
a provider being down; a failed lookup is a not-found the member can type past.

Hides ISBN-10 and ISBN-13 normalisation, which provider answered, response
shapes, and caching found books so each ISBN is fetched once. `booklookup` owns
its own cache table; the ledger does not read it, and instead copies the book
facts onto the copy when a copy is added. This is a true external dependency
with a production adapter and a fake for tests, so the provider seam is real.

Open Library is the only source for now. Google Books refuses requests without
an API key (tested 2026-11-17); adding it later is one more adapter plus a key.
In the same test Open Library missed two real books out of three, so typing the
title is a normal path, not an edge case.

*Update 2026-11-25:* Google Books is now the second source, asked only when Open Library has no answer and a `GOOGLE_BOOKS_API_KEY` secret is set. Its answer is cached and saved like Open Library's, with source `google-books` and its cover. Without the key, lookups are Open Library only. Google's API terms restrict keeping its content; James accepted that for this private app (see the "Revision 2" section of `2026-11-25-google-books-fallback-design.md`).

### Membership (worker)

Interface: `identify(request)`; `beginLogin(returnTo, viaLabel?)`;
`completeLogin(request)` returns a session or a refusal.

Hides Google's OAuth exchange, session cookies and their storage, the
allowlist, the arrived-by-label rule, and returning the person to the copy
they scanned. Only one provider exists, so there is no provider port; Google
specifics simply stay inside this module. Google's token exchange is the one
thing faked in its tests.

### Scanner (client)

Interface: one React component that calls back with a reading: a label code,
an ISBN, or something unrecognised.

Hides camera permission and its failure states, picking the rear camera, the
bundled WebAssembly decoder (proved on a QR code before it is trusted; see the
step 2 corrections below for why there is no native adapter), and telling a label link from an ISBN barcode. Callers never see a
video element or a raw string.

### Small ones

- `labelsheet`: lays out a sheet of codes in inches for the browser's own
  print. Hides label dimensions, margins, QR error-correction level, and the
  printed code text.
- `storygraph`: `parseExport(file)` returns the copies to add. Pure. Owns the
  rule that only owned, physical rows count and only four fields survive.
- `shared`: the types in `view` and `act`, and the two parsers both sides need
  (label link, ISBN). No rules.
- The client has a small hand-written route matcher, not a routing library
  **(call)**.

### Deliberately thin

Routes, `api.ts`, and screens are pass-throughs by design. They have no
interface worth testing on their own; they are covered by a few end-to-end
tests of the main flows (pair, claim, return).

## Needed from James before step 1

A Cloudflare account with `waffle.haus` on it, DNS for `books.waffle.haus`,
and a Google OAuth client. The builder cannot create these.

## Left to the builder

- Table and column design, within the model above.
- Session lifetime, cookie details, rate limiting on lookups.
- Visual design. James may want mockups before screens are built.
- Library choices where this document says "a small library".

## Open before the big print run

- The final domain.

## Corrections from the step 2 build (2026-11-25)

Where the build departed from the text above. The text is left as written.

- **No native decoder.** The scanner always uses the bundled zxing-wasm
  decoder; the browser's own `BarcodeDetector` path was dropped. The
  three-frame rule was validated on a phone only against the bundled decoder,
  and the native proof covered QR only. The page still proves the decoder
  before trusting it, on a QR code it draws itself. So the scanner's "two
  adapters" are one.
- **Open Library User-Agent.** Open Library asks API clients to give contact
  details in the User-Agent. The app sends its name and public repository
  address but no email or phone, to keep them private, so lookups sit in the
  1 request per second tier rather than 3.
- **Round labels.** The QR is always centred. Round labels under 1.5 in
  (Avery 6450) print no code text. Elsewhere there are at least 2 modules
  between the QR and the code text, and at least 1.5 mm between any QR corner
  and the cut. A 1 in round label can therefore be scanned but not typed.
- **A typed title saves by title.** In the typing form a filled title saves
  the book by title and author with no lookup; the ISBN, if given, is not
  stored with it. An ISBN with no title goes through lookup.

## Corrections from the step 3 build (2026-11-25)

Where the build departed from the text above. The text is left as written.

- **Reads by owner and by id.** `collection(member, viewer)` became
  `collectionsOf(ownerId)` and `shelf(id)`, with `holding(member)`.
- **Copies by id.** A copy reached by id has its own page (`/copies/<id>`)
  with no code and no claim.
- **Format stays in the browser.** The text above says title, authors, ISBN and
  format leave the browser in an import. Only title, authors and ISBN do; the
  format is read in the browser to skip digital and audio rows.
- **Imported ISBNs.** An imported ISBN the lookup cannot find is kept on the
  copy as `import_isbn`, not on the shared book.
- **Lookups during an import.** Imports ask only sources that take many ISBNs
  in one request. Google Books is never asked during an import, but is asked on
  a later scan of an imported book: when a label is bound to an imported copy
  whose book has no ISBN, the single-ISBN lookup runs (enrich on bind).
- **Failed chunks.** If Open Library fails or times out for a chunk, the
  server refuses it (503, `unavailable`) and the browser retries. A chunk is
  never stored title-only because a source was down.
- **Duplicates.** A file with two copies of the same book imports one.
- **StoryGraph columns.** The import's column map (`COLUMNS` and `OWNED_VALUE`
  in `src/client/storygraph/parse.ts`) is a guess from StoryGraph's public
  export format: Title, Authors, ISBN/UID, Format, Owned?. It is pending
  James's check of the real header line; a missing column is named in the
  error, and a correction is a one-line change to that constant.
- **Collection names.** Names also refuse control, format and separator
  characters (`\p{Cf}`, `\p{Zl}`, `\p{Zp}`) and lone surrogates, beyond the
  collections design's "control and bidi-override".
- **Removed members.** A removed member's collections and shelves answer 404
  to other members, matching `/api/members` hiding them.
