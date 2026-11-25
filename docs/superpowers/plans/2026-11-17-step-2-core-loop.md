# Step 2: The Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task also gets an antagonist pass (`.claude/agents/antagonist.md`) alongside its ordinary review.

**Goal:** A member can print a sheet of blank labels, pair a book to a label by scanning its ISBN and then the label, and anyone who scans that label can sign in and claim the book; the owner can mark it returned, and the book's page shows who has it and its history.

**Architecture:** Two new deep modules on the Worker, `ledger` (every lending rule, labels included) and `booklookup` (ISBN to book facts), and one on the client, `scanner` (camera to a typed reading). Routes and screens stay thin: screens render the actions the ledger says the viewer may take, so what is offered and what is enforced cannot disagree.

**Tech Stack:** as step 1 (pnpm, React 19, Vite, Cloudflare Worker, Hono, D1, Drizzle, Vitest), plus `barcode-detector` and `zxing-wasm` (barcode decoding in the browser) and `qrcode` (drawing label codes).

**Spec:** `docs/superpowers/specs/2026-11-16-little-library-design.md` (roadmap: `docs/ROADMAP.md`, step 2). Task 1 amends the spec with what step 0 found; read the amended version.

## Global Constraints

- Workers Free plan: 10 ms CPU per request. QR drawing, barcode decoding, and sheet layout happen in the browser.
- Every lending rule lives in `src/worker/ledger/` and nowhere else. No screen and no route decides whether an action is allowed.
- A barcode is accepted only after the same raw value has been read in 3 frames running, where any different value starts the count again. A single frame is never trusted: on a real iPhone one barcode produced four different numbers that all passed the check digit. Three is a judgement from a small sample, not a measured bound; the title confirmation below is what actually stops a wrong book being saved.
- After an ISBN is read, the person is shown the looked-up title and confirms it before anything is saved.
- Book facts (title, authors, cover) are stored only from the server's own lookup or from typed title and author. The client never supplies a cover address.
- A cover address is stored only if it is `https` on `covers.openlibrary.org`.
- Label codes: 10 characters from `23456789abcdefghjkmnpqrstuvwxyz`, drawn with `crypto.getRandomValues` and rejection sampling. Codes are case-insensitive on input and stored lowercase.
- A label link is `<SITE_URL>/b/<code>`. The server builds label links; the client never assembles one from `location`.
- The default label is 1×1 inch (James's decision). The label sheet is chosen from a list of common pre-cut sheets, and the printed code scales to the label.
- Sheet measurements (margins, pitch) are never guessed or recalled: each comes from the manufacturer's own template or a measured sheet, with its source recorded beside it. A sheet whose numbers cannot be sourced is not offered.
- Members see each other's names and pictures, never email addresses. Anything describing another person uses `Person`, not `Member`.
- Someone who is not signed in sees a book's title, authors, and cover only: no people, no history.
- History is append-only. No code path updates or deletes an `events` row.
- A migration must work with the code already deployed: step 2 only adds tables.
- Any `Location` the server emits is checked as a browser would read it: resolved against the site, its origin must be the site's. Validate what is sent, not what was received.
- Every write that depends on a copy's or label's state is conditional on that state inside the same batch, so two people acting at once cannot both succeed.
- State-changing requests are refused unless they come from this site: an `Origin` that is not the site's, or a `Sec-Fetch-Site` of `cross-site` or `same-site`, is 403. (`waffle.haus` hosts other sites, and a sibling subdomain counts as same-site for cookies.)
- Module directories expose their interface from `index.ts`; nothing outside a module imports its other files. No source file contains this app's hostname.
- Times are integer milliseconds since the epoch. Ids are `crypto.randomUUID()`.
- Not in this step: collections and shelves, the StoryGraph import, loans to a named person, giving, ownership requests, releasing, replacing a label, removing a copy, admin screens.

## Review Focus

1. **A second tap.** Claim pressed twice, or by the person already holding the book: the second is refused, the history has one entry, and the page shows the truth. (Tasks 4, 9)
2. **A label typed or scanned in another form.** Capitals, a full link, a link on an old hostname, spaces around it: all resolve to the same label. (Tasks 1, 3)
3. **The lookup service is down, slow, returns rubbish, or simply doesn't know the book.** The answer is "not found" within about 4 seconds, and the person can type the title. Never a 500. In a real test it missed two books of three, so this is a common path. (Tasks 5, 11)
4. **Barcodes that are not ISBNs, and ISBNs in other forms.** A product barcode is refused as "not a book barcode"; a 10-digit or hyphenated ISBN becomes the same 13-digit one. (Tasks 1, 10)
5. **No camera.** Permission refused, no camera, or the decoder fails to load: both the ISBN and the label code can be typed, and the page says why. (Tasks 10, 11)

## File Structure

```
docs/…                                  spec and roadmap amendments (Task 1)
test/reset.ts                           empties every table, for all worker tests
src/shared/types.ts                     + Person, BookInfo, Holder, CopyView, LabelView, Rejection
src/shared/isbn.ts                      toIsbn13
src/shared/labelCode.ts                 alphabet, isLabelCode, parseLabelLink
src/worker/db/schema.ts                 + books, copies, labels, events, book_lookups
src/worker/ledger/index.ts              interface
src/worker/ledger/rules.ts              pure: what a viewer may do, and what an action records
src/worker/ledger/ledger.ts             D1 reads and writes
src/worker/booklookup/index.ts          interface
src/worker/booklookup/booklookup.ts     cache and fallback order
src/worker/booklookup/sources.ts        the Open Library adapter
src/worker/membership/…                 refusals keep the page; outage is told apart from signed out; a test sign-in helper
src/worker/index.ts                     member middleware, same-site check, and the new routes
src/client/route.ts                     pathname to screen
src/client/embedded.ts                  is this an in-app browser
src/client/api.ts                       + label, copy, lookup calls
src/client/App.tsx                      shell: who is signed in, refusal banner, screen
src/client/scanner/                     index.ts, consensus.ts, classify.ts, decoder.ts
src/client/labelsheet/                  layout.ts, sheets.ts, Sheet.tsx
src/client/screens/                     CopyPage, Pair, Labels, NotFound (+ Home links)
```

---

### Task 1: Findings into the docs, shared types, and test reset

**Files:**
- Modify: `docs/superpowers/specs/2026-11-16-little-library-design.md`, `docs/ROADMAP.md`
- Modify: `src/shared/types.ts`
- Create: `src/shared/isbn.ts`, `src/shared/labelCode.ts`, `test/reset.ts`
- Test: `src/shared/isbn.test.ts`, `src/shared/labelCode.test.ts`, `src/worker/reset.test.ts`
- Modify: `src/worker/membership/membership.test.ts`, `src/worker/index.test.ts` (use the shared reset), `vitest.worker.config.ts` (include `src/shared/**/*.test.ts`)

**Interfaces:**
- Produces, in `src/shared/types.ts` (existing `Member` and `RefusalReason` unchanged):

```ts
export type Person = { id: string; name: string; pictureUrl: string | null };
export type BookInfo = { isbn: string | null; title: string; authors: string[]; coverUrl: string | null };
export type Holder = { kind: "member"; person: Person } | { kind: "named"; name: string };
export type ActionType = "claim" | "return";
export type HistoryEntry = { at: number; type: "added" | "labelled" | "claimed" | "returned"; actor: Person };
export type CopyView = {
  copyId: string; code: string | null; book: BookInfo;
  owner: Person | null; holder: Holder; home: boolean;
  history: HistoryEntry[];      // newest first
  actions: ActionType[];        // what this viewer may do right now
};
export type LabelView =
  | { kind: "unknown" }
  | { kind: "blank"; code: string }
  | { kind: "public"; code: string; book: { title: string; authors: string[]; coverUrl: string | null } }
  | { kind: "copy"; copy: CopyView };
export type RejectionReason = "not-found" | "not-allowed" | "label-unknown" | "label-in-use" | "book-not-found" | "invalid";
export type Rejection = { rejected: RejectionReason };
```

- Produces: `toIsbn13(raw: string): string | null` in `src/shared/isbn.ts`.
- Produces, in `src/shared/labelCode.ts`: `LABEL_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"`, `LABEL_LENGTH = 10`, `isLabelCode(s: string): boolean`, `parseLabelLink(raw: string): string | null` (accepts a bare code or any link whose path is `/b/<code>`, on any host, in any case, with surrounding spaces; returns the lowercase code).
- Produces: `resetDatabase(db: D1Database): Promise<void>` in `test/reset.ts`.

- [ ] **Step 1: Amend the spec.** In the design document:
  - Labels section: the default label is 1×1 inch (James's decision), and the sheet is picked from a list of common pre-cut sheets or entered as a custom one, with the code scaled to the label and a nudge for printer alignment. The sheet is printed from a page laid out in inches with the browser's own print, not from a PDF library (call: fewer moving parts, exact sizes).
  - Flows → Pairing: a barcode is accepted only after three matching frames, and the looked-up title is confirmed by the person before saving; say why (the iPhone result).
  - Constraints: in-browser ISBN scanning was tested on an iPhone and works with a bundled decoder at about 55 ms a frame; iOS has no built-in one; a browser can advertise a built-in decoder that never answers, so it is proven on a code the page draws itself before being trusted.
  - Structure: `booklookup` owns its own cache table; the ledger copies book facts when a copy is added. The client uses a small hand-written route matcher, not a routing library (call).
  - Seeing things: someone not signed in sees title, authors, and cover (the design said title and cover; authors are added deliberately).
  - Structure → Book lookup: Open Library only for now. Google Books refuses requests without an API key (tested 2026-11-17); adding it later is one more source plus a key. In the same test Open Library missed two real books of three, so typing the title is a normal path.
  - Constraints: the three-frame rule is a heuristic chosen from a small sample; say so.
  - "Left to the builder": remove label size.
- [ ] **Step 2: Amend the roadmap.** Step 0: mark done, with the three results (scanning works on iOS with a bundled decoder; single frames are unreliable; labels default to 1×1 inch on a sheet chosen from common sizes) and what was dropped (label size sheet, the ISBN match test) and what remains (Google sign-in from in-app browsers, after deploy). Step 3: add that how well StoryGraph ISBNs match real barcodes is unknown, so the import must not depend on it; that shelf and collection views must not include label codes (a code is the proof of having the book in hand, and `CopyView.code` would hand it to anyone browsing a shelf); and that lookups for an import must be batched, because Open Library asks clients not to send hundreds of single-book requests.

- [ ] **Step 3: Write the failing tests.**

```ts
// src/shared/isbn.test.ts
test.each([
  ["9780306406157", "9780306406157"],
  ["978-0-306-40615-7", "9780306406157"],
  [" 9780306406157 ", "9780306406157"],
  ["0306406152", "9780306406157"],          // ISBN-10
  ["0-306-40615-2", "9780306406157"],
  ["080442957X", "9780804429573"],          // ISBN-10 with X
  ["080442957x", "9780804429573"],
  ["9798855427974", "9798855427974"],       // 979 prefix
])("%s is ISBN %s", (raw, want) => expect(toIsbn13(raw)).toBe(want));

test.each([
  "", "abc", "9780306406158",               // bad check digit
  "0794972486008", "6780272426008",         // valid EAN-13, not a book
  "0306406153",                             // bad ISBN-10 check digit
  "97803064061577", "978030640615",         // wrong length
])("%s is not an ISBN", (raw) => expect(toIsbn13(raw)).toBeNull());
```

```ts
// src/shared/labelCode.test.ts
const code = "t7k2q9xzmb";
test.each([
  code, "T7K2Q9XZMB", ` ${code} `,
  `https://books.waffle.haus/b/${code}`, `HTTPS://BOOKS.WAFFLE.HAUS/B/T7K2Q9XZMB`,
  `https://old.example/b/${code}`, `https://books.waffle.haus/b/${code}?x=1#y`, `/b/${code}`,
])("%s is label t7k2q9xzmb", (raw) => expect(parseLabelLink(raw)).toBe(code));

