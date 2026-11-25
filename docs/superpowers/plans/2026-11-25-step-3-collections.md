# Step 3: Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task also gets an antagonist pass (`.claude/agents/antagonist.md`) alongside its ordinary review.

**Goal:** Every owned copy lives in one of its owner's named collections; a member can see their books grouped by collection with who holds each, what they are holding, and other members' shelves; Natalie can import her StoryGraph export as unlabelled copies and then label them by scanning, without typing.

**Architecture:** A `collections` table and two added nullable columns on `copies` (`collection_id`, `import_isbn`), written only by the ledger, which keeps the collections invariant inside every guarded write. Shelves, holding and copies reached by id get their own serializers that never touch a label code. The StoryGraph file is parsed in the browser into title, authors and ISBN only, and sent in small chunks; the import's book lookups go through `booklookup` in one multi-ISBN request per chunk.

**Tech Stack:** as step 2 (pnpm, React 19, Vite, Cloudflare Worker, Hono, D1, Drizzle, Vitest with `@cloudflare/vitest-plugin`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-collections-design.md` (binding for collections), with the main spec `docs/superpowers/specs/2026-11-16-little-library-design.md` (StoryGraph import, Seeing things, Structure) and `docs/ROADMAP.md` step 3. Executors read all three.

## Global Constraints

- Workers Free plan: 10 ms CPU per request; 50 outbound requests per invocation; a D1 batch is one transaction and counts as one query against the 50 per invocation; at most 100 bound parameters in one D1 statement. CSV parsing happens in the browser.
- Request bodies stay capped at 16 KB (`objectBody`). An import is sent as chunks of at most 20 rows and at most 12,000 bytes of JSON each, one chunk at a time, at least 1 s apart. The server refuses a chunk of more than 20 rows as `invalid`.
- Open Library is asked at most once per import chunk, with every uncached ISBN in that chunk in one `bibkeys` request. A source without a multi-ISBN request (Google Books, once PR #5 merges) is never asked during an import.
- D1 forbids `PRAGMA foreign_keys=OFF`, so a migration may only add tables, indexes, and nullable or defaulted columns. Any generated SQL containing `PRAGMA foreign_keys` or a `__new_` table is replaced by hand before commit.
- Every lending and ownership rule lives in `src/worker/ledger/rules.ts` (`decide`). The ledger is the only writer of `copies` and `collections`.
- The collections invariant, after every ledger write: `copies.owner_id` is null exactly when `copies.collection_id` is null; a non-null `collection_id` names a collection whose `owner_id` is the copy's `owner_id`; every member who owns a copy has exactly one default collection.
- Every write is conditional, inside the same statement, on the state its decision was made against; destination collections are checked inside the write (`exists (select 1 from collections where id = ? and owner_id = ?)`). Results are read from `meta.changes`; a write that changed nothing becomes a `Rejection`. Never bind `undefined`; bind `null`.
- Every write this step adds or changes also requires the actor to be active, inside the statement: `exists (select 1 from members where id = ? and removed_at is null)`. (`act`'s claim and return are left as they are; that is a step 5 carry-over.)
- A `CopyView` carries a label code only when the request carried it (`GET /api/labels/:code`, claim). Collections, shelves, holding, candidates, imports, and copies reached by id never include a label code. Tests assert the minted code strings are absent from the JSON, not only the `code` key.
- Someone signed out sees title, authors, and cover only. The public label view gains no collection name and nothing else.
- Members see each other's names, never email addresses. Anything describing another person is `Person`.
- Book facts on a row with an ISBN come only from the server's lookup. Title and authors from a person (typed, or from their StoryGraph file) are stored only on a book row with no ISBN. An imported ISBN the lookup cannot find is kept on the copy as `import_isbn`, never on `books`.
- Natalie's StoryGraph data never leaves her browser except title, authors, and ISBN. `storygraph_export.csv` is never committed, served, uploaded, or opened by an agent. `*.csv` is gitignored, so the test fixture is a synthetic string in a `.ts` file; do not add a `.gitignore` negation.
- Collection names: trimmed, NFC-normalised, 1 to 60 code points counted on the server; control characters and bidi controls (U+202A–U+202E, U+2066–U+2069) refused; `name_key` is the name lower-cased with JavaScript's `toLowerCase`. Names are always rendered inside `<bdi>`. The default collection's name is `Home library`.
- History is append-only. Moving a copy between one's own collections records no event.
- State-changing requests (now including `PATCH` and `DELETE`) pass the existing same-site check.
- `localStorage` reads and writes are wrapped in try/catch, and every page works without it.
- Module directories expose their interface from `index.ts`. Times are integer milliseconds. Ids are `crypto.randomUUID()` (the migration's backfilled ids are 32 lowercase hex characters).
- Not in this step: shared collections, roles, stewards, collection settings, whole-collection transfer or merge, ordering within a collection, release, adopt, give, requests, removing a copy (the eight formatless imported rows are removed in step 4), loans to a named person.

## Review Focus

1. **Two first adds at once.** A member with no collections pairs on two phones at the same moment, or adds while creating their first collection: exactly one default exists, both copies land in it, and the invariant holds. (Tasks 2, 3)
2. **A real StoryGraph file.** A BOM, CRLF line ends, a title with a quoted comma, doubled quotes, and a multi-line review: the right rows come out with the right fields, and no review, rating, or date text is in anything sent. (Task 11)
3. **An import interrupted, re-run, or double-tapped.** Chunks are independent and each row is guarded against a duplicate inside the write, so running the same file again adds only what is missing, and two identical chunks at once add each book once. (Tasks 6, 11)
4. **A stale remembered collection.** The `localStorage` collection was deleted, or belongs to another account that used this browser: the picker falls back to the default with a notice, and a save to it is refused `not-found`, never written to someone else's collection. (Tasks 3, 10)
5. **Scanning an imported book Open Library doesn't know, or a different edition.** The scan finds the imported copy through `import_isbn`, or offers "Is it this one?" by title, so she labels it without typing; with no match, pairing makes a new copy as before. (Tasks 6, 10)

## File Structure

```
src/worker/db/schema.ts              + collections; copies.collection_id, copies.import_isbn
drizzle/<generated>/migration.sql    + hand-written backfill
wrangler.test.jsonc                  + MIGRATION_DB, a second local D1 for the seeded-migration test
src/shared/types.ts                  + CollectionRef, CollectionSummary, ShelfItem, Shelf, Candidates, ImportRow, ImportResult
src/shared/collectionName.ts         cleanCollectionName
src/shared/isbn.ts                   toIsbn13 fixes (Task 11)
src/worker/ledger/rules.ts           decide: move, label; labelInHand
src/worker/ledger/collections.ts     collection writes and the SQL fragments for defaults and guards
src/worker/ledger/shelves.ts         collectionsOf, shelf, holding, the ShelfItem serializer
src/worker/ledger/unlabelled.ts      importCopies, labelCopy, candidates, titleKey
src/worker/ledger/ledger.ts          composes the above; add, act, view, viewCopy, moveCopy
test/invariant.ts                    invariantViolations(db)
src/worker/booklookup/               lookupMany; Open Library findMany
src/worker/membership/               members()
src/worker/index.ts                  new routes
src/client/api.ts, route.ts, App.tsx new calls and routes
src/client/screens/                  CopyPage (by id), Mine, Shelf, Holding, Members, Pair, Import
src/client/storygraph/               csv.ts, parse.ts, fixture.ts, index.ts
```

---

### Task 1: Schema, migration, and shared types

**Files:**
- Modify: `src/worker/db/schema.ts`, `src/shared/types.ts`, `wrangler.test.jsonc`, `test/env.d.ts`
- Create: `drizzle/<generated>/` (one migration), `src/worker/db/migration.test.ts`
- Test: `src/worker/index.test.ts` (stored shape), `src/worker/reset.test.ts` (seed a collection), `src/worker/db/migration.test.ts`

**Interfaces:**
- Produces the table `collections`: `id` text pk; `owner_id` text not null → `members.id`; `name` text not null; `name_key` text not null; `is_default` integer not null default 0; `created_at` integer not null. Primary key at table level, as the other tables.
- Indexes: `collections_owner_name_key_unique` unique on `(owner_id, name_key)`; `collections_one_default` unique on `(owner_id)` where `is_default = 1` (Drizzle `uniqueIndex(...).on(t.ownerId).where(sql\`${t.isDefault} = 1\`)`).
- `copies` gains `collection_id` text, nullable, → `collections.id`, with index `copies_collection_id_idx`; and `import_isbn` text, nullable, no index (the ISBN a member's StoryGraph file gave for a copy whose book has none on file).
- Produces, in `src/shared/types.ts`:

```ts
export type CollectionRef = { id: string; name: string };
export type CollectionSummary = { id: string; name: string; isDefault: boolean; count: number; unlabelled: number };
export type ShelfItem = {
  copyId: string; book: BookInfo; labelled: boolean;
  owner: Person | null; holder: Holder; home: boolean; collection: CollectionRef | null;
};                                                     // never a label code
export type Shelf = { collection: CollectionSummary; owner: Person; items: ShelfItem[] };
export type Candidates = { sameIsbn: ShelfItem | null; similar: ShelfItem[] };
export type ImportRow = { title: string; authors: string[]; isbn: string | null };
export type ImportResult = { added: number; skipped: number };
export type ActionType = "claim" | "return" | "move" | "label";
// CopyView gains: collection: CollectionRef | null
// RejectionReason gains: "name-taken"
```

- [ ] **Step 1: Write the failing tests.**
  - Stored shape (`index.test.ts`): add `collections` with literal columns, foreign key `["owner_id", "members", "id", "NO ACTION", "NO ACTION"]`, and indexes `["collections_one_default", 1, "c", 1, ["owner_id"]]`, `["collections_owner_name_key_unique", 1, "c", 0, ["owner_id", "name_key"]]`, `["sqlite_autoindex_collections_1", 1, "pk", 0, ["id"]]`; extend `copies` with `["collection_id", "TEXT", 0, 0]`, `["import_isbn", "TEXT", 0, 0]`, its new foreign key, and `copies_collection_id_idx`.
  - `test("a second default for one owner is refused; defaults for two owners coexist")` — raw inserts; the second `is_default = 1` for one owner rejects `/UNIQUE/`.
  - `test("names clash per owner by key, not across owners")`.
  - `reset.test.ts`: seed one collection and a copy referencing it.
  - `migration.test.ts`, against `env.MIGRATION_DB` (a second D1 binding in `wrangler.test.jsonc`, typed in `test/env.d.ts`). Find this step's migration by content (`i = migrations.findIndex(m => m.queries.some(q => q.includes("CREATE TABLE `collections`")))`), apply `migrations.slice(0, i)`, seed, then apply `migrations.slice(0, i + 1)`:

```ts
test("the migration gives every owner of a copy one default and puts their copies in it", …);
  // seed: Natalie owns 2 copies, Sam owns 1, Kim owns none, 1 copy has no owner
  // after: Natalie and Sam each have exactly one collection: name "Home library", name_key "home library", is_default 1, id matches /^[0-9a-f]{32}$/
  // every owned copy's collection_id is its owner's default; the ownerless copy's is null; Kim has no collection
  // invariantViolations(MIGRATION_DB) is []
test("the seeded rows survive the migration unchanged", …);   // members, books, copies, labels, events row-for-row equal apart from the new columns
```

  If `applyD1Migrations` does not skip migrations already applied, apply `slice(i, i + 1)` the second time instead.

- [ ] **Step 2: Run.** `pnpm test:worker`. Expected: FAIL, tables missing.
- [ ] **Step 3: Schema and migration.** Add to `schema.ts`, run `pnpm db:generate`, and inspect the SQL. It must be only `CREATE TABLE`, `CREATE INDEX`, and `ALTER TABLE copies ADD ...`. If Drizzle emitted a rebuild (`PRAGMA foreign_keys`, `__new_copies`), replace those statements by hand with `ALTER TABLE \`copies\` ADD \`collection_id\` text REFERENCES collections(id);` and `ALTER TABLE \`copies\` ADD \`import_isbn\` text;`, and keep the generated snapshot. Then append the backfill, separated by `--> statement-breakpoint`:

```sql
INSERT INTO `collections` (`id`, `owner_id`, `name`, `name_key`, `is_default`, `created_at`)
  SELECT lower(hex(randomblob(16))), `owner_id`, 'Home library', 'home library', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM (SELECT DISTINCT `owner_id` FROM `copies` WHERE `owner_id` IS NOT NULL);
UPDATE `copies` SET `collection_id` = (SELECT `id` FROM `collections` k WHERE k.`owner_id` = `copies`.`owner_id` AND k.`is_default` = 1)
  WHERE `owner_id` IS NOT NULL AND `collection_id` IS NULL;
```

- [ ] **Step 4: Create `test/invariant.ts`:** `invariantViolations(db: D1Database): Promise<string[]>`, one string per violating copy or member, from three queries: owner and collection not both null or both set; collection's owner differs from the copy's; a member owning a copy with a number of defaults other than 1.
- [ ] **Step 5: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`. Expected: all pass, `db:check` included. Fix the type errors the widened `ActionType` and `CopyView` cause with the narrowest change (`collection: null` in `renderCopy` until Task 4).
- [ ] **Step 6: Commit.** `feat: collections table, copy collection and import ISBN columns, backfilled defaults`

---

### Task 2: Collection names and collection writes

**Files:**
- Create: `src/shared/collectionName.ts`, `src/shared/collectionName.test.ts`, `src/worker/ledger/collections.ts`, `src/worker/ledger/collections.test.ts`
- Modify: `src/worker/ledger/ledger.ts`, `src/worker/ledger/index.ts`

**Interfaces:**
- Produces `cleanCollectionName(raw: unknown): { name: string; key: string } | null` in `src/shared/collectionName.ts` (the client uses it to pre-check; the server's answer is the authority).
- Produces, added to `Ledger`:

```ts
createCollection(member: Member, name: string): Promise<CollectionSummary | Rejection>;
renameCollection(member: Member, id: string, name: string): Promise<CollectionSummary | Rejection>;
deleteCollection(member: Member, id: string): Promise<{ deleted: true } | Rejection>;
makeDefault(member: Member, id: string): Promise<CollectionSummary[] | Rejection>;   // the member's collections after
```

- Produces, private to the ledger, in `collections.ts`: `ensureDefault(db, ownerId: string, at: number): D1PreparedStatement` (insert `Home library` with `is_default = 1` where the owner has no default, `on conflict do nothing`), `ACTIVE` (the active-actor guard fragment), and `DEFAULT_OF` (`(select id from collections where owner_id = ? and is_default = 1)`).

Behaviour:

- A bad name is `invalid`. A key the owner already uses on another collection is `name-taken`; renaming to a case-only variant of its own name succeeds. A missing or someone else's collection is `not-found`. A removed actor is `not-allowed`.
- Create is one statement: `insert … select …, case when exists (default for owner) then 0 else 1 end, … where <ACTIVE> and not exists (same owner, same key) on conflict do nothing`. A member's first collection, however made, is their default. A `UNIQUE` error from a race maps to `name-taken`.
- Rename is one guarded update; 0 changes is resolved by a re-read into `not-found` or `name-taken`.
- Delete is one statement: the actor's, not the default, and `not exists (select 1 from copies where collection_id = ?)`. Refusing the default or a non-empty collection is `not-allowed`.
- Make-default is one batch: clear the old default (guarded on the new one existing and being the actor's), then set the new one (guarded on the actor having no default left). The new one already being the default is a success that changes nothing; otherwise the set must change one row, else `not-found`.

- [ ] **Step 1: Write the failing tests.**

```ts
// collectionName.test.ts
test.each([
  ["  Beach house  ", "Beach house", "beach house"],
  ["École", "École", "école"],
  ["École", "École", "école"],                    // NFD in, NFC out
  ["x".repeat(60), "x".repeat(60), "x".repeat(60)],
  ["👍".repeat(60), "👍".repeat(60), "👍".repeat(60)],   // 60 code points, 120 UTF-16 units
])("%j is name %j with key %j", …);
test.each(["", "   ", "x".repeat(61), "a\nb", "a\u0000b", "‮evil", "a⁦b", 42, null])("%j is refused", …);
```

```ts
// collections.test.ts (afterEach: expect(await invariantViolations(env.DB)).toEqual([]))
test("a member's first collection is their default; the second is not", …);
test("names clash per member, ignoring case, including É and é", …);           // "Beach" then "BEACH" → name-taken; Sam may use "Beach"
test("renaming to a case-only variant of its own name succeeds", …);
test("renaming onto another collection's name is name-taken", …);
test("renaming or deleting someone else's collection is not-found, and changes nothing", …);
test("deleting an empty, non-default collection works", …);
test.each(["the default", "a collection holding an unlabelled copy", "a collection whose only copy is lent out"])(
  "deleting %s is not-allowed", …);                                        // copies placed by raw insert
test("make-default moves the default and leaves exactly one", …);
test("make-default of the current default changes nothing and succeeds", …);
test("make-default of someone else's collection is not-found and leaves both defaults as they were", …);
test("two creates of the same name at once: one succeeds, one is name-taken", …);          // gated(2)
test("two first creates at once: exactly one default", …);                                // gated(2), different names
test("a removed member's collection writes are not-allowed and change nothing", …);
```

- [ ] **Step 2: Run.** `pnpm test:worker`. Expected: FAIL.
- [ ] **Step 3: Implement.** Move `gated` and `racing` from `ledger.test.ts` into `test/racing.ts` so every ledger test file shares them.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Commit.** `feat: create, rename, delete collections and choose the default`

---

### Task 3: Adding into a collection, moving, and lending keeps the collection

**Files:**
- Modify: `src/worker/ledger/ledger.ts`, `rules.ts`, `index.ts`
- Test: `src/worker/ledger/ledger.test.ts`, `rules.test.ts`

**Interfaces:**
- Consumes: `ensureDefault`, `ACTIVE`, `DEFAULT_OF` (Task 2); `invariantViolations` (Task 1).
- Produces: `AddInput` gains `collectionId?: string | null`. Added to `Ledger`: `moveCopy(member: Member, copyId: string, collectionId: string): Promise<CopyView | Rejection>` (the answer carries no code).
- Produces, in `rules.ts`: `CopyState` gains `labelled: boolean`; `decide(state, viewer, action): { holderMemberId: string | null; event: "claimed" | "returned" | "labelled" | null } | Rejection`; `availableActions(state, viewer, opts: { labelInHand: boolean }): ActionType[]`.

Behaviour:

- `decide`: `move` is allowed for the owner of an owned copy, with the holder unchanged and no event. `label` is allowed for the owner when the copy has no label, with event `labelled`. `claim` and `return` are unchanged. `availableActions` offers `claim` only when `labelInHand`.
- `add` without `collectionId` runs `ensureDefault` first in its batch and the copy insert takes `DEFAULT_OF` the adder, never an id chosen in the request. With `collectionId`, the copy insert is guarded on that collection being the adder's. The label update is additionally guarded on the copy row existing, so it stays the one statement whose `meta.changes` says whether everything applied. When it changed nothing, a re-read decides: label now bound → `label-in-use`; collection gone or not the adder's → `not-found`; otherwise `not-allowed`. Every statement carries `ACTIVE`.
- Claim and return never change `collection_id`, except that the update sets `collection_id = coalesce(collection_id, (select id from collections k where k.owner_id = copies.owner_id and k.is_default = 1))`, the copy's owner's default, so a copy added by the old Worker during the rollout gets its column on its next write.
- `moveCopy`: one update guarded on the copy being the actor's and the destination being the actor's (and `ACTIVE`). A copy that exists but is not the actor's is `not-allowed`; a missing copy, or a destination that is missing or not theirs, is `not-found`. Holder and history are untouched.
- A `CopyView` carries the code only when the request carried it: `return` and `moveCopy` answer with `code: null`. Update the existing assertion in "the owner marks it returned" to `expect(copy.code).toBeNull()`.
- Three existing tests rewrite an owner by raw SQL ("a copy with no owner cannot be claimed", and the two stale-owner races that `update copies set owner_id = ?`). Make them keep the invariant, as a step 4 owner change will: setting the owner to null also nulls `collection_id`; setting it to Kim first inserts Kim's default and sets `collection_id` to it in the same statement batch. Do not exempt them from the check.

- [ ] **Step 1: Write the failing tests.** `rules.test.ts` adds rows for `move` and `label` (owner, holder, third member, ownerless; labelled and not) and checks the claim-only-in-hand rule; "an action is available exactly when decide allows it" covers both `labelInHand` values. In `ledger.test.ts`, add `afterEach` asserting `invariantViolations` is `[]`, and:

```ts
test("a first add creates Home library as the default and puts the copy in it", …);
test("an add with a collection puts the copy there", …);
test("an add into someone else's collection is not-found and writes nothing", …);   // counts of books, copies, events unchanged; label still blank
test("an add into a collection deleted after the read is not-found and the label stays blank", …); // racing()
test("two first adds at once by one member: one default, both copies in it", …);   // gated(2), two labels
test("a first add racing the member's first createCollection: one default, and the copy is in it", …); // gated(2)
test("a removed member's add is not-allowed and writes nothing", …);
test("claim then return leave the copy in its collection", …);
test("a claim on a copy with no collection_id fills in its owner's default", …);    // raw update to null first; afterwards collection_id = Natalie's default
test("the owner moves a copy between their collections; holder and history are unchanged", …);
test("moving a lent-out copy works and does not bring it home", …);
test("moving someone else's copy is not-allowed; into someone else's collection is not-found", …);
test("a move racing a delete of the destination never leaves the copy in a deleted collection", …); // racing()
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Commit.** `feat: copies are added into a collection and can move between them`

---

### Task 4: Reading collections, shelves, holding, and a copy by id

**Files:**
- Create: `src/worker/ledger/shelves.ts`, `src/worker/ledger/shelves.test.ts`
- Modify: `src/worker/ledger/ledger.ts`, `index.ts`

**Interfaces:**
- Produces, added to `Ledger`:

```ts
viewCopy(copyId: string, viewer: Member): Promise<CopyView | Rejection>;           // code null, no claim
collectionsOf(ownerId: string): Promise<{ owner: Person; collections: CollectionSummary[] } | Rejection>;
shelf(collectionId: string): Promise<Shelf | Rejection>;
holding(member: Member): Promise<ShelfItem[]>;
```

- Produces, private, in `shelves.ts`: `shelfItem(row: ShelfRow): ShelfItem`, the one serializer for shelves, holding, and candidates. Its SQL selects `exists (select 1 from labels where copy_id = c.id) as labelled` and never selects `labels.code`.

Behaviour:

- `CopyView.collection` is `{ id, name }` of the copy's collection for member viewers on any owned copy, home or out; `null` for an ownerless copy. The public view is unchanged.
- Reads treat an owned copy with a null `collection_id` as in its owner's default: `coalesce(c.collection_id, (select id from collections d where d.owner_id = c.owner_id and d.is_default = 1))`.
- `collectionsOf`: the owner's collections, default first, then by name (`localeCompare`, base sensitivity); `count` is every copy they own in it (lent-out and unlabelled included); `unlabelled` is how many of those have no label. Unknown member: `not-found`. A member with none gets `[]`.
- `shelf`: the collection, its owner, and its copies sorted by title, read in one batch so it agrees with itself. Missing: `not-found`.
- `holding`: copies the member holds that someone else owns, with `owner` and `collection` filled.
- `viewCopy`: as `view` for a member, but `code: null` and `availableActions(…, { labelInHand: false })`. Missing: `not-found`.

- [ ] **Step 1: Write the failing tests.**

```ts
// shelves.test.ts — fixture: Natalie has Home library (2 labelled, 1 unlabelled via raw insert, 1 lent to Sam) and Beach house (1); Sam has 1
test("collectionsOf lists the default first with counts that include lent-out and unlabelled copies", …); // Home: count 4, unlabelled 1; Beach: count 1, unlabelled 0
test("a shelf lists its copies by title with holder, home, and labelled", …);
test("a copy with a null collection_id shows on its owner's default shelf", …);
test("no shelf, collections list, holding list, or copy by id contains a label code", …);
  // every minted code: expect(JSON.stringify(x)).not.toContain(code); and no "code" key anywhere in the nested JSON
test("no shelf or holding list contains an email address", …);       // no "@"
test("holding lists what Sam holds of Natalie's, with owner and collection, and not Sam's own books", …);
test("viewCopy has the collection, no code, and offers return and move to the owner but never claim", …);
test("viewCopy offers label to the owner of an unlabelled copy", …);
test("the public label view has no collection and no names", …);   // exact toEqual of the public shape
test("a member viewing a friend's copy sees its collection", …);
test.each(["shelf", "collectionsOf", "viewCopy"])("%s of something unknown is not-found", …);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Commit.** `feat: collection lists, shelves, holding, and copies by id, without label codes`

---

### Task 5: Book lookup for many ISBNs at once

**Files:**
- Modify: `src/worker/booklookup/booklookup.ts`, `sources.ts`, `index.ts`
- Create: `src/worker/booklookup/fixtures/many.json`
- Test: `src/worker/booklookup/booklookup.test.ts`, `sources.test.ts`

**Interfaces:**
- Produces: `BookSource` gains optional `findMany?(isbns: string[], fetch: typeof globalThis.fetch, signal: AbortSignal): Promise<Map<string, BookInfo>>`; `openLibrary.findMany` implements it. `BookLookup` gains `lookupMany(isbns: string[]): Promise<Map<string, BookInfo>>` (keyed by ISBN-13). `BookLookupDeps` gains `batchTimeoutMs?: number` (default 8000).

Behaviour:

- `lookupMany` normalises with `toIsbn13`, drops what is not an ISBN, and dedupes. More than 20 ISBNs is a programming error and throws `RangeError`; the ledger never sends more.
- The cache is read in one query (`where isbn in (…)`). For the rest, each source that has `findMany` is asked once, in order, for what is still missing; a source without it is skipped. Found books are cleaned with `cleanBookFacts`, then written to the cache in one batch.
- It never throws for a source or cache failure: a source that errors, answers non-200, times out (`batchTimeoutMs`, aborting its signal), or answers the wrong shape contributes nothing.
- Open Library: `GET https://openlibrary.org/api/books?bibkeys=ISBN:<a>,ISBN:<b>,…&format=json&jscmd=data` with the existing `User-Agent`. A found book is the value under `ISBN:<isbn>`; missing ISBNs are absent from the body.
- Written against `main`'s `BookSource`. If PR #5 has merged first, `googleBooks` has no `findMany` and is therefore not asked during an import; say so in the report.

- [ ] **Step 1: Capture the fixture.** Fetch Open Library once with three ISBNs (`9798855427974`, `9780441172719`, and one that answers nothing in a single lookup) and save the body as `fixtures/many.json`. Check the shape above against it; if it differs, the fixture is the authority, adjust and report.
- [ ] **Step 2: Write the failing tests.**

```ts
// sources.test.ts
test("findMany asks once with every ISBN as a bibkey and the User-Agent", …);  // one fetch; URL has all three keys, comma-separated
test("findMany returns the found books from the fixture and nothing for the missing one", …);

// booklookup.test.ts
test("lookupMany answers cached ISBNs without a request and asks once for the rest", …);  // fetch called once with only the uncached keys
test("lookupMany caches what it found in one batch", …);
test("lookupMany normalises ISBN-10s, drops non-ISBNs, and asks for each ISBN once", …);
test("a source without findMany is not asked by lookupMany", …);
test.each(["a rejected fetch", "a 500", "a body that is not JSON", "a request that never answers"])(
  "%s gives an empty map, never a throw", …);                                 // batchTimeoutMs: 20, real timers
test("lookupMany of 21 ISBNs throws RangeError", …);
test("a bad cover from findMany is stored as null", …);
```

- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, with no network access during tests.
- [ ] **Step 6: Commit.** `feat: book lookup for many ISBNs in one Open Library request`

---

### Task 6: Unlabelled copies: import, label from the shelf, and finding them when pairing

**Files:**
- Create: `src/worker/ledger/unlabelled.ts`, `src/worker/ledger/unlabelled.test.ts`
- Modify: `src/worker/ledger/ledger.ts`, `index.ts`

**Interfaces:**
- Consumes: `shelfItem` (Task 4), `ensureDefault`/`ACTIVE`/`DEFAULT_OF` (Task 2), `decide` with `label` (Task 3).
- Produces: `LedgerDeps` gains `lookupMany: (isbns: string[]) => Promise<Map<string, BookInfo>>` (the test helper `make()` supplies `vi.fn(async () => new Map())`). Added to `Ledger`:

```ts
importCopies(owner: Member, input: { collectionId: string | null; rows: ImportRow[] }): Promise<ImportResult | Rejection>;
labelCopy(owner: Member, copyId: string, code: string): Promise<CopyView | Rejection>;
candidates(owner: Member, query: { isbn?: string; title?: string }): Promise<Candidates | Rejection>;
```

- Produces, private: `titleKey(title: string): string`: NFC, `toLowerCase`, cut at the first `:`, runs of `[^\p{L}\p{N}]` to one space, trimmed.

Behaviour:

- **`importCopies`.** `rows` is 1 to 20 rows, each with a title of 1 to 300 code points, at most 10 authors of 1 to 200 code points, and an ISBN that is null or accepted by `toIsbn13` (stored normalised); anything else makes the whole chunk `invalid`. A named collection that is missing or not the owner's is `not-found`; with `null`, the default is ensured in the batch.
  - One read finds which ISBNs already have a `books` row; `lookupMany` is called once with the rest, and every result goes through `cleanBookFacts` again before it is stored (the second writer re-checks the cover rule).
  - One batch, per row: the book (an ISBN found in `books` or by the lookup uses the ISBN row, inserted `on conflict(isbn) do nothing`; otherwise a new book row with no ISBN, holding the row's title and authors), the copy (owner and holder the importer, no label, `import_isbn` set to the row's ISBN), and one `added` event.
  - Every copy insert is guarded on the importer not already owning that book: for a row with an ISBN, no copy of theirs whose book has that ISBN or whose `import_isbn` is it; for a row without, no copy of theirs whose book has exactly this title and this authors JSON. A no-ISBN book insert carries the same guard, so a skipped row leaves no orphan book. The event is guarded on the copy existing. Statements earlier in the batch are visible to later ones, so a repeated row in one chunk is skipped too.
  - `added` is the number of copy inserts that changed a row; `skipped` is the rest. If nothing was added and the named collection no longer exists, the answer is `not-found`.
- **`labelCopy`.** The code is parsed with `parseLabelLink`. A label that is not minted is `label-unknown`; a bound one is `label-in-use`; a copy that is missing is `not-found`; `decide(…, "label")` refusing is `not-allowed`. One batch: a `labelled` event, then the label update, each guarded on the label still blank, the copy being the actor's, `ACTIVE`, and `not exists (select 1 from labels where copy_id = ?)`, so two labels racing for one copy cannot both bind. The answer carries the code (the request did).
- **`add` binds before it creates.** With an ISBN, `add` first looks for the adder's oldest unlabelled copy whose book has that ISBN or whose `import_isbn` is it (oldest by `created_at`, then `id`). If there is one, it binds the label to it as `labelCopy` does, with no lookup and no new copy; the picked collection is ignored for an existing copy.
- **A bind that changed nothing** (in `labelCopy` or `add`'s bind) is resolved by one rule: re-read the label; bound now → `label-in-use`; otherwise `not-allowed`.
- **`candidates`.** `isbn` (normalised; else `invalid`) gives `sameIsbn`, the same copy `add` would bind. `title` (1 to 300 code points; else `invalid`) gives `similar`: the owner's unlabelled copies whose `titleKey` equals the title's, excluding `sameIsbn`, oldest first, at most 10. An empty key matches nothing. Neither given is `invalid`.

- [ ] **Step 1: Write the failing tests.** All with `afterEach` asserting `invariantViolations` is `[]`.

```ts
test("an import adds unlabelled copies owned and held by the importer, in the chosen collection, each with one added event", …);
test("an import with no collection goes into the default, creating Home library", …);
test("a found ISBN uses the lookup's facts and cover; a missed one keeps the CSV title on a book with no ISBN and the ISBN on the copy", …);
  // books where isbn = missed ISBN: none; copies.import_isbn = missed ISBN
test("an ISBN already in books is not looked up", …);                 // lookupMany called without it
test("lookupMany is called once per chunk", …);
test("a cover from lookupMany that is not https on covers.openlibrary.org is stored as null", …);
test("importing the same rows again adds nothing and reports them skipped", …);
test("a repeated row within one chunk is added once", …);
test("a row matching a copy Natalie paired by scanning is skipped", …);
test("two identical chunks at once add each book once", …);          // gated(2)
test("a chunk of 21 rows, or a row with a 301-character title or an ISBN that isn't one, is invalid and writes nothing", …);
test("an import into Sam's collection is not-found and writes nothing", …);
test("an import into a collection deleted after the read adds nothing and is not-found", …); // racing()
test("Sam's import of the same ISBN does not skip because Natalie owns it", …);
test("scanning an imported ISBN binds the label to the imported copy: no lookup, no new copy, history added then labelled", …);
test("scanning an ISBN known only as import_isbn binds without a lookup", …);
test("labelCopy binds a label to an unlabelled copy the owner picked", …);
test("labelCopy on a copy that already has a label is not-allowed; on someone else's copy, not-allowed; on a missing one, not-found", …);
test("two labels for one copy at once: one binds, one is refused, the other label stays blank", …); // gated(2)
test("one label for two copies at once: one binds, one is label-in-use", …);  // gated(2)
test("candidates finds the same-ISBN copy and title matches across editions", …);
  // "Dune: Deluxe Edition" matches "DUNE"; "The Left-Hand of Darkness" matches "the left hand of darkness"; labelled copies and Sam's copies never appear
test("candidates contain no label code", …);
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Count statements and bound parameters for a 20-row chunk in a comment beside the batch (at most 1 + 3 × 20 statements; no statement over 100 parameters).
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Commit.** `feat: import unlabelled copies, label them later, and find them when pairing`

---

### Task 7: Routes

**Files:**
- Modify: `src/worker/index.ts`, `src/worker/membership/membership.ts`, `src/worker/membership/index.ts`
- Test: `src/worker/index.test.ts`, `src/worker/flow.test.ts`, `src/worker/membership/membership.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 6; `lookupMany` wired into `createLedger` in `servicesFor`.
- Produces: `Membership.members(): Promise<Person[]>`, active members ordered by name. Routes, all member-only, JSON, `no-store`:

| Route | Answer |
|---|---|
| `GET /api/collections/mine` | `{ owner: Person; collections: CollectionSummary[] }` |
| `POST /api/collections` `{ name }` | `CollectionSummary` |
| `PATCH /api/collections/:id` `{ name }` | `CollectionSummary` |
| `DELETE /api/collections/:id` | `{ deleted: true }` |
| `POST /api/collections/:id/default` | `{ collections: CollectionSummary[] }` |
| `GET /api/collections/:id` | `Shelf` |
| `GET /api/members` | `{ members: Person[] }` |
| `GET /api/members/:id/collections` | `{ owner: Person; collections: CollectionSummary[] }` |
| `GET /api/holding` | `{ items: ShelfItem[] }` |
| `GET /api/copies/candidates?isbn=&title=` | `Candidates` |
| `GET /api/copies/:id` | `CopyView` (no code) |
| `POST /api/copies/:id/move` `{ collectionId }` | `CopyView` |
| `POST /api/copies/:id/label` `{ code }` | `CopyView` |
| `POST /api/imports` `{ collectionId, rows }` | `ImportResult` |
| `POST /api/copies` gains optional `collectionId` | as before |

- `name-taken` is 409. `/api/copies/candidates` is registered before `/api/copies/:id`. A missing `collectionId` in an import body is `null`; any other non-string is 400.

- [ ] **Step 1: Write the failing tests.**

```ts
// index.test.ts
test.each([/* every new route */])("%s signed out is 401", …);
test("a name clash is 409 name-taken", …);
test.each(["PATCH /api/collections/x", "DELETE /api/collections/x", "POST /api/imports"])(
  "%s from another site is 403 and changes nothing", …);
test("an import body over 16 KB is 400; 21 rows is 400", …);
test("GET /api/members lists active members with no email and not removed ones", …);
test("no collections, shelf, holding, candidates, or copy-by-id answer contains a label code or an @", …);

// flow.test.ts
test("import, see the shelf, scan to label, lend, and come home to the same collection", async () => {
  // Natalie creates "Beach house"; imports 3 rows into it (one ISBN the lookup knows, one it doesn't, one with no ISBN) → { added: 3, skipped: 0 }
  // GET the Beach house shelf → 3 items, labelled false
  // the same import again → { added: 0, skipped: 3 }
  // Natalie mints a label and adds { code, isbn: the unknown ISBN } → 200, same copyId as the shelf item, copies count unchanged
  // Sam GETs /api/members/<natalie>/collections and the shelf → no code, no "@"
  // Sam claims by label; GET /api/holding for Sam → that copy, owner Natalie, collection Beach house
  // Natalie returns; GET /api/copies/<id> → home, collection Beach house, code null
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 5: Commit.** `feat: routes for collections, shelves, holding, labelling, and import`

---

### Task 8: Client calls, routes, and the copy page by id

**Files:**
- Modify: `src/client/api.ts`, `route.ts`, `App.tsx`, `screens/CopyPage.tsx`, `screens/Home.tsx`, `index.css`
- Test: `api.test.ts`, `route.test.ts`, `App.test.tsx`, `screens/CopyPage.test.tsx`, `screens/Home.test.tsx`

**Interfaces:**
- Produces, in `api.ts`, one function per Task 7 route: `myCollections()`, `createCollection(name)`, `renameCollection(id, name)`, `deleteCollection(id)`, `makeDefault(id)`, `getShelf(id)`, `listMembers()`, `memberCollections(id)`, `getHolding()`, `getCandidates(q: { isbn?: string; title?: string })`, `getCopy(id)`, `moveCopy(id, collectionId)`, `labelCopy(id, code)`, `importRows(collectionId: string | null, rows: ImportRow[])`; `addCopy` input gains `collectionId?: string`.
- Produces: `Route` gains `{ name: "mine" }` (`/mine`), `{ name: "shelf"; id }` (`/collections/<id>`), `{ name: "holding" }`, `{ name: "members" }`, `{ name: "member"; id }` (`/members/<id>`), `{ name: "copy-by-id"; id }` (`/copies/<id>`), `{ name: "import" }`.
- Produces: `<CopyPage code member returnTo />` keeps its props; `<CopyPage copyId member returnTo />` loads with `getCopy`.

Behaviour:

- Owner line: `Owned by <name> · <collection>`, the collection in `<bdi>` and omitted when null. Holder line: `At home` when home, else `With <name>`.
- Actions: `move` shows `Move to` with a select of the owner's collections (from `myCollections`) and `Move`; `label` shows a link `Put a label on it` → `/pair?copy=<copyId>`. A `not-found` from a move refetches the collections and says `That collection is gone. Pick another.`
- Carry-overs fixed here: a 2xx with a non-JSON body throws `ApiError` (status, `rejected: null`), not `SyntaxError`; the copy page's trouble branch renders inside `.copy-page`; `returnTo` is re-pinned in an App test on a `/b/<code>` page.
- `Home`, signed in, gains `My books` → `/mine`, `What I'm holding` → `/holding`, `Friends' shelves` → `/members`, and `Import from StoryGraph` → `/import`. Screens for the new routes other than `copy-by-id` render `NotFound` until Tasks 9 and 11.

- [ ] **Step 1: Write the failing tests.** `route.test.ts` table for every new path, with and without a trailing slash, and `/collections/`, `/copies/a/b` as not-found. `api.test.ts`: each new function's URL, method, and body; a 200 with a body of `<html>` throws `ApiError`. `CopyPage.test.tsx`: the owner line with a collection, with `<bdi>`; `At home`; a by-id page loads with `getCopy`, never calls `getLabel`, and shows no claim button even when `actions` has `claim`; `Move` calls `moveCopy` once and shows the returned view; a move refused `not-found` shows the message and refreshed choices; `Put a label on it` links to `/pair?copy=<id>`; the trouble branch is inside `.copy-page`. `App.test.tsx`: a refusal on `/b/abc` keeps `returnTo` `/b/abc`.
- [ ] **Step 2: Run.** `pnpm test:client`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [ ] **Step 5: Commit.** `feat: client calls and routes for collections, and the copy page by id`

---

### Task 9: My books, a shelf, what I'm holding, and friends' shelves

**Files:**
- Create: `src/client/screens/Mine.tsx`, `Shelf.tsx`, `Holding.tsx`, `Members.tsx`, `ShelfList.tsx` and their tests
- Modify: `src/client/App.tsx`, `index.css`

**Interfaces:**
- Consumes: Task 8's calls and routes.
- Produces: `<Mine member returnTo />`, `<Shelf id member returnTo />`, `<Holding member returnTo />`, `<Members member returnTo />` (no id: the list; with id: that member's collections), and `<ShelfList items showOwner? />`, the one list renderer.

Behaviour:

- `ShelfList` row: cover (or placeholder), title, authors, `At home` or `With <name>`, and `No label yet` when not labelled. A row links to `/copies/<copyId>`. An unlabelled row the viewer owns also has `Put a label on it` → `/pair?copy=<copyId>`. Nothing in it reads or renders a code.
- `Mine` groups the member's books by collection: a heading per collection (in `<bdi>`, linking to its shelf, with its count and `N without a label` when any), then its `ShelfList`. It loads `myCollections`, then each shelf. A `Show only books without a label` toggle filters every group. With no collections: `No books yet.` and links to pair and import. At the end: a `New collection` form (`cleanCollectionName` pre-checks; `name-taken` → `You already have a collection called that.`).
- `Shelf`: the collection's name and owner's name. For the owner: `Rename`, `Make this the default` (hidden on the default), and `Delete` (shown only when empty and not the default; asks `Delete <name>?` first). After any change it refetches.
- `Holding`: `ShelfList` with the owner shown on each row. Empty: `You're not holding anyone else's books.`
- `Members`: other members by name, each linking to `/members/<id>`, which lists that member's collections, each linking to its shelf. The signed-in member is not in the list.
- Signed out, each shows the sign-in link back to its own page.

- [ ] **Step 1: Write the failing tests**, with `api` mocked: `ShelfList` renders no element containing a code even when the item object has an extra `code` field (render a forged item and assert the code text is absent); `Mine` groups two collections in order with counts and the unlabelled filter; creating a collection calls `createCollection` once and a `name-taken` shows its message; `Shelf` shows owner controls only to the owner, hides delete on the default and on a non-empty collection, renames, and makes default; `Holding` shows owners; `Members` omits the signed-in member and links to shelves; each signed-out screen shows only the sign-in link.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [ ] **Step 5: Commit.** `feat: my books by collection, shelves, holding, and friends' shelves`

---

### Task 10: Pairing into a collection, and finding imported copies

**Files:**
- Modify: `src/client/screens/Pair.tsx`, `index.css`
- Test: `src/client/screens/Pair.test.tsx`

**Interfaces:**
- Consumes: `myCollections`, `createCollection`, `getCandidates`, `getCopy`, `labelCopy`, `addCopy` with `collectionId`.

Behaviour:

- **Finding an imported copy.** After an ISBN reading, `getCandidates({ isbn })` and `lookupBook(isbn)` run together.
  - A `sameIsbn` copy is shown in place of the lookup's answer: `Is this the book?` with that copy's cover, title, authors, and `From <collection>`. `Yes` goes to the label step for that copy; saving is `addCopy({ code, isbn })` (the server binds to the same copy).
  - Otherwise, once a title is known, from the lookup or from typing, `getCandidates({ title })` runs. If `similar` is non-empty: `Is it one of these?` lists them, plus `No, it's a different copy`. Picking one goes to the label step for that copy, saved with `labelCopy(copyId, code)`. If `similar` is empty, the flow is unchanged.
  - A failed candidates request is treated as no candidates; pairing must still work.
- **Labelling from the shelf.** `/pair?copy=<id>` loads `getCopy(id)` and starts at the label step for that copy, saved with `labelCopy`. A copy that is missing, not the member's, or already labelled shows `That book can't take a label here.` with a link to `/mine`.
- **The collection picker**, in the label step, only for a new copy and only when the member has two or more collections: `Collection` with every collection by name (default first) and `New collection…`, which reveals a name field and `Create`. For an existing copy the step says `It stays in <collection>.` instead.
  - The last pick is stored under `nll.pair-collection.<memberId>`. On load it is checked against `myCollections`; if it is not there: the default is selected and `The collection you used last is gone, so this goes in <default>.` is shown.
  - A save refused `not-found` refetches the collections, keeps the label and book, and shows `That collection was just deleted. Pick another.`
- `labelCopy` refusals: `label-in-use` and `label-unknown` as for `addCopy`; `not-allowed` → `That book already has a label.` and back to the start.

- [ ] **Step 1: Write the failing tests**, with the scanner stubbed and `api` mocked: a `sameIsbn` hit shows the imported title even when the lookup misses, and saving calls `addCopy({ code, isbn })` once with no `collectionId`; a title match after a lookup offers `Is it one of these?`, picking one calls `labelCopy(copyId, code)`, and `No, it's a different copy` continues to a new copy; a typed title also asks; a candidates failure still lets a new copy be saved; `/pair?copy=c1` skips to the label step and calls `labelCopy("c1", code)`; the picker is absent with one collection and present with two; the stored pick is preselected; a stored pick that is not in the list falls back to the default with the notice; a stored pick from another member's key is never read; `New collection…` creates and selects; a `not-found` save shows its message and refreshed choices; `localStorage` throwing still lets a book be saved.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [ ] **Step 5: Commit.** `feat: pair into a collection and label imported books by scanning`

---

### Task 11: StoryGraph parser and the import screen

**Files:**
- Create: `src/client/storygraph/index.ts`, `csv.ts`, `parse.ts`, `fixture.ts`, `csv.test.ts`, `parse.test.ts`, `src/client/screens/Import.tsx`, `Import.test.tsx`
- Modify: `src/shared/isbn.ts`, `src/shared/isbn.test.ts`, `src/client/App.tsx`, `index.css`

**Interfaces:**
- Produces, from `src/client/storygraph/index.ts`:

```ts
export type ParseResult =
  | { ok: true; rows: ImportRow[]; skipped: { notOwned: number; notPhysical: number; noTitle: number } }
  | { ok: false; missing: string[] };          // column headers not found
export function parseExport(text: string): ParseResult;
export function chunkRows(rows: ImportRow[], maxRows?: number, maxBytes?: number): ImportRow[][]; // defaults 20 and 12000 UTF-8 bytes (TextEncoder) of the request body
```

- Private: `parseCsv(text: string): string[][]` in `csv.ts`; `COLUMNS = { title: "Title", authors: "Authors", isbn: "ISBN/UID", format: "Format", owned: "Owned?" }` and `OWNED_VALUE = "yes"` in `parse.ts`.
- Produces: `<Import member returnTo />`.

Behaviour:

- `parseCsv` follows RFC 4180: a leading BOM is dropped; CRLF, LF, and CR all end a record outside quotes; quoted fields may hold commas, doubled quotes, and line breaks; a trailing newline adds no record. It is pure and has no dependency.
- `parseExport` finds columns by header, trimmed and case-insensitive. Missing columns give `{ ok: false, missing }`, naming them; it never imports zero rows silently. A row is kept when `Owned?` is `yes` (case-insensitive) and `Format` is empty or contains `hardcover` or `paperback` (case-insensitive); other owned rows count as `notPhysical`. Title and authors go through `cleanBookFacts`'s cutting (authors split on `,` and trimmed); a row with no title counts as `noTitle`. `ISBN/UID` goes through `toIsbn13`; anything it refuses is `null`. Each kept row is exactly `{ title, authors, isbn }`: no other field exists on it.
- `toIsbn13` carry-over, since the import now feeds it: refuse `9790` (ISMN); accept a leading `ISBN`, `ISBN:`, `ISBN-13:`, or `ISBN-10:` (any case) and en and em dashes as separators.
- **Import screen.** Pick a file → `file.text()` → `parseExport`. Nothing is sent until `Import` is pressed. The preview says `<n> books to import.` and, when any, `<k> digital or audio skipped.`; a missing-columns result says `This doesn't look like a StoryGraph export. Missing: <names>.` With one or more collections, a `Into` picker (default first, `New collection…` as in Pair); with none, the books go into the default.
  - `Import` sends `chunkRows(rows)` one at a time, at least 1 s apart, showing `Added <a> of <n>…`. The button is disabled from the first press until the run ends.
  - Done: `Added <a>. <s> were already in your collection.` and a link to the collection.
  - A failed chunk stops the run: `Stopped after <done> of <n>. Import the same file again to carry on; books already added are skipped.`
  - Neither the file nor its rows are written to `localStorage`.
- The fixture is a synthetic export string in `fixture.ts`, written for this test, with the five columns above plus `Contributors`, `Read Status`, `Star Rating`, `Review`, and `Dates Read`. It has a BOM and CRLF line ends, and rows covering: owned hardcover with an ISBN-13; owned paperback with an ISBN-10; owned `digital`; owned `audio`; not owned; owned with no format and no ISBN; owned with a non-ISBN UID; a title with a quoted comma and doubled quotes; and a review spanning three lines that contains the sentinel `PRIVATE-REVIEW-7f3a`. Star ratings are `4.25` and dates are `2025/03/01`.

- [ ] **Step 1: James confirms the header.** The spec does not list the export's columns, and agents must not open the file. Ask James to run `head -1 storygraph_export.csv` himself and paste only that line, and to say what the `Owned?` column holds for an owned book. If anything differs from `COLUMNS` or `OWNED_VALUE`, change the constants and the fixture to match before Step 2. Record what he confirmed in the report.
- [ ] **Step 2: Write the failing tests.**

```ts
// csv.test.ts
test.each([
  ['a,b\r\nc,d\r\n', [["a", "b"], ["c", "d"]]],
  ['﻿a,b\n', [["a", "b"]]],
  ['"x, y",z\n', [["x, y", "z"]]],
  ['"he said ""hi""",z\n', [['he said "hi"', "z"]]],
  ['"line1\r\nline2\nline3",z\n', [["line1\r\nline2\nline3", "z"]]],
  ['a,\n', [["a", ""]]],
  ['a,b', [["a", "b"]]],
])("%j parses to %j", …);

// parse.test.ts
test("the fixture keeps owned physical and formatless rows, and counts the rest", …);   // exact rows and skipped counts
test("a kept row has exactly title, authors, and isbn", …);              // Object.keys(row).sort() for every row
test("nothing from a review, rating, or date survives", …);              // JSON.stringify(result) contains none of PRIVATE-REVIEW-7f3a, 4.25, 2025/03/01
test("an ISBN-10 becomes ISBN-13; a UID that isn't an ISBN becomes null", …);
test("columns are found by name in any order and case", …);
test("a file without the StoryGraph columns names what is missing", …);
test("chunks hold at most 20 rows and 12000 UTF-8 bytes of JSON each, in order, with nothing lost", …); // 250 rows, some with 300-character titles in Japanese (3 bytes each)

// isbn.test.ts additions
test.each(["ISBN 978-0-306-40615-7", "isbn: 9780306406157", "ISBN-10: 0-306-40615-2", "978–0–306–40615–7"])("%s is 9780306406157", …);
test("an ISMN (979-0) is not an ISBN", …);

// Import.test.tsx
test("choosing the fixture shows the count and sends nothing until Import is pressed", …); // fetch mock not called
test("Import sends each chunk once, in order, about a second apart, and no request body contains the review sentinel", …); // fake timers
test("a double press runs one import", …);
test("a failed chunk stops and says how to carry on", …);
test("the import goes into the chosen collection; with none, collectionId is null", …);
test("a file that isn't an export names the missing columns and offers no Import", …);
```

- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Confirm with `git status` that no `.csv` file is staged and `grep -r PRIVATE-REVIEW dist` finds nothing.
- [ ] **Step 6: Commit.** `feat: import a StoryGraph export into a collection, parsed in the browser`

James's check, not the agent's: open `/import` locally with the real export and read the preview. The spec counted 240 hardcover or paperback and 8 with no format among 290 owned, so expect `248 books to import.` and `42 digital or audio skipped.`

---

### Task 12: Carry-overs and close-out

**Files:**
- Modify: `src/shared/labelCode.ts`, `src/shared/labelCode.test.ts`, `eslint.config.js`, `README.md`, `docs/ROADMAP.md`, `docs/superpowers/specs/2026-11-16-little-library-design.md`, `.claude/agents/antagonist-techniques.md`

- [ ] **Step 1: Carry-overs, with tests first.**
  - `parseLabelLink` accepts one trailing slash (`/b/<code>/`); `/b/<code>//` and `/b/<code>/x` stay refused.
  - eslint ignores `dist` at any depth (`**/dist/**`); show that a stray `src/x/dist/a.js` no longer breaks `pnpm lint`, then delete it.
- [ ] **Step 2: Spec corrections.** Add to the main spec's "Corrections" section, without editing the text above it:
  - `collection(member, viewer)` became `collectionsOf(ownerId)` and `shelf(id)`, with `holding(member)`.
  - Copies reached by id have their own page (`/copies/<id>`) with no code and no claim.
  - An imported ISBN the lookup can't find is kept on the copy as `import_isbn`, not on the shared book.
  - Imports ask only sources that take many ISBNs in one request.
  - A file with two copies of the same book imports one.
  - The StoryGraph columns James confirmed.
- [ ] **Step 3: Roadmap.** Mark what step 3 delivered. Move the remaining step 2 carry-overs that this step did not touch to step 4's carry-overs: the scanner tidies (`bundledDecoder` export, `onRead` inside the detect try, the not-a-book message on hide/show, `visibilityState` in Scanner tests), the printing partial-mint message, and `fetched_at` never being read. On `fetched_at`, note that refreshing the cache would change no stored book, because the ledger copies facts when a copy is added; it needs a design, not a patch. Add a step 4 item: a migration that backfills any owned copy still with a null `collection_id` from the rollout window, creating defaults where missing. Add a step 4 item: give, adopt, and approve-request must ensure the new owner's default in the same batch and set both columns in one statement; release must null both.
- [ ] **Step 4: README.** Collections, holding, friends' shelves, and the import, for a person: the file never leaves the browser except titles, authors, and ISBNs; re-running an import is safe.
- [ ] **Step 5: Techniques.** Land this step's accepted antagonist proposals in `.claude/agents/antagonist-techniques.md`, keeping it under 100 lines.
- [ ] **Step 6: Run everything CI runs**, from a clean install: `pnpm install --frozen-lockfile`, `pnpm wrangler types --check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- [ ] **Step 7: Commit.** `docs: step 3 in the README, spec, and roadmap; small carry-overs`

The roadmap's "done when" (Natalie's ~240 books show in her collection and she can label them without typing) needs the app deployed and her real export. It is James's check, after a release tag.