test.each([
  "", "t7k2q9xzm", "t7k2q9xzmbb",           // wrong length
  "t7k2q9xzm0", "t7k2q9xzml", "t7k2q9xzmo", // characters not in the alphabet
  `https://books.waffle.haus/c/${code}`, `https://books.waffle.haus/b/${code}/extra`,
  "9780306406157", "javascript:alert(1)",
])("%s is not a label", (raw) => expect(parseLabelLink(raw)).toBeNull());

test("the alphabet has no lookalikes", () => {
  expect(LABEL_ALPHABET).toHaveLength(31);
  expect(LABEL_ALPHABET).not.toMatch(/[01ilo]/);
});
```

```ts
// src/worker/reset.test.ts
test("reset empties every table, parents and children alike", async () => {
  await env.DB.batch([
    env.DB.prepare("insert into members (id, name, email, created_at) values ('m1', 'N', 'n@example.com', 1)"),
    env.DB.prepare("insert into identities (provider, subject, member_id) values ('google', 'g-1', 'm1')"),
    env.DB.prepare("insert into sessions (token_hash, member_id, expires_at) values ('h', 'm1', 2)"),
  ]);
  await resetDatabase(env.DB);
  const { results } = await env.DB.prepare(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'd1_%' and name not like '_cf_%'",
  ).all<{ name: string }>();
  expect(results.length).toBeGreaterThanOrEqual(3);
  for (const { name } of results) {
    const row = await env.DB.prepare(`select count(*) as n from "${name}"`).first<{ n: number }>();
    expect(row!.n, name).toBe(0);
  }
});

test("reset leaves the migrations table alone", async () => {
  await resetDatabase(env.DB);
  const row = await env.DB.prepare("select count(*) as n from d1_migrations").first<{ n: number }>();
  expect(row!.n).toBeGreaterThan(0);
});
```

Task 2 adds a row to each new table in the first test's setup, so the helper is exercised across every foreign key.

- [ ] **Step 4: Run them.** `pnpm test:worker`. Expected: FAIL, functions not defined.
- [ ] **Step 5: Implement** the two shared files and `resetDatabase`. `resetDatabase` reads the table list from `sqlite_master` (same filter as the test) and each table's parents from `pragma_foreign_key_list`, then deletes children before parents in one batch, so it never needs a hand-kept order. Do not rely on `PRAGMA defer_foreign_keys`: an earlier check found it erroring under local D1. Replace the hand-written cleanup in the existing worker tests with it.
- [ ] **Step 6: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: all pass.
- [ ] **Step 7: Commit.** `feat: shared ISBN and label-code parsing, test reset, step 0 findings in docs`

---

### Task 2: Tables

**Files:**
- Modify: `src/worker/db/schema.ts`
- Create: `drizzle/<generated>/` (one new migration)
- Test: `src/worker/index.test.ts` (extend the stored-shape test)

**Interfaces:**
- Produces these tables. All primary keys NOT NULL, declared at table level as the existing tables do.

| Table | Columns |
|---|---|
| `books` | `id` text pk; `isbn` text with a plain unique index (SQLite allows many NULLs under one); `title` text not null; `authors` text not null (JSON array of strings); `cover_url` text; `created_at` integer not null |
| `copies` | `id` text pk; `book_id` text not null → `books.id`; `owner_id` text → `members.id`; `holder_member_id` text → `members.id`; `created_at` integer not null |
| `labels` | `code` text pk; `minted_by` text not null → `members.id`; `minted_at` integer not null; `copy_id` text → `copies.id`; `bound_at` integer |
| `events` | `id` integer primary key autoincrement; `copy_id` text not null → `copies.id`; `at` integer not null; `actor_id` text not null → `members.id`; `type` text not null |
| `book_lookups` | `isbn` text pk; `title` text not null; `authors` text not null; `cover_url` text; `source` text not null; `fetched_at` integer not null |

Indexes: `copies(owner_id)`, `copies(holder_member_id)`, `labels(copy_id)`, `events(copy_id, id)`.

Two things here cannot be changed later without rebuilding a table, which D1 cannot do once it has rows, so they are decided now: `copies.owner_id` and `copies.holder_member_id` are nullable (step 4 has copies nobody owns, and copies held by a named person who is not a member). Everything else step 4 needs is an added column or table, which D1 handles; do not add unused columns now.

`events.id` is the one primary key not declared at table level: SQLite only allows `AUTOINCREMENT` on a column-level `INTEGER PRIMARY KEY`, and `pragma_table_info` reports its not-null flag as 0. The stored-shape test expects exactly that. History is ordered by `id`.

- [ ] **Step 1: Extend the reset test's setup** with one row in each of the five new tables (respecting their foreign keys), then **extend the stored-shape test** in `src/worker/index.test.ts` with literal expected columns (name, type, not-null, primary-key position), foreign keys, and index names for the five new tables, in the same style as the existing three.
- [ ] **Step 2: Run.** `pnpm test:worker`. Expected: FAIL, tables missing.
- [ ] **Step 3: Add the tables** to `schema.ts` and run `pnpm db:generate`. Confirm exactly one new folder under `drizzle/` and that its SQL only creates tables and indexes (no `ALTER`, no `PRAGMA foreign_keys`).
- [ ] **Step 4: Prove it applies over real data.** In a scratch copy outside the repo: apply the first migration to a fresh local D1, insert a member, an identity, and a session, then apply the new migration with `pnpm wrangler d1 migrations apply DB --local`. It must succeed and the three rows must survive. Record the commands and output in the report.
- [ ] **Step 5: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: all pass (`db:check` included).
- [ ] **Step 6: Commit.** `feat: tables for books, copies, labels, history, and lookup cache`

---

### Task 3: Ledger: labels, adding a copy, viewing

**Files:**
- Create: `src/worker/ledger/index.ts`, `src/worker/ledger/ledger.ts`, `src/worker/ledger/rules.ts`
- Test: `src/worker/ledger/ledger.test.ts`, `src/worker/ledger/rules.test.ts`

**Interfaces:**
- Consumes: tables from Task 2; types and parsers from Task 1; `Member`.
- Produces, from `src/worker/ledger/index.ts`:

```ts
export type AddInput = { code: string; book: { isbn: string } | { title: string; authors: string[] } };
export interface Ledger {
  mintLabels(member: Member, count: number): Promise<{ code: string; url: string }[] | Rejection>;
  add(owner: Member, input: AddInput): Promise<CopyView | Rejection>;
  view(code: string, viewer: Member | null): Promise<LabelView>;
  // act is added in Task 4
}
export function createLedger(deps: {
  db: D1Database;
  siteUrl: string;
  lookup: (isbn: string) => Promise<BookInfo | null>;
  now?: () => number;
  randomBytes?: (n: number) => Uint8Array;
}): Ledger;
```

- Produces, from `rules.ts` (private to the module): `type CopyState = { ownerId: string | null; holderMemberId: string | null }` and `availableActions(state: CopyState, viewer: Member): ActionType[]`.

Behaviour the tests pin:

- `mintLabels`: `count` must be an integer from 1 to 100, else `invalid` (the largest common sheet holds 80). Returns that many distinct new blank labels; `url` is `new URL("/b/" + code, siteUrl).toString()`. A primary-key collision is retried with a fresh code, not surfaced.
- `add`: the label must exist and be unbound, else `label-unknown` or `label-in-use`. The code is parsed with `parseLabelLink`, so capitals and full links work.
  - With `{ isbn }`: normalised with `toIsbn13` (else `invalid`); book facts come from `deps.lookup`; null from the lookup is `book-not-found`. If a `books` row with that ISBN exists it is reused and the lookup is not called.
  - With `{ title, authors }`: title trimmed, 1 to 300 characters; at most 10 authors, each trimmed, 1 to 200 characters; else `invalid`. No ISBN, no cover.
  - One batch writes the book (if new), the copy (owner and holder are the adder), the label binding, and two events, `added` then `labelled`. If the batch fails nothing is written.
  - **Two adds to one label cannot both succeed.** The copy insert, both event inserts, and the label update are each conditional on the label still being blank (`… select … from labels where code = ? and copy_id is null`, and `update labels … where code = ? and copy_id is null`); the ledger reads the label update's `meta.changes`, and if it is 0 nothing was written and the answer is `label-in-use`. (Proven in local D1: without this, two concurrent adds both succeeded and left an orphan copy.)
  - **Two adds of the same new ISBN cannot fail each other.** The book insert is `insert … on conflict(isbn) do nothing`, and the copy refers to the book by `(select id from books where isbn = ?)`, not by an id chosen beforehand.
- `view`: an unparseable or unminted code is `unknown`. A blank label is `blank` for anyone. A bound label is `public` (title, authors, cover only) when `viewer` is null, and `copy` for a member, with `owner` and `holder` as `Person`, `home` true when the holder is the owner, history newest first, and `actions` from `availableActions`.
- `availableActions` in step 2: `["return"]` for the owner when the holder is not the owner; `["claim"]` for a member who is neither owner nor holder, when the copy has an owner; otherwise `[]`.
- No value in a `CopyView` or `LabelView` contains an email address.

- [ ] **Step 1: Write the failing tests.** `rules.test.ts` covers `availableActions` as a table (owner at home, owner while out, holder who is not owner, a third member, a copy with no owner). `ledger.test.ts`, using `resetDatabase` and members inserted directly, with names and assertions:

```ts
test("minting gives distinct blank labels with links on the site", …);       // 100 codes, all isLabelCode, urls start https://books.test/b/
test.each([0, -1, 101, 1.5, NaN])("minting %s labels is invalid", …);
test("a code collision is retried, not surfaced", …);                          // randomBytes stub repeats the first code once
test("adding by ISBN makes a copy owned and held by the adder", …);           // owner = holder = adder, home true, history [labelled, added]
test("adding the same ISBN twice reuses the book and does not look it up again", …); // lookup called once, two copies, one books row
test("adding by title and author stores no ISBN and no cover", …);
test("the label can be given as a link in capitals", …);
test.each([["a label that was never minted", "label-unknown"], ["a label already on a book", "label-in-use"]])("adding to %s is refused", …);
test("an ISBN the lookup cannot find is book-not-found and writes nothing", …); // counts of books, copies, events unchanged; label still blank
test.each(["not-an-isbn", "0794972486008"])("adding ISBN %s is invalid", …);
test.each([["", ["A"]], ["x".repeat(301), ["A"]], ["T", Array(11).fill("A")], ["T", [""]]])("title %j authors %j is invalid", …);
test("if the write fails nothing is half-written", …);                         // db whose batch rejects
test("two adds to one label at once: exactly one succeeds, one is label-in-use, one copy exists", …); // Promise.all; counts: copies 1, events 2, no orphan
test("two adds of the same new ISBN to two labels at once both succeed and share one book", …);
test("someone signed out sees title, authors, and cover only", …);            // exact toEqual of the public shape
test("a member sees owner, holder, history newest first, and their actions", …);
test("a blank label is blank; an unknown or malformed code is unknown", …);
test("no view contains an email address", …);                                  // JSON.stringify(view) does not include "@"
```

- [ ] **Step 2: Run.** `pnpm test:worker`. Expected: FAIL, `createLedger` not defined.
- [ ] **Step 3: Implement.** Label codes: draw bytes, discard any byte ≥ 248 (the largest multiple of 31 below 256), map the rest with `% 31`.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: all pass.
- [ ] **Step 5: Commit.** `feat: ledger mints labels, adds copies, and shows a label's book`

---

### Task 4: Ledger: claim and return

**Files:**
- Modify: `src/worker/ledger/index.ts`, `ledger.ts`, `rules.ts`
- Test: `src/worker/ledger/ledger.test.ts`, `rules.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces, added to `Ledger`:

```ts
act(viewer: Member, action: { type: "claim"; code: string } | { type: "return"; copyId: string }): Promise<CopyView | Rejection>;
```

- Produces, in `rules.ts`: `decide(state: CopyState, viewer: Member, action: ActionType): { holderMemberId: string; event: "claimed" | "returned" } | Rejection`. `availableActions` must be defined in terms of `decide` (an action is available exactly when `decide` does not reject it), so the two cannot disagree.

Behaviour:

- **Claim** needs the label code, which is the proof of having the book in hand. Allowed for a member who is neither the holder nor the owner, when the copy has an owner. The claimer becomes the holder; one `claimed` event with the claimer as actor.
- **Return** is by copy id. Allowed for the owner when someone else holds it. The owner becomes the holder; one `returned` event with the owner as actor.
- Everything else is `not-allowed`; an unknown label or copy is `not-found`.
- The check and the write cannot be separated by another person's action. Both statements of the write are conditional on the whole state the decision was made against, and run in one batch, event first: `insert into events (…) select … from copies where id = ? and owner_id is ? and holder_member_id is ?`, then `update copies set holder_member_id = ? where id = ? and owner_id is ? and holder_member_id is ?`. A claim's two statements are additionally conditional on the label still being bound to this copy. If anything changed in between, neither statement touches a row; the ledger sees that from the update's `meta.changes`, records nothing, and answers `not-allowed`. (Vetted in local D1: a batch is one transaction; a conditional insert with no source row inserts nothing; `meta.changes` is per statement; `is ?` binds null correctly; `undefined` is an error, so always bind `null`.) Step 4 will add actions on this pattern, so the guard is on the full state, not one column.
- The returned `CopyView` is for the acting viewer after the change.

- [ ] **Step 1: Write the failing tests.**

```ts
// rules.test.ts
test.each([
  // [who the viewer is,            copy state,          action,   outcome]
  ["a third member",                 "home",              "claim",  "claimed"],
  ["a third member",                 "out with another",  "claim",  "claimed"],
  ["the holder",                     "out with them",     "claim",  "not-allowed"],
  ["the owner",                      "home",              "claim",  "not-allowed"],
  ["the owner",                      "out",               "claim",  "not-allowed"],
  ["a third member",                 "no owner",          "claim",  "not-allowed"],
  ["the owner",                      "out",               "return", "returned"],
  ["the owner",                      "home",              "return", "not-allowed"],
  ["the holder",                     "out with them",     "return", "not-allowed"],
  ["a third member",                 "out",               "return", "not-allowed"],
])("%s, copy %s, %s → %s", …);

test("an action is available exactly when decide allows it", …); // every viewer × state × action
```

```ts
// ledger.test.ts
test("a friend claims by label and becomes the holder", …);        // holder is the friend, home false, history[0] is claimed by friend, actions []
test("the next friend claims it from the first", …);                // two claimed entries, newest first
test("claiming twice is refused the second time and recorded once", …);
test("two members claim at the same moment: exactly one CopyView, exactly one Rejection, exactly one new event", …); // Promise.all; the holder is the winner
test("one member double-taps claim at the same moment: one success, one refusal, one event", …);
test("a claim and the owner's return at the same moment: the history has no entry that contradicts the holder", …); // whichever ran second saw the first's state
test("a write guard that ignored state would fail these", …);   // not a test to keep: demonstrate once, in the report, that removing the conditions turns the three above red
test("the owner marks it returned", …);                            // holder is owner, home true, history[0] returned by owner
test("only the owner can mark a return", …);
test("returning a book that is home is refused and recorded nowhere", …);
test("claim on an unknown label and return on an unknown copy are not-found", …);
test("history is never rewritten", …);                              // after claim, claim, return: the first two events' rows are byte-identical to before
test("the acting viewer's actions reflect the new state", …);       // after claiming: []; owner viewing then sees ["return"]
```

- [ ] **Step 2: Run.** Expected: FAIL, `act` not defined.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: all pass.
- [ ] **Step 5: Commit.** `feat: ledger claim and return with append-only history`

---

### Task 5: Book lookup

**Files:**
- Create: `src/worker/booklookup/index.ts`, `booklookup.ts`, `sources.ts`
- Test: `src/worker/booklookup/booklookup.test.ts`, `sources.test.ts`, and fixtures under `src/worker/booklookup/fixtures/`

**Interfaces:**
- Consumes: `book_lookups` table; `BookInfo`; `toIsbn13`.
- Produces: `createBookLookup(deps: { db: D1Database; fetch?: typeof fetch; now?: () => number; timeoutMs?: number; sources?: BookSource[] }): { lookup(isbn: string): Promise<BookInfo | null> }`, and `type BookSource = { name: string; find(isbn: string, fetch: typeof globalThis.fetch, signal: AbortSignal): Promise<BookInfo | null> }`.

Behaviour:

- `lookup` normalises with `toIsbn13`; not an ISBN is null without any request.
- A row in `book_lookups` answers without a request. Otherwise each source is tried in order; the first that finds the book wins and is cached. "Not found" is not cached.
- **One source for now: Open Library.** Google Books refuses requests without an API key (HTTP 429 from a keyless request, tested 2026-11-17; Google's docs: "A request that does not provide an OAuth 2.0 token must send an API key"). It is left out; `sources` is a list so adding it later, with a key, is an addition. Tests use a second fake source to exercise the fallback order.
- **`lookup` never throws.** A source that errors, times out, answers non-200, or returns a body of the wrong shape counts as not found and the next is tried. A cache read or write that fails is ignored.
- The time limit is `timeoutMs` (default 4000), built from an `AbortController` and `setTimeout`, not `AbortSignal.timeout`: fake timers do not drive `AbortSignal.timeout` in the Workers test runtime (checked). Tests pass a small real `timeoutMs`.
- A result needs a non-empty title; authors default to `[]`. Titles and author names are trimmed and cut to 300 and 200 characters, at most 10 authors.
- `coverUrl` is kept only if it is `https` on `covers.openlibrary.org`; anything else becomes null.
- Open Library: `GET https://openlibrary.org/api/books?bibkeys=ISBN:<isbn>&format=json&jscmd=data`. A found book is the value under the key `ISBN:<isbn>`, with `title`, `authors[].name`, `cover.medium`. A miss is `200 {}`. (Shapes vetted against live responses on 2026-11-17.)
- Every request to Open Library sends a `User-Agent` naming the app and its public repository, as Open Library asks of API clients: `NataliesLittleLibrary/1 (+https://github.com/JamesAwesome/natalieslittlelibrary)`. No email address.

- [ ] **Step 1: Capture fixtures.** Fetch Open Library once for a real ISBN (`9798855427974`) and for one that does not exist (check it really returns `{}`; `9780000000002` does exist there, so don't use that), save the bodies under `fixtures/`, and check the shape above against them. If it differs, the fixture is the authority: adjust the adapter and say so in the report.
- [ ] **Step 2: Write the failing tests.** `sources.test.ts` parses each fixture and asserts the request's URL and `User-Agent`. `booklookup.test.ts`, with a stub `fetch` and, where a second source is needed, a fake `BookSource`:

```ts
test("found at the first source: the second is not asked, and the answer is cached", …);
test("a second lookup is answered from the cache with no request", …);
test("not at the first source, found at the second", …);
test("found nowhere is null and is not cached", …);
test.each(["a rejected fetch", "a 500", "a body that is not JSON", "JSON of the wrong shape", "a request that never answers"])(
  "the first source giving %s falls through to the second", …);   // the never-answering case uses timeoutMs: 20 and real timers
test("a source that never answers is aborted: its signal fires", …);
test("every source failing is null, never a throw", …);
test("a cache table error does not stop the lookup", …);
test("an ISBN-10 is looked up and cached as its ISBN-13", …);
test("something that is not an ISBN is null with no request", …);
test.each([
  ["https://covers.openlibrary.org/b/id/1-M.jpg", "https://covers.openlibrary.org/b/id/1-M.jpg"],
  ["http://covers.openlibrary.org/b/id/1-M.jpg", null],
  ["https://evil.example/pixel.gif", null], ["https://covers.openlibrary.org.evil.example/x.jpg", null],
  ["javascript:alert(1)", null], ["", null],
])("cover %s is stored as %s", …);
test("a title of 400 characters is cut to 300; a missing title is not found", …);
```

- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: all pass, with no network access during tests.
- [ ] **Step 6: Commit.** `feat: book lookup from Open Library with a cache`

---

### Task 6: Membership: refusals keep the page, and an outage is not "signed out"

This changes vetted sign-in code. It is its own task so it gets its own review and antagonist pass.

**Files:**
- Modify: `src/worker/membership/membership.ts`, `src/worker/membership/index.ts`, `src/worker/membership/testing.ts`
- Test: `src/worker/membership/membership.test.ts`

**Interfaces:**
- Produces, added to `Membership`: `identify(request: Request): Promise<{ status: "member"; member: Member } | { status: "signed-out" } | { status: "unavailable" }>`. `currentMember` stays, defined as `identify` with everything but `member` mapped to null, so its pinned behaviour (null on a database error, never throws) is unchanged.
- Produces, from `membership/testing.ts`: `signInAs(db: D1Database, identity: Identity, config?: Partial<MembershipConfig>): Promise<{ member: Member; cookie: string }>` (runs the real `beginLogin` and `completeLogin` with `fakeProvider`; returns the `Cookie` header value for later requests).

Behaviour:

- **Refusals keep the page.** A refusal redirects to the page the person was signing in from, with `refused=<reason>` in its query: `/b/abc` → `/b/abc?refused=not-invited`; `/b/abc?x=1` → `/b/abc?x=1&refused=not-invited`; an existing `refused` is replaced, not doubled. When the page is not known (no login cookie, bad state) the refusal goes to `/?refused=<reason>` as now.
- **The redirect is validated after it is built, not before.** An antagonist pass proved the obvious implementation opens an off-site redirect: `cleanReturnTo` accepts `/.//evil.example` (harmless as a path today), but `new URL("/.//evil.example", site)` removes the dot segment, and emitting its `pathname` gives `//evil.example?refused=…`, which a browser reads as another site. `/..//x`, `/%2e//x`, and `/.%2e//x` do the same, and `/./auth/login` slips past the `/auth` rule. So:
  1. `cleanReturnTo` itself normalises first: parse `raw` with `new URL(raw, base)` against a fixed dummy base, refuse it if the origin is not the base's, take `pathname + search` (no fragment), and only then apply the existing rules (starts with `/`, not `//`, no backslash, no control characters, not under `/auth`, at most 1000 characters). Anything refused becomes `/`.
  2. One function builds every redirect the module sends to a page (`toPage(returnTo, refused?)`). After building the string it resolves it as a browser would, `new URL(location, siteUrl)`, and if the origin is not `siteUrl`'s origin, or the path starts with `//`, it sends `/` (with the `refused` parameter if there is one) instead.
- **Outage.** `identify` answers `unavailable` when the session lookup throws, `signed-out` for no cookie, a malformed token, an unknown or expired session, or a removed member, and `member` otherwise.

- [ ] **Step 1: Write the failing tests.**

```ts
const dotForms = ["/.//evil.example", "/..//evil.example", "/%2e//evil.example", "/.%2e//evil.example",
  "/%2E%2E//evil.example", "/b/..//evil.example", "/./auth/login", "/b/../auth/login", "/%2e/auth/login"];

test.each([...badReturnTos, ...dotForms])("returnTo %s: the success redirect stays on the site", …);
test.each([...badReturnTos, ...dotForms])("returnTo %s: the refusal redirect stays on the site", …);
// both assert: new URL(location, "https://books.test").origin === "https://books.test",
// the path does not start with "//", and the path is not under /auth

test.each([
  ["/b/abc", "/b/abc?refused=not-invited"],
  ["/b/abc?x=1", "/b/abc?x=1&refused=not-invited"],
  ["/b/abc?refused=failed", "/b/abc?refused=not-invited"],
  ["/b/abc#frag", "/b/abc?refused=not-invited"],
  [null, "/?refused=not-invited"],
])("a refusal after returnTo %s lands on %s", …);
test("a login cookie holding a dot-segment returnTo still cannot send anyone off-site", …); // hand-crafted cookie, as the existing re-clean test does

test("identify: a valid session is a member", …);
test.each(["no cookie", "a malformed token", "an unknown token", "an expired session", "a removed member"])("identify: %s is signed-out", …);
test("identify: a database that throws is unavailable, and currentMember is still null", …);
test("signInAs gives a cookie that identify accepts", …);
```

Demonstrate, in the report, that the tests bite: implement `toPage` the naive way first (emit `pathname + search` with no check after building) and show the dot-form refusal tests go red; then fix it.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Every pre-existing membership test must pass unchanged.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: all pass.
- [ ] **Step 5: Commit.** `feat: refusals keep the page; outage is told apart from signed out`

---

### Task 7: Routes

**Files:**
- Modify: `src/worker/index.ts`
- Test: `src/worker/index.test.ts`, `src/worker/flow.test.ts`

**Interfaces:**
- Consumes: `createLedger`, `createBookLookup`, `Membership.identify`, `signInAs`.
- Produces routes. Every answer is JSON with `Cache-Control: no-store`.

| Route | Who | Answer |
|---|---|---|
| `GET /api/labels/:code` | anyone | 200 `LabelView` |
| `POST /api/labels` body `{ count }` | member | 200 `{ labels: { code, url }[] }` |
| `GET /api/books/lookup?isbn=` | member | 200 `{ book: BookInfo \| null }` |
| `POST /api/copies` body `{ code, isbn }` or `{ code, title, authors }` | member | 200 `CopyView` |
| `POST /api/labels/:code/claim` | member | 200 `CopyView` |
| `POST /api/copies/:id/return` | member | 200 `CopyView` |

- A `Rejection` becomes a status with the rejection as the body: `invalid` 400, `not-allowed` 403, `not-found` / `label-unknown` / `book-not-found` 404, `label-in-use` 409. No signed-in member on a member route: 401 `{ rejected: "signed-out" }`. A body that is not JSON, or not an object, is 400 `invalid`.
- The member is resolved once per `/api/*` request, in middleware, with `identify`, and read from the request context by every route, including `/api/me`. When `identify` says `unavailable`, every `/api/*` route except `/api/health` answers 503 `{ rejected: "unavailable" }`; a database outage is never reported as 401.
- An unexpected error anywhere under `/api/*` is 503 `{ rejected: "unavailable" }`, with no stack or message in the body.
- **Same-site check.** For every request under `/api/*` and `/auth/*` whose method is not GET or HEAD: if an `Origin` header is present and is not the site's origin, or a `Sec-Fetch-Site` header is present and is `cross-site` or `same-site`, answer 403 `{ rejected: "not-allowed" }` before any route runs. A request with neither header (not a browser) passes. This is one small middleware; Hono's `csrf` helper may be used if, and only if, it passes the tests below as written.
- The ledger, lookup, and membership are built once per request by one function.

- [ ] **Step 1: Write the failing tests.**

```ts
// index.test.ts
test.each(["POST /api/labels", "GET /api/books/lookup?isbn=9780306406157", "POST /api/copies",
  "POST /api/labels/t7k2q9xzmb/claim", "POST /api/copies/x/return"])("%s signed out is 401", …);
test("a body that is not JSON is 400", …);
test("when the database is down, a member route is 503, not 401", …);   // a signed-in cookie plus a DB binding that throws
test("when the database is down, /api/me is 503 and /api/health still answers", …);
test("an unexpected error is 503 with no detail", …);
test("every /api answer is no-store", …);
test.each([
  [{ origin: "https://evil.example" }, 403],
  [{ origin: "https://other.waffle.haus" }, 403],          // a sibling site
  [{ "sec-fetch-site": "same-site" }, 403],
  [{ "sec-fetch-site": "cross-site" }, 403],
  [{ origin: "https://books.test", "sec-fetch-site": "same-origin" }, 200],
  [{}, 200],                                                // not a browser
])("a claim with headers %j is %s, and a refused one records nothing", …);
test("the same check covers POST /auth/logout", …);
test("a GET is never refused by the same-site check", …);
```

```ts
// flow.test.ts — the whole loop over HTTP, with two members signed in through signInAs
test("print, pair, claim, return", async () => {
  // Natalie mints 3 labels → 200, 3 codes
  // Natalie adds a book by title to the first → 200, home true
  // signed out, GET the label → kind "public", and the body contains neither "Natalie" nor "@"
  // James GETs the label → kind "copy", actions ["claim"]
  // James claims → holder James; claims again → 403
  // Natalie GETs → actions ["return"]; returns → home true
  // history, newest first: returned (Natalie), claimed (James), labelled, added
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: all pass.
- [ ] **Step 5: Commit.** `feat: label, copy, and lookup routes with a same-site check`

---

### Task 8: Client shell

**Files:**
- Create: `src/client/route.ts`, `src/client/embedded.ts`, `src/client/screens/NotFound.tsx`
- Modify: `src/client/App.tsx`, `src/client/api.ts`, `src/client/screens/Home.tsx`, `src/client/index.css`
- Test: `route.test.ts`, `embedded.test.ts`, `api.test.ts`, `App.test.tsx`, `screens/Home.test.tsx`

**Interfaces:**
- Consumes: the routes from Task 7.
- Produces:
  - `matchRoute(pathname: string): { name: "home" } | { name: "copy"; code: string } | { name: "pair" } | { name: "labels" } | { name: "not-found" }`. `/b/<anything>` is `copy` with the raw segment (the server decides whether it is a label); a trailing slash is ignored.
  - `embeddedBrowser(userAgent: string): string | null`: a short name ("Instagram", "Facebook", "an in-app browser") or null.
  - In `api.ts`: `class ApiError extends Error { status: number; rejected: string | null }`, and `getLabel(code)`, `mintLabels(count)`, `lookupBook(isbn)`, `addCopy(input)`, `claim(code)`, `returnCopy(copyId)`, each returning the route's body or throwing `ApiError`.
  - `App` renders a screen for the route and passes it `{ member, returnTo }`. Screens for `copy`, `pair`, and `labels` are added by later tasks; until then `App` renders `NotFound` for them.

Behaviour:

- The refusal message is shown above whatever screen the route gives, since a refusal can now land on any page. The copy stays as in step 1.
- When `/api/me` answers 503, the person is not told to sign in: the shell shows `The library is having trouble right now. Please try again later.` with a `Try again` button, and no sign-in link.
- When the page is restored from the back-forward cache (`pageshow` with `persisted`), it reloads, so nobody sees a stale name or a stale book state.
- `Home`, signed in, gains two links: `Pair a book` → `/pair`, `Print labels` → `/labels`.
- `embeddedBrowser` recognises: `Instagram`, `FBAN`/`FBAV`/`FB_IAB` (Facebook), `Messenger`, `MicroMessenger` (WeChat), `Line/`, `Snapchat`, `TikTok`, `LinkedInApp`, `Twitter`; Android's `; wv)`; and an iPhone or iPad user agent with `AppleWebKit` but no `Safari/` token. Safari, Chrome on iOS (`CriOS`), and Firefox on iOS (`FxiOS`) are not embedded.

- [ ] **Step 1: Write the failing tests.** Tables for `matchRoute` (`/`, `/b/abc`, `/b/abc/`, `/b/`, `/pair`, `/labels`, `/nope`, `//b/abc`) and `embeddedBrowser` (real user agent strings: iPhone Safari, iPhone Chrome `Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/157.0.8103.37 Mobile/15E148 Safari/604.1`, Instagram on iOS, Facebook on Android, an Android WebView, desktop Chrome). `api.test.ts`: each new function's URL, method, and JSON body; a 403 with `{ rejected: "not-allowed" }` throws `ApiError` with both fields; a non-JSON error body still throws `ApiError` with `rejected: null`. `App.test.tsx`: a refusal shows on `/b/abc`; a 503 from `getMe` shows the trouble message and no sign-in link, while a network error still shows the signed-out page; `pageshow` with `persisted: true` reloads and with `false` does not; unknown path renders the not-found screen.
- [ ] **Step 2: Run.** `pnpm test:client`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Expected: all pass.
- [ ] **Step 5: Commit.** `feat: client routes, API calls, and in-app browser detection`

---

### Task 9: The book's page

**Files:**
- Create: `src/client/screens/CopyPage.tsx`
- Modify: `src/client/App.tsx` (route `copy`), `src/client/index.css`
- Test: `src/client/screens/CopyPage.test.tsx`

**Interfaces:**
- Consumes: `getLabel`, `claim`, `returnCopy`, `ApiError`, `embeddedBrowser`, `LabelView`, `Member`.
- Produces: `<CopyPage code member returnTo />`.

What the person sees, by state:

| State | Shown |
|---|---|
| loading | the heading only |
| `unknown` | `This label isn't one of ours.` |
| `blank`, signed in | `This label isn't on a book yet.` and a link `Pair it with a book` → `/pair?label=<code>` |
| `blank`, signed out | `This label isn't on a book yet.` and the sign-in link |
| `public` | cover, title, authors, then `Sign in to see who has this book or to take it.` and the sign-in link back to this page |
| `public`, in an embedded browser | as above, but in place of the sign-in link: `Google won't let you sign in inside <name>. Open this page in Safari or Chrome.` and a `Copy link` button |
| `copy` | cover, title, authors; `Owned by <name>`; `With <name>` or `At home with <name>`; one button per entry in `actions`; the history |
| request failed | `The library is having trouble right now. Please try again later.` and a `Try again` button |

- Buttons: `claim` → `I have this book`; `return` → `Mark as returned`. No button appears that is not in `actions`.
- After an action the page shows the `CopyView` the server returned. If the server refuses (`not-allowed`), the page refetches and shows the current state with `That's already changed. Here's where the book is now.` A button is disabled while its request is in flight, so a double tap sends one request.
- History lines, newest first, with a date: `added` → `<actor> added this book`; `labelled` → `<actor> put a label on it`; `claimed` → `<actor> took it`; `returned` → `<actor> marked it returned`.
- A missing cover shows a plain placeholder block, not a broken image. Cover images have empty `alt` (the title is beside them).

- [ ] **Step 1: Write the failing tests**, one per row of the table with `api` mocked, plus: the button for each action calls the right function once and the page then shows the returned state; a double click sends one request; a refusal refetches and shows the changed-state message; a member's page never renders an action that is not in `actions` (render with `actions: []` and assert no buttons); the embedded-browser row offers no link to `/auth/login`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify the real render.** `pnpm dev`, and with headless Chrome at phone width screenshot the `unknown` state (`/b/zzzzzzzzzz`) into the scratchpad directory, look at it, and fix what is visibly wrong. Stop the dev server.
- [ ] **Step 5: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [ ] **Step 6: Commit.** `feat: the book's page with claim, return, and history`

---

### Task 10: Scanner

**Files:**
- Create: `src/client/scanner/index.ts`, `Scanner.tsx`, `consensus.ts`, `classify.ts`, `decoder.ts`
- Test: `consensus.test.ts`, `classify.test.ts`, `decoder.test.ts`, `Scanner.test.tsx`
- Modify: `package.json` (add `barcode-detector`, `zxing-wasm`, `qrcode`, `@types/qrcode`)

**Interfaces:**
- Consumes: `toIsbn13`, `parseLabelLink`.
- Produces, from `src/client/scanner/index.ts`:

```ts
export type Reading = { kind: "isbn"; isbn: string } | { kind: "label"; code: string };
export type ScannerProblem = "no-camera" | "denied" | "decoder-failed";
export function Scanner(props: {
  want: "isbn" | "label";
  onRead: (reading: Reading) => void;
  onProblem: (problem: ScannerProblem) => void;
}): JSX.Element;
```

- Private to the module:
  - `consensus.ts`: `createConsensus(need = 3, expireMs = 1500): { feed(values: string[], now: number): string | null }`. It is fed every raw value the decoder reads, of any kind. It returns a value the moment it has been seen in `need` frames running; **any** different value, or `expireMs` without seeing it, starts the count over; the same value is not returned again until it has been absent for `expireMs`.
  - `classify.ts`: `classify(raw: string, format: string): Reading | { kind: "not-a-book-barcode" } | null`. An `ean_13` that `toIsbn13` accepts is an ISBN; any other `ean_13` or `upc_a` is `not-a-book-barcode`; a `qr_code` that `parseLabelLink` accepts is a label; anything else is null.
  - `decoder.ts`: `type Decoder = { detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]> }`, `bundledDecoder(): Decoder`, `nativeDecoder(): Promise<Decoder | null>`, `chooseDecoder(): Promise<Decoder>`.

Behaviour:

- The bundled decoder is `barcode-detector/ponyfill` with formats `ean_13`, `upc_a`, `qr_code`, and its WebAssembly file served from this app's own assets (`import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url"` and `prepareZXingModule({ overrides: { locateFile } })`), never a CDN.
- `nativeDecoder` returns the browser's `BarcodeDetector` only if it lists `ean_13` and `qr_code` **and** reads a QR code the module draws on a canvas within 3 seconds. Otherwise null. `chooseDecoder` prefers a proven native one and falls back to the bundled one.
- The component asks for the rear camera (`facingMode: { ideal: "environment" }`), shows the video (`playsInline`, `muted`), and tries a frame about every 120 ms. Every decode call has a 5-second limit; a frame that errors or times out is skipped.
- **Consensus first, then classify.** Every raw value from every frame goes through the consensus; only a value the consensus accepts is classified. This is the rule the phone test validated. Classifying first is weaker: misreads that are not ISBNs would stop resetting the count, and a wrong ISBN seen in frames 1, 3, and 5 would be accepted. `onRead` fires once per accepted value of the wanted kind. While `want` is `isbn`, an accepted value that is `not-a-book-barcode` shows `That barcode isn't a book's ISBN. Look for the one starting 978 or 979.`; a single-frame misread never shows it.
- Problems: no `getUserMedia` → `no-camera`; permission refused → `denied`; the decoder cannot be created → `decoder-failed`. `onProblem` fires once and the component shows nothing further; the screen that uses it offers typing.
- The camera is stopped when the component unmounts and when the page is hidden.

- [ ] **Step 1: Write the failing tests.**

```ts
// consensus.test.ts
test("a value seen in three frames running is accepted on the third", …);
test("two frames, then a different value, then the first again: not accepted", …);
test("a wrong value in frames 1, 3, and 5 with other values between is never accepted", …); // W, X, W, Y, W
test("the recorded misread sequence accepts only the true value", () => {
  const frames = ["9780952486008", "0794972486008", "6780272426008", "9780952486008", "0794972486008",
    "9780952486008", "9780051486008", "9780952486008", "9780952486008", "9780952486008"];
  // fed 175 ms apart: exactly one acceptance, of 9780952486008, and only at the tenth frame
});
test("empty frames between sightings do not reset the count, until 1.5 s pass", …);
test("an accepted value is not accepted again while it stays in view", …);
test("after it has been gone 1.5 s the same value can be accepted again", …);
```

`classify.test.ts`: a table (ISBN-13, the non-book EAN `0794972486008`, a UPC-A, a label link in capitals, a QR code holding some other link, an unknown format). `decoder.test.ts`: `nativeDecoder` is null when the browser has none, when its formats lack `ean_13`, when it never answers (fake timers, 3 s), and when it reads nothing from the test code; it is returned when it reads the test code. `Scanner.test.tsx`, with `getUserMedia` and the decoder module mocked: no camera API → `no-camera`; a rejected permission → `denied`; a decoder that yields the same ISBN for three frames → one `onRead`; a non-book barcode read in three frames running while wanting an ISBN shows the message and does not call `onRead`, and the same barcode in a single frame shows nothing; non-book misreads between two readings of an ISBN reset the count; unmounting stops every track.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Prove the bundled decoder in a real browser engine.** jsdom cannot run WebAssembly decoding of a canvas. Add a dev-only page `src/client/scanner/check.html` (not linked, excluded from the production build) that draws a QR code and an EAN-13 on canvases and decodes them with `bundledDecoder()`; run it in headless Chrome with every outside host blocked (`--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"`) and record that both read correctly. If keeping the page out of the production build is not straightforward, do the check from a scratch copy instead and say so.
- [ ] **Step 5: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Confirm the build output contains the `.wasm` file and no reference to a CDN (`grep -r jsdelivr dist` finds nothing).
- [ ] **Step 6: Commit.** `feat: scanner that needs three matching frames`

---

### Task 11: Pairing

**Files:**
- Create: `src/client/screens/Pair.tsx`
- Modify: `src/client/App.tsx` (route `pair`), `src/client/index.css`
- Test: `src/client/screens/Pair.test.tsx`

**Interfaces:**
- Consumes: `Scanner`, `lookupBook`, `addCopy`, `ApiError`, `toIsbn13`, `parseLabelLink`.
- Produces: `<Pair member returnTo />`. Signed out, it shows the sign-in link back to `/pair` and nothing else.

The flow, one step on screen at a time:

1. **The book.** `Scan the barcode on the back of the book.` with the scanner wanting an ISBN, and a link `No barcode? Type it in`.
2. **Is this it?** After a reading, the lookup runs and shows cover, title, authors, and `Is this the book?` with `Yes` and `No, scan again`. If the lookup finds nothing: `We couldn't find that book.` with `Type the title` first and `Scan again` second (a miss is common, so typing is the main way forward, with the ISBN kept).
3. **Typing.** Fields `Title` and `Author` (one author; more can come later), and `ISBN (optional)`; a typed ISBN that `toIsbn13` accepts goes back to step 2, anything else in that field is an error beside the field.
4. **The label.** `Now scan a blank label.` with the scanner wanting a label, and a field `Or type the code printed under it`. If the page was opened as `/pair?label=<code>` and the code parses, this step is skipped.
5. **Saving.** `addCopy` is called; on success the browser goes to `/b/<code>`.

- Refusals from `addCopy`: `label-in-use` → `That label is already on a book. Use a blank one.` and back to step 4; `label-unknown` → `That isn't one of our labels.` and back to step 4; `book-not-found` → step 3 with the ISBN kept; anything else → `Something went wrong saving that. Try again.` with the same data kept.
- A scanner problem replaces the scanner with the typing path for that step and one line saying why: `no-camera` → `This device has no camera we can use.`; `denied` → `Camera access was refused. You can allow it in your browser's settings, or type instead.`; `decoder-failed` → `The scanner couldn't start. Type instead.`
- `Start over` is available from step 2 onward.
- Nothing is saved until step 5, and the book is saved by ISBN whenever one was confirmed (the server supplies the title, authors, and cover).

- [ ] **Step 1: Write the failing tests**, with `Scanner` replaced by a stub that exposes buttons to fire `onRead` and `onProblem`, and `api` mocked: the happy path calls `addCopy({ code, isbn })` once and navigates to `/b/<code>`; `No, scan again` returns to step 1 and saves nothing; a lookup miss offers typing; typed title and author call `addCopy({ code, title, authors: [author] })`; `/pair?label=T7K2Q9XZMB` skips step 4 and saves with the lowercase code; each refusal shows its message and returns to the right step with data kept; each scanner problem shows its line and the typing field; a double tap on the final step sends one request; signed out shows only the sign-in link.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [ ] **Step 5: Commit.** `feat: pair a book with a label`

---

### Task 12: Printing labels on common sheets

**Files:**
- Create: `src/client/labelsheet/layout.ts`, `src/client/labelsheet/sheets.ts`, `src/client/labelsheet/Sheet.tsx`, `src/client/screens/Labels.tsx`
- Modify: `src/client/App.tsx` (route `labels`), `src/client/index.css`
- Test: `labelsheet/layout.test.ts`, `labelsheet/sheets.test.ts`, `labelsheet/Sheet.test.tsx`, `screens/Labels.test.tsx`

**Interfaces:**
- Consumes: `mintLabels`, `qrcode`.
- Produces, in `layout.ts`:

```ts
export type SheetLayout = {
  id: string;                      // "avery-94103"
  name: string;                    // shown in the picker: "Avery 94103 · 1 × 1 in square · 48 per sheet"
  source: string;                  // where the measurements came from
  page: { widthIn: number; heightIn: number };
  shape: "rectangle" | "round";
  label: { widthIn: number; heightIn: number };
  columns: number; rows: number;
  marginTopIn: number; marginLeftIn: number;
  pitchXIn: number; pitchYIn: number;     // label size plus the gap to the next one
};
export function perSheet(layout: SheetLayout): number;
export function positions(layout: SheetLayout): { leftIn: number; topIn: number }[];
// The printed code for a label of this shape and size, or null if the label is too small to carry one.
export function codeBox(layout: SheetLayout): { qrIn: number; showText: boolean } | null;
export function validate(layout: SheetLayout): string[];   // human-readable problems; empty means usable
```

- Produces, in `sheets.ts`: `SHEETS: SheetLayout[]` and `DEFAULT_SHEET_ID = "avery-94103"`.
- Produces: `<Sheet labels layout nudge />` where `nudge` is `{ xMm: number; yMm: number }`, and `<Labels member returnTo />`.

**The sheets.** Offer these, if and only if their measurements can be sourced. Sizes and counts below are from Avery's own template pages; margins and pitch are not published there and must come from Avery's downloadable template file for that product (the table dimensions in its Word or PDF template) or from measuring a real sheet. Record the source in `source`. Leave out any sheet you cannot source and list it in your report.

| Sheet | Label | Per sheet |
|---|---|---|
| Avery 94103 (default) | 1 × 1 in square | 48 |
| Avery 22805 | 1½ × 1½ in square | 24 |
| Avery 22806 | 2 × 2 in square | 12 |
| Avery 5160 | 1 × 2⅝ in rectangle | 30 |
| Avery 6450 | 1 in round | 63 |
| Avery 22807 | 2 in round | 12 |
| Plain sticker paper, cut by hand | 1 × 1 in square, 7 × 9 grid, 1.125 in pitch, centred, with faint cut marks | 63 |

Avery 5167 (½ × 1¾ in) is deliberately not offered: at half an inch the code is too small to rely on.

Besides the list, a **Custom sheet** choice reveals fields for every number in `SheetLayout`, in inches, so any other pre-cut sheet can be used by reading its packaging. `validate` runs on it and its messages are shown beside the form.

Behaviour:

- `codeBox`: the code is a square QR. On a rectangle it is `0.72 × min(width, height)`; on a round label it is `0.62 × diameter` (it must sit inside the circle with a clear margin). The code text is printed under the QR when the label is at least 0.9 in on its short side. If the QR would be smaller than 0.6 in, `codeBox` is null and the sheet cannot be used; `validate` says `Labels this small can't carry a code that scans reliably.`
- `validate` also refuses a layout whose labels run off the page or overlap, a pitch smaller than the label, non-positive numbers, and more than 100 labels per sheet.
- Each label holds only the QR (error correction M, drawn as SVG with crisp edges, the label link exactly as the server returned it), centred, and the code text where `codeBox` says so, monospace at 6 pt. Nothing is drawn at the label's edges except on the plain-paper sheet, which has cut marks.
- The sheet is laid out in inches with CSS, `@page { size: 8.5in 11in; margin: 0 }`, each sheet on its own page. On screen it is a preview with the label outlines drawn faintly; when printing, the outlines and everything except the sheets are hidden.
- **Alignment.** Printers shift. The screen has `Nudge right/left` and `Nudge down/up` in millimetres (steps of 0.5, from -5 to 5), applied to the whole sheet, and a `Print an alignment test` button that prints only the label outlines on plain paper, to hold against a real sheet before using one. The chosen sheet and nudge are remembered in `localStorage` (wrapped in try/catch; the page works without it).
- The screen, in order: the sheet picker; `How many sheets?` (1 to 3); `Make labels`, which mints `perSheet` labels per sheet, one request per sheet; then `Print`, which calls `window.print()`. Above the preview: `Print from a computer, at 100%, not "fit to page", on Letter paper.` Printing is supported from a desktop browser; a phone's print dialog may force its own margins, and this has not been tested there.
- Labels exist once made, whether or not they are printed, and the screen says so: `These labels now exist. If you don't print them, they simply go unused.` Changing the sheet type after making labels re-lays-out the same labels; it never mints more. A second press while a request is in flight does nothing.
- Signed out, it shows the sign-in link back to `/labels`.

- [ ] **Step 1: Source the measurements.** For each sheet in the table, get margins and pitch from the manufacturer's template or a measured sheet and write them into `sheets.ts` with the source. Report which were sourced, from where, and which were left out.
- [ ] **Step 2: Write the failing tests.**

```ts
// layout.test.ts
test.each(SHEETS)("$name fits its page, without overlap", (sheet) => {
  expect(validate(sheet)).toEqual([]);
  // every label box is inside the page; no two boxes intersect; positions().length === perSheet()
});
test("the default sheet is a 1-inch square, 48 to a sheet", …);
test.each([
  [{ shape: "rectangle", w: 1, h: 1 }, { qrIn: 0.72, showText: true }],
  [{ shape: "rectangle", w: 2.625, h: 1 }, { qrIn: 0.72, showText: true }],
  [{ shape: "rectangle", w: 1.5, h: 1.5 }, { qrIn: 1.08, showText: true }],
  [{ shape: "round", w: 1, h: 1 }, { qrIn: 0.62, showText: true }],
  [{ shape: "round", w: 2, h: 2 }, { qrIn: 1.24, showText: true }],
  [{ shape: "rectangle", w: 1.75, h: 0.5 }, null],
  [{ shape: "rectangle", w: 0.85, h: 0.85 }, { qrIn: 0.612, showText: false }],
])("a %j label carries %j", …);
test.each([
  ["labels running off the right edge", "off the page"],
  ["a pitch smaller than the label", "overlap"],
  ["zero columns", "at least one"],
  ["101 labels on a sheet", "100"],
  ["a half-inch label", "too small"],
])("a custom sheet with %s is refused", …);
test("on a round label the code's corners stay inside the circle", …); // qrIn * Math.SQRT2 < diameter, for every round sheet
```

`sheets.test.ts`: every sheet has a non-empty `source`; ids are unique; `DEFAULT_SHEET_ID` exists. `Sheet.test.tsx`: `perSheet + 1` labels make two pages; each label's SVG has the width `codeBox` gives; the text is present only where `showText`; a nudge of 1 mm right moves every label by 1 mm; the QR is built from the given `url`. `Labels.test.tsx`: the default sheet is preselected; choosing 2 sheets of the default mints 48 twice; changing the sheet type afterwards mints nothing and re-lays-out the same codes; a double press mints once; `Print` calls `window.print`; the alignment test prints outlines and no codes; an invalid custom sheet disables `Make labels` and shows why; a failed mint shows `Couldn't make labels. Try again.`; the chosen sheet and nudge survive a remount, and the page still works when `localStorage` throws.

- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Verify the real print.** Add a dev-only preview at `src/client/labelsheet/preview.html` (not linked, not in the production build) that renders `Sheet` for each entry in `SHEETS` with made-up labels. Print it to PDF with headless Chrome (`--print-to-pdf`, `--no-pdf-header-footer`) into the scratchpad, open the PDF, and check for every sheet: the page is Letter; the label count matches; nothing touches the page edge; the first label's left and top match the layout's margins against the 8.5-inch page width. Record what you saw. What this cannot show is whether a real printer lands on a real sheet; that is what the alignment test is for, and it is James's check.
- [ ] **Step 6: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [ ] **Step 7: Commit.** `feat: print labels on common sheets, with alignment`

---

### Task 13: Close out

**Files:**
- Modify: `README.md`, `docs/ROADMAP.md`, `.claude/agents/antagonist-techniques.md`

- [ ] **Step 1: README.** Add how the loop works for a person (print, pair, scan, claim, return), the new commands if any, and two "Things to know" items: book titles and covers come from Open Library, which does not know every book, so typing a title is normal and pairing works even when it is down; and labels are printed from a computer at 100% scale, with the alignment test first.
- [ ] **Step 2: Roadmap.** Mark what step 2 delivered and move anything deferred during the build into "Carry-overs" under the step that should take it.
- [ ] **Step 3: Techniques.** Land the antagonist's accepted technique proposals from this step in `.claude/agents/antagonist-techniques.md`, keeping the file under 100 lines. The first is from the pass on this plan: *"The cleaned value is safe after we rebuild it with URL." Believed because the cleaner's table passed. Settled by feeding inputs that the transformation normalises (dot segments, `%2e`) and resolving the output the way a browser would. Validate what the code emits, not what it was given.* Also add to the standing facts: Google Books refuses keyless requests; fake timers do not drive `AbortSignal.timeout` in the Workers test runtime; two concurrent D1 batches that each checked state beforehand both succeed unless every statement is conditional on that state.
- [ ] **Step 4: Run everything CI runs**, in order, from a clean install: `pnpm install --frozen-lockfile`, `pnpm wrangler types --check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- [ ] **Step 5: Commit.** `docs: step 2 in the README and roadmap`

The roadmap's "done when" for this step (Natalie labels five books, James claims one by scanning it with his camera, Natalie sees that he has it) needs the app deployed and two phones. It is James's check, after a release tag.

## Departures from this plan (2026-11-25)

Recorded after the build; the task text above is left as written.

- **Task 10, native decoder.** `nativeDecoder` and `chooseDecoder` were not
  built. The scanner uses the bundled decoder only, proven on a QR it draws
  itself before use (15 s limit), and 10 consecutive detect failures count as
  `decoder-failed`.
- **Task 10, Step 5.** `grep -r jsdelivr dist` cannot pass: zxing-wasm's
  default CDN address is a string in its bundle even though the app overrides
  it. The check was replaced by a browser run with the CDN host blocked,
  showing only same-origin requests.
- **Task 5, User-Agent.** Open Library asks for contact details. The app sends
  its name and public repository address but no contact details (privacy), so
  lookups are in the 1 req/s tier.
- **Task 12, `codeBox`.** For round labels: QR centred; no code text under
  1.5 in; at least 2 modules from QR to text; at least 1.5 mm from QR corners
  to the cut. QR placement is computed in `layout.ts`, and the print check
  decodes every label under a dark surround and a shift of 1 mm.
- **Task 11, typing.** A filled title saves by title with no lookup; the ISBN
  stays visible but is not sent with that save.
