# Owner Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner can lend a book to a member or to a placeholder person, give it to a member, answer a request to keep it, and release it. A member can ask to keep a book they hold, and take a released one. Placeholders can be renamed and linked to a member.

**Architecture:**
- **Data:** a new `people` table, and nullable columns on `copies` (the placeholder holder, the open request) and on `events` (the other person).
- **Rules:** `decide()` in `rules.ts` grows into the full table and returns a whole new state, not just a holder.
- **The write:** one generalized guarded write in the ledger applies any decided change. Claim and return move onto it.
- **People reads and writes** live in a new `people.ts`, spread into the ledger like `sheets.ts`.

**Tech Stack:** Hono Worker, D1 via Drizzle (drizzle-kit migrations), React 19, Vitest (worker pool and jsdom), pnpm.

**Spec:** `docs/superpowers/specs/2026-11-26-owner-tools-design.md` (extends `2026-11-16-little-library-design.md`)

## Global Constraints

- **Schema:** add tables, nullable columns and indexes only; no table rebuild (D1 cannot turn foreign keys off).
- **Writes:** every state-changing write is one guarded batch whose guards are re-checked inside the statements. A refused write changes no row, and a copy that changed since it was read answers `not-allowed`.
- **Requests:** every write that changes a copy's owner or holder clears its open request in the same statement.
- **Owner and collection:** `owner_id` and `collection_id` are null together. Give, approve and take set both in one statement, with `ensureDefault` for the new owner earlier in the same batch. Release nulls both.
- **History** is append-only: nothing edits or deletes an event, linking included.
- **Who sees what:**
  - A placeholder's name is shown only to members (in copy views and shelves, as every holder name is today).
  - A member's list of placeholders (`GET /api/people`) is shown only to that member.
  - Placeholders are matched by `name_key` (trimmed, NFC, lowercased), unique per creator.
- **Who may act:**
  - Only the creator renames or links a placeholder.
  - Linking to a removed member, to oneself, or linking twice is `not-allowed`.
  - Lending or giving to a removed member, or approving a removed asker, is `not-allowed`.
- **Release** needs a label. **Take** (`adopt`) and **claim** need the label in hand.
- **Tombstones:**
  - A removed member is `Person.removed: true` wherever a person is rendered (owner, holder, actor, subject, asker, linked member), and the client shows "<name> (no longer a member)".
  - A copy whose owner was removed is taken like an ownerless one, and claim is not offered on it.
  - A removed asker's request counts as none: `CopyView.request` is null, and it cannot be approved or declined. A new request overwrites it, and any owner or holder change clears it.
- **Copy as the spec fixes it:**
  - Buttons: "Lend", "Give", "Ask to keep this", "Release", "Take this book", "Approve", "Decline", "Withdraw".
  - Lend suggestion: `Lend to "<typed>"`.
  - Request line: "<name> asked to keep this".
  - Give confirm: "Give <title> to <name>?"
  - Release confirm: "Release <title>? It leaves your collection and anyone who scans it can take it."
  - Released page: "No one owns this book."
  - History: "Natalie lent this to Sarah".
  - Link confirm: "Link Sarah to <member>? The books Sarah has will show as theirs."
  - The default-name fallback: "Home library 2".
- **Commands:**
  - `pnpm test:worker <file>`, `pnpm test:client <file>`, `pnpm typecheck`, `pnpm lint` and `pnpm db:check` all pass before each commit.
  - New routes go in `index.test.ts`'s `EVERY_NEW_ROUTE` 401 table.
- **No agent** deploys, runs `--remote`, `wrangler login` or `secret put`, pushes, merges, tags, or opens `storygraph_export.csv` or `.dev.vars`.

## Rulings made writing this plan

- **`decide(state, viewer, action)` takes an action object** (`{ type: "lend", to }`, `{ type: "give", to }`, …) and returns a `Change`: the copy's whole next owner, holders and request, plus the event, subject and whether ownership moved. `availableActions` asks a private `allows(state, viewer, type)` that does not need a target, so Lend and Give are offered to an owner and their target is checked at write time.
- **A copy view's holder is `Holder | null`, and the `"named"` kind goes.**
  - `Holder = { kind: "member"; person: Person } | { kind: "person"; id: string; name: string }`.
  - A copy holding neither member nor placeholder renders `null`, not `""`.
  - A linked placeholder never holds a copy, because linking moves its copies to the member. In history it renders as `kind: "member"` with the linked member.
- **Lend's `{ name }` is resolved before deciding.**
  - It looks up the owner's placeholder by `name_key`.
  - If that placeholder is linked, the lend goes to the linked member; if it is unlinked, to that placeholder.
  - Otherwise a new placeholder is inserted in the same batch, and the copy update is guarded on it existing. If a concurrent lend made the same name first, the insert does nothing, the guard fails and the answer is `not-allowed`; the client reloads and the name now matches.
- **Placeholder names reuse the collection-name rules.** `cleanCollectionName`'s body moves to `cleanName` in `src/shared/name.ts`, and `cleanCollectionName` and `cleanPersonName` are both that function. The limit is 60 characters and control and format characters are refused.
- **Confirms are inline steps on the page, not `window.confirm`,** as Pair's replace confirm is.
- **Task 6 makes the copy page's action dispatch exhaustive** (a `switch` over `ActionType` with a `never` check), so no action can fall through to `returnCopy`.
- **History wording:**
  - lent: "lent this to <subject>"
  - given: "gave this to <subject>"
  - requested: "asked to keep this"
  - withdrawn: "withdrew their request"
  - approved: "let <subject> keep this"
  - declined: "declined <subject>'s request"
  - released: "released this"
  - adopted: "took this on"
- **The People page lives at `/people`,** with a "People" button on Home after "Friends' shelves".

## Review Focus

1. **Natalie lends while Sam claims, at the same moment.** One wins and the other is `not-allowed`; the copy has one holder and the invariant holds. (Task 3)
2. **"sarah " typed when "Sarah" exists.** The same placeholder is used, and no second row is made. (Task 3)
3. **Giving to a member who owns nothing yet** (no collections). They get a default and the copy is in it. With a non-default "Home library" already theirs, the default is "Home library 2". (Task 4)
4. **An open request, then the owner lends the book to someone else.** The request is gone, and the asker's page offers no Withdraw. (Task 3)
5. **Natalie lent a book to her Sarah, then gave the book to James, and Natalie links Sarah to Sarah's account.** James's book is now held by member Sarah, and James's view shows her. (Task 5)

---

### Task 1: Data for people, requests and subjects; holders render as member, placeholder or none

**Files:**
- Modify: `src/worker/db/schema.ts` (new `people`; `copies` and `events` columns)
- Create: `drizzle/<generated>/migration.sql` (by `pnpm db:generate`)
- Create: `src/shared/name.ts`; modify `src/shared/collectionName.ts` to re-export
- Modify: `src/shared/types.ts` (`Holder`, `CopyView`, `ShelfItem`, `HistoryEntry`)
- Modify: `src/worker/ledger/ledger.ts` (`COPY_SELECT`, `renderCopy`), `src/worker/ledger/shelves.ts` (`SHELF_SELECT`, `shelfItem`)
- Modify: `src/client/screens/CopyPage.tsx`, `src/client/screens/ShelfList.tsx` (or wherever a shelf item's holder is shown) to render the new holder kinds
- Modify: `test/invariant.ts`
- Test: `src/worker/index.test.ts` (schema pin), `src/worker/ledger/ledger.test.ts`, `src/worker/ledger/shelves.test.ts`, `src/client/screens/CopyPage.test.tsx`

**Interfaces:**
- Produces:
  - **`people` table:** `id` text pk, `created_by` text not null → members, `name` text not null, `name_key` text not null, `linked_member_id` text → members, `created_at` integer not null, `linked_at` integer.
    - Unique index `people_creator_name_key_unique` on (`created_by`, `name_key`).
    - Index `people_linked_member_id_idx`.
  - **New `copies` columns:** `holder_person_id` text → people, `requested_by` text → members, `requested_at` integer. Index `copies_holder_person_id_idx`.
  - **New `events` columns:** `subject_member_id` text → members, `subject_person_id` text → people.
  - **Types:**
    - `Person` gains `removed?: true`, present only for a removed member. It is never `false`, so existing `toEqual` fixtures stay valid.
    - `Holder = { kind: "member"; person: Person } | { kind: "person"; id: string; name: string }`.
    - `CopyView.holder: Holder | null`.
    - `CopyView.request: { by: Person; at: number } | null`.
    - `ShelfItem.holder: Holder | null`.
    - `HistoryEntry = { at; type; actor: Person; subject?: Holder }`.
    - `HistoryEntry.type` adds `"lent" | "given" | "requested" | "withdrawn" | "approved" | "declined" | "released" | "adopted"`.
  - **Names:** `cleanName(raw: unknown): { name: string; key: string } | null` in `src/shared/name.ts`, and `cleanPersonName = cleanName`.
- Consumes: nothing new.

- [ ] **Step 1: Update the schema pin in `index.test.ts`:**
  - add the `people` table and its two indexes;
  - append the three `copies` columns and two `events` columns, in the order the migration adds them;
  - add `copies_holder_person_id_idx` to `expectedIndexSql`.
- [ ] **Step 2: Write the failing tests.**

```ts
// ledger.test.ts
test("a copy held by a placeholder renders the placeholder, and one held by nobody renders null", async () => {
  const { ledger } = make();
  const { copyId } = await homeCopy(ledger);
  await env.DB.prepare("insert into people (id, created_by, name, name_key, created_at) values ('p-sarah', ?, 'Sarah', 'sarah', 1)").bind(natalie.id).run();
  await env.DB.prepare("update copies set holder_member_id = null, holder_person_id = 'p-sarah' where id = ?").bind(copyId).run();
  const held = ok(await ledger.viewCopy(copyId, natalie));
  expect(held.holder).toEqual({ kind: "person", id: "p-sarah", name: "Sarah" });
  expect(held.home).toBe(false);
  // Held by nobody: only reachable for a copy with no owner (the invariant's afterEach checks this).
  await env.DB.prepare("update copies set holder_person_id = null, owner_id = null, collection_id = null where id = ?").bind(copyId).run();
  expect(ok(await ledger.viewCopy(copyId, natalie)).holder).toBeNull();
});

test("an open request renders with the asker", async () => {
  const { ledger } = make();
  const { copyId } = await homeCopy(ledger);
  await env.DB.prepare("update copies set holder_member_id = ?, requested_by = ?, requested_at = 7 where id = ?").bind(sam.id, sam.id, copyId).run();
  expect(ok(await ledger.viewCopy(copyId, natalie)).request).toEqual({ by: { id: sam.id, name: sam.name, pictureUrl: sam.pictureUrl }, at: 7 });
});

test("a history subject renders as the placeholder, or as its linked member once linked", async () => {
  // The copy stays at home throughout (a linked placeholder must hold nothing, per the invariant).
  // Insert a 'lent' event with subject_person_id = p-sarah. The entry's subject is { kind: "person", id: "p-sarah", name: "Sarah" }.
  // Then set people.linked_member_id = kim.id. The same entry's subject is { kind: "member", person: Kim }.
});

test("a removed member renders as a tombstone, and their request counts as none", async () => {
  // Sam holds Natalie's copy and has asked to keep it; then Sam is removed (members.removed_at = 5).
  // Natalie's view: holder is { kind: "member", person: { id: sam.id, name: "Sam", pictureUrl: null, removed: true } }, request is null,
  // and actions include neither "approve" nor "decline". The history actor of Sam's 'requested' event has removed: true.
});

test("the public view carries no holder or request", async () => {
  // A copy held by p-sarah, viewed through its code with viewer null: the serialized view contains neither "Sarah" nor "p-sarah".
});
```

  - In `shelves.test.ts`: a shelf item held by a placeholder has `holder: { kind: "person", … }`.
  - In `CopyPage.test.tsx`:
    - a copy with a placeholder holder shows "With Sarah";
    - a copy with `holder: null` and an owner shows neither "With" nor "At home";
    - a copy with a `request` renders without crashing. Its controls come in Task 6.
- [ ] **Step 3: Run the tests to make sure they fail:** `pnpm test:worker src/worker/index.test.ts src/worker/ledger/ledger.test.ts src/worker/ledger/shelves.test.ts`.
- [ ] **Step 4: Change the schema and run `pnpm db:generate`.** Check that the SQL is only:
  - `CREATE TABLE people`;
  - its indexes;
  - `ALTER TABLE ... ADD` ×5;
  - one `CREATE INDEX` on copies.

  Add a top comment: `-- Adds only; old code ignores the new columns, and every row old code writes leaves them null.`
- [ ] **Step 5: Read and render.**
  - **`COPY_SELECT` and `SHELF_SELECT`** select `holder_person_id`, `requested_by` and `requested_at`, and left-join `people` for the holder name.
  - **`renderCopy`:**
    - joins the asker's member row;
    - the history query left-joins the subject member, the subject person and the person's linked member;
    - `home` stays `owner_id = holder_member_id`.
  - **`shelfItem`** uses the same holder rule. Write the rule once (`holderOf(row)`) and use it in both.
  - **Tombstones:** every join to `members` for display also selects `removed_at`, and one `personOf(row)` helper sets `removed: true` when it is not null. The view computes `request` as null when the asker is removed.
- [ ] **Step 6: Extend `invariantViolations`.** One string per violating copy, for each of these:
  - both holder columns set;
  - an owned copy with neither holder;
  - `requested_by` and `requested_at` not null together;
  - `requested_by` set on a copy with no owner, or where `requested_by <> holder_member_id` or `requested_by = owner_id`;
  - `holder_person_id` pointing at a linked person.

  Fix any fixture these flag so it models a reachable state.
- [ ] **Step 7: Client display.**
  - `CopyPage` and the shelf list render `kind: "person"` by its name.
  - Neither renders a holder line for `null`.
  - The `holder.name` fallback for `"named"` goes.
  - `historyText` is a full `Record` over `HistoryEntry["type"]`, so add the eight wordings from the Rulings now; the subject is rendered in Task 6.
- [ ] **Step 8: Run all five commands; commit** `feat: people, requests and history subjects in the schema; holders render as member, placeholder or none`.

### Task 2: The rules table

**Files:**
- Modify: `src/worker/ledger/rules.ts`, `src/shared/types.ts` (`ActionType`), `src/client/screens/CopyPage.tsx` (`actionText`, `buttons`)
- Test: `src/worker/ledger/rules.test.ts`, `src/client/screens/CopyPage.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces:

```ts
export type CopyState = {
  ownerId: string | null; ownerRemoved: boolean;
  holderMemberId: string | null; holderPersonId: string | null;
  requestedBy: string | null; requesterRemoved: boolean;
  labelled: boolean;
};
export type Target = { member: string } | { person: string };
export type Action =
  | { type: "claim" | "return" | "move" | "label" | "relabel" | "request" | "withdraw" | "approve" | "decline" | "release" | "adopt" }
  | { type: "lend"; to: Target }
  | { type: "give"; to: string };
export type EventType = "claimed" | "returned" | "labelled" | "relabelled" | "lent" | "given" | "requested" | "withdrawn" | "approved" | "declined" | "released" | "adopted";
export type Change = {
  ownerId: string | null; holderMemberId: string | null; holderPersonId: string | null; requestedBy: string | null;
  event: EventType | null; subject: Target | null; ownerChanged: boolean;
};
export function decide(state: CopyState, viewer: Member, action: Action): Change | Rejection;
export function availableActions(state: CopyState, viewer: Member, opts: { labelInHand: boolean }): ActionType[];
// ActionType adds "lend" | "give" | "request" | "withdraw" | "approve" | "decline" | "release" | "adopt".
```

- [ ] **Step 1: Write the failing tests.**
  - **Shape:** keep the existing `test.each` tables and extend them to the new state shape. `holderPersonId: null` and `requestedBy: null` unless a row says otherwise.
  - **A table for `availableActions`.** Order is as `ACTIONS` lists them: claim, return, move, label, relabel, lend, give, request, withdraw, approve, decline, release, adopt.
    - Owner at home, labelled: `["move", "relabel", "lend", "give", "release"]`.
    - Owner, lent to a placeholder: `["return", "move", "relabel", "lend", "give", "release"]`.
    - Owner at home, unlabelled: `["move", "label", "lend", "give"]`. There is no release.
    - Owner, with a request open from holder b: `["return", "move", "relabel", "lend", "give", "approve", "decline", "release"]`.
    - Holder b, not the owner, no request: `["request"]`.
    - Holder b, who asked: `["withdraw"]`.
    - A third member, book held by a placeholder: `["claim"]`.
    - Any member, copy with no owner, label in hand: `["adopt"]`. With the label not in hand: `[]`.
    - The holder of a copy with no owner: `["adopt"]` (in hand).
    - A third member, copy whose owner was removed, label in hand: `["adopt"]`. There is no claim.
    - Owner, with a request from a removed asker: no `approve` or `decline`. The holder (the removed asker) is never a viewer.
    - A new holder, after a removed asker's stale request: `["request"]`.
  - **A table for `decide`,** one row per Result column of the spec's Rules table, asserting the whole `Change`:
    - lend `{ member: "c" }` from out-with-b: holder `c`, request cleared, event `lent`, subject `{ member: "c" }`;
    - lend `{ person: "p" }`: `holderMemberId: null`, `holderPersonId: "p"`;
    - give `"c"` when home: owner and holder `c`, `ownerChanged: true`;
    - give `"c"` when out with b: owner `c`, holder `b`;
    - approve: owner is the asker, `ownerChanged: true`, subject the asker;
    - release: owner null, holder unchanged;
    - adopt: owner and holder the viewer, person null;
    - claim from a placeholder holder: holder the viewer, person null;
    - return from a placeholder holder: holder the owner, person null.
  - **Refusals, all `not-allowed`:**
    - lend to the owner;
    - lend to the current holder member;
    - lend to the current placeholder;
    - give to the owner;
    - request when one is open;
    - request by a placeholder-held copy's owner;
    - withdraw by someone not the asker;
    - approve or decline with no request;
    - release unlabelled;
    - adopt of an owned copy;
    - claim of an ownerless copy.
- [ ] **Step 2: Run to fail:** `pnpm test:worker src/worker/ledger/rules.test.ts`.
- [ ] **Step 3: Implement.**
  - `allows(state, viewer, type)` holds the "who / when" column.
    - "A request is open" means `requestedBy !== null && !requesterRemoved`.
    - "Takeable" means `ownerId === null || ownerRemoved`.
    - Claim needs an owner who is not removed.
  - `decide` calls it, then checks the target (lend: not the owner, not the current holder; give: not the owner) and builds the Change.
  - Every Change whose owner or either holder differs from the state has `requestedBy: null`.
  - `availableActions` filters `ACTIONS` by `allows`, with claim and adopt needing `labelInHand`.
- [ ] **Step 4: Fix callers to compile.**
  - In `ledger.ts`, `relabel.ts` and `unlabelled.ts`, build the new `CopyState` and pass `{ type }` objects; behaviour unchanged.
  - `CopyPage`'s `actionText` is a full `Record` over `ActionType`: add the eight button texts from Global Constraints. Exclude the eight new types from `buttons`: until Task 6 wires them, a generic button would fall through `act()` to `returnCopy`.
  - Add a `CopyPage.test.tsx` test: a copy whose `actions` lists every new type renders none of their buttons, and nothing calls `returnCopy`.
  - Run all five commands.
- [ ] **Step 5: Commit** `feat: the full rules table for lending, giving, requests, release and take`.

### Task 3: One guarded write for every action; lend, ask to keep, withdraw, decline

**Files:**
- Modify: `src/worker/ledger/ledger.ts` (`act`, `ActInput`), `src/worker/index.ts`
- Test: `src/worker/ledger/ledger.test.ts`, `src/worker/index.test.ts`

**Interfaces:**
- Consumes: `decide`, `Change`, `Target` (Task 2); the columns (Task 1).
- Produces:

```ts
export type LendTo = { member: string } | { person: string } | { name: string };
export type ActInput =
  | { type: "claim" | "adopt"; code: string }
  | { type: "return" | "request" | "withdraw" | "approve" | "decline" | "release"; copyId: string }
  | { type: "lend"; copyId: string; to: LendTo }
  | { type: "give"; copyId: string; to: string };
```

  - **Routes:**
    - `POST /api/copies/:id/lend` with `{ to: LendTo }`;
    - `POST /api/copies/:id/request`, `/withdraw` and `/decline`, each with no body.
  - All answer a `CopyView` or a rejection, as return does.

- [ ] **Step 1: Write the failing tests** in `ledger.test.ts`. Each ends with `expect(await invariantViolations(env.DB)).toEqual([])` where the file's `afterEach` does not already.
  - **"lend to a member"**:
    - the holder is Sam;
    - one `lent` event with `subject_member_id = sam`;
    - Sam's `holding` lists it.
  - **"lend to a new name makes a placeholder, and lending to 'sarah ' later reuses it"**:
    - `count("people")` is 1 after both;
    - the second lend comes after a return;
    - both events have the same `subject_person_id`.
  - **"lend to a name whose placeholder is linked lends to the linked member".**
  - **"lend to a removed member is not-allowed and changes nothing".** Set `members.removed_at`.
  - **"lend to another member's placeholder by id is not-allowed".**
  - **"ask to keep, then withdraw"**:
    - `requested_by` is set, then cleared;
    - the events are `requested` then `withdrawn`.
  - **"ask to keep, then decline":** a `declined` event with the asker as subject.
  - **"an open request is cleared when the owner lends the book elsewhere".** Review Focus 4: the asker's view has no `withdraw` and `request: null`.
  - **"an open request is cleared when a third member claims it".**
  - **"lend racing a claim: one wins".** Review Focus 1. Use `racing()` to land Sam's claim between Natalie's read and write: her lend is `not-allowed`, the holder is Sam, and there is one new event. Run it twice, once lending to a member and once to a new name; the new-name run also asserts `count("people")` is 0.
  - **"lend to a name racing the same name"**:
    - a racing insert of the same `name_key` makes the lend `not-allowed`;
    - one people row;
    - a retry succeeds onto it.
  - **"claim and return still behave as before".** The existing claim and return tests pass unchanged.
- [ ] **Step 2: In `index.test.ts`:**
  - the four routes go in `EVERY_NEW_ROUTE`;
  - a malformed `to` (missing, a number, `{ member: 5 }`, `{ name: "" }`) is 400 `invalid`;
  - a lend by a non-owner is 403.
- [ ] **Step 3: Run to fail.**
- [ ] **Step 4: Implement the write.**
  - **Shape:** one private `applyChange(row, viewer, change, extra: { code?: string; prelude?: D1PreparedStatement[]; subjectGuard?: { sql: string; binds: unknown[] } })`.
  - **Guard,** shared by both statements (fragment G):
    - `id = ?`;
    - `owner_id is ?`, `holder_member_id is ?`, `holder_person_id is ?` and `requested_by is ?`, all as read;
    - the actor `ACTIVE`;
    - the live-label guard when a code is in hand;
    - the subject guard.
  - **Statements, in order:**
    1. the prelude;
    2. `insert into events (copy_id, at, actor_id, type, subject_member_id, subject_person_id) select … where G`;
    3. `update copies set owner_id, holder_member_id, holder_person_id, requested_by, requested_at = (case when ? is null then null else coalesce(requested_at, ?) end), collection_id = … where G`.
  - **Signal:** the last statement's change count; 0 is `not-allowed`.
  - **Collection:**
    - unchanged owner: today's `coalesce(collection_id, default of owner)`;
    - an owner that changed: Task 4;
    - no owner: `null`.
  - **Subject guards:**
    - member: `exists (select 1 from members where id = ? and removed_at is null)`;
    - person: `exists (select 1 from people where id = ? and created_by = ? and linked_member_id is null)`.
  - **Claim and return** go through `applyChange`, and the old inline statements are deleted.
  - **Lend `{ name }`:**
    - clean it with `cleanPersonName`, or answer `invalid`;
    - read the owner's person by `name_key`; linked → `{ member: linked }`, unlinked → `{ person: id }`;
    - otherwise the prelude is `insert into people … select … where <the copy-state guard G> on conflict (created_by, name_key) do nothing` with a fresh `crypto.randomUUID()`, and the target is that id. The insert carries G so a refused lend leaves no placeholder behind.
- [ ] **Step 5: Routes** in `index.ts`:
  - `lend` validates the `to` shape, then calls `act`;
  - the other three call `act` with the copy id.
- [ ] **Step 6: Run all five; commit** `feat: one guarded write for every action; lend, ask to keep, withdraw and decline`.

### Task 4: Ownership moves: give, approve, release, take

**Files:**
- Modify: `src/worker/ledger/ledger.ts`, `src/worker/ledger/collections.ts` (`ensureDefault`), `src/worker/ledger/shelves.ts` (`holding`), `src/worker/ledger/unlabelled.ts` (import skip checks), `src/worker/index.ts`
- Test: `src/worker/ledger/ledger.test.ts`, `src/worker/ledger/collections.test.ts`, `src/worker/ledger/shelves.test.ts`, `src/worker/ledger/unlabelled.test.ts`, `src/worker/index.test.ts`

**Interfaces:**
- Consumes: `applyChange` and `ActInput` (Task 3).
- Produces:
  - **Routes:**
    - `POST /api/copies/:id/give` with `{ to: string }`;
    - `POST /api/copies/:id/approve`;
    - `POST /api/copies/:id/release`;
    - `POST /api/labels/:code/adopt`.
  - `holding(member)` includes ownerless copies the member holds.
  - `ensureDefault(db, ownerId, at)` never leaves an active owner without a default.

- [ ] **Step 1: Write the failing tests.**
  - **"give when home":**
    - Kim is owner and holder;
    - `collection_id` is Kim's default, created in the same batch since Kim had none (Review Focus 3);
    - a `given` event with subject Kim.
  - **"give when out":** Kim is owner, Sam still holds it, and the request is cleared.
  - **"give to a removed member is not-allowed".**
  - **"approve":**
    - the asker is owner;
    - the collection is their default;
    - an `approved` event with the asker as subject.
  - **"approve when the asker was removed meanwhile is not-allowed".**
  - **"release":**
    - owner and collection are null and the holder is unchanged;
    - the copy leaves Natalie's shelf;
    - it appears in Natalie's `holding` when it was home.
  - **"release of an unlabelled copy is not-allowed".**
  - **"take a released copy by its label":**
    - owner and holder are the taker, in their default collection;
    - an `adopted` event;
    - it works for the current holder too.
  - **"take through a retired label is not-found".**
  - **"take a removed owner's copy":**
    - Natalie is removed;
    - Sam takes it by its label: he is owner and holder, in his default collection, with an `adopted` event;
    - claiming it instead is `not-allowed`;
    - a take that races Natalie being restored (`removed_at = null` between read and write) is `not-allowed`.
  - **In `collections.test.ts`:** "ensureDefault names the default 'Home library 2' when a non-default 'Home library' exists". Also "…'Home library 3'" when both exist. Set these up by SQL.
  - **In `unlabelled.test.ts`:** "re-importing skips a book the importer gave away, had approved away, or released". Three rows, one per event type; `skipped: 3`, and no new copies.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement.**
  - **`applyChange` when `change.ownerChanged`:**
    - the prelude is `ensureDefault(db, newOwner, at)` (plus the `people` insert, if any);
    - the update sets `collection_id = DEFAULT_OF(newOwner)`;
    - G adds `exists DEFAULT_OF(newOwner)` and the new owner `ACTIVE`.
  - **Release** sets `collection_id = null`.
  - **Take** reads the copy by its live label, as claim does. When the owner was not null, G adds `exists (select 1 from members where id = <owner as read> and removed_at is not null)`.
  - **Reading state for `decide`:** `ownerRemoved` and `requesterRemoved` come from the same read as the copy row.
  - **`ensureDefault`'s insert** picks the first free name among "Home library", "Home library 2", "Home library 3", … in SQL, so there's no read-then-write. A recursive CTE or a bounded `case` over the existing `name_key`s both work.
  - **`holding`:** `where c.holder_member_id = ? and (c.owner_id is null or c.owner_id <> ?)`.
  - **Import:** the "already have it" checks (the batch pre-read and the in-write `not exists` guards) also count a book whose copy has a `given`, `approved` or `released` event with `actor_id` = the importer.
- [ ] **Step 4: Routes,** with `give` validating `to` as a string.
- [ ] **Step 5: Run all five; commit** `feat: give, approve, release and take; a transfer never leaves an owner without a default`.

### Task 5: People and requests: list, rename, link

**Files:**
- Create: `src/worker/ledger/people.ts`, `src/worker/ledger/people.test.ts`
- Modify: `src/worker/ledger/ledger.ts` (spread `createPeople`), `src/shared/types.ts`, `src/worker/index.ts`
- Test: `src/worker/index.test.ts`

**Interfaces:**
- Consumes: the `people` table (Task 1); `SHELF_SELECT` and `shelfItem` (`shelves.ts`).
- Produces:

```ts
export type PersonSummary = { id: string; name: string; linked: Person | null; holding: ShelfItem[] };
export type RequestItem = { copyId: string; book: BookInfo; by: Person; at: number };
// Ledger:
people(member: Member): Promise<PersonSummary[]>;            // the member's own, by name
renamePerson(member: Member, personId: string, name: string): Promise<PersonSummary | Rejection>;
linkPerson(member: Member, personId: string, memberId: string): Promise<PersonSummary | Rejection>;
requests(member: Member): Promise<RequestItem[]>;            // open requests on copies the member owns, newest first
```

  - **Routes:**
    - `GET /api/people` → `{ people: PersonSummary[] }`;
    - `POST /api/people/:id/rename` with `{ name }`;
    - `POST /api/people/:id/link` with `{ member }`;
    - `GET /api/requests` → `{ requests: RequestItem[] }`.

- [ ] **Step 1: Write the failing tests** in `people.test.ts`.
  - **"people lists only the member's own placeholders, with what each holds".** Kim's placeholder never appears in Natalie's list.
  - **"rename":**
    - another member's placeholder → `not-found`;
    - a clash with one's own other placeholder → `name-taken`;
    - an invalid name → `invalid`.
  - **"link moves every copy the placeholder holds to the member, whoever owns it".**
    - Review Focus 5: Natalie lends to Sarah, then gives the book to James (use `kim` for James). Natalie links Sarah to Sam.
    - The copy is owned by Kim and held by Sam, and Kim's view shows Sam.
    - The `lent` event's subject now renders as Sam.
    - No event is written by linking.
  - **"link refuses":** all `not-allowed`, changing nothing:
    - linking twice;
    - linking to a removed member;
    - linking to oneself;
    - linking another member's placeholder.
  - **"requests lists open requests on my copies, newest first, and nothing once answered".** A removed asker's request is not listed.
  - **In `index.test.ts`:** the four routes go in `EVERY_NEW_ROUTE`, and a malformed body is 400.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement.**
  - **`linkPerson`** is one batch whose two statements share a guard. The guard checks that the person exists with `created_by = member` and `linked_member_id is null`, that the target is `ACTIVE`, and that the target is not the member.
    1. `update copies set holder_member_id = ?, holder_person_id = null where holder_person_id = ? and <guard>`;
    2. `update people set linked_member_id = ?, linked_at = ? where id = ? and <guard>`.

    The second statement's change count is the signal.
  - **`people`** is two reads in one batch: the member's people, then `SHELF_SELECT` joined to `people p on p.id = c.holder_person_id where p.created_by = ?`, grouped by person. It does not bind an `in (…)` list: D1 allows 100 bound parameters.
- [ ] **Step 4: Routes. Run all five; commit** `feat: people (list, rename, link) and open requests`.

### Task 6: Copy page: lend, give, requests, release, take

**Files:**
- Create: `src/client/screens/LendBox.tsx`, `src/client/screens/LendBox.test.tsx`
- Modify: `src/client/api.ts`, `src/client/screens/CopyPage.tsx`
- Test: `src/client/screens/CopyPage.test.tsx`, `src/client/api.test.ts`

**Interfaces:**
- Consumes: the routes of Tasks 3–5; `listMembers` (`/api/members`); `PersonSummary`.
- Produces, in `api.ts`:
  - `lendCopy(copyId, to: LendTo)`, `giveCopy(copyId, memberId)`;
  - `requestCopy(copyId)`, `withdrawRequest(copyId)`, `approveRequest(copyId)`, `declineRequest(copyId)`;
  - `releaseCopy(copyId)`, `adoptCopy(code)`;
  - `listPeople()`, `renamePerson(id, name)`, `linkPerson(id, memberId)`, `listRequests()`.
  - `LendTo` moves to `src/shared/types.ts`.
- `LendBox({ ownerId, onLend: (to: LendTo) => void, busy })`.

- [ ] **Step 1: Write the failing tests.**
  - **`LendBox`:**
    - typing "sa" lists Sam (a member) and Sarah (an unlinked placeholder), but not linked placeholders and not the owner;
    - it shows `Lend to "sa"` when nothing matches exactly, ignoring case;
    - picking each calls `onLend` with `{ member }`, `{ person }` or `{ name }`;
    - a failed suggestions load still allows typing a name.
  - **`CopyPage`:**
    - Lend → `lendCopy` → the new view;
    - Give opens a member list, then "Give Dune to Kim?", then `giveCopy`;
    - Release shows the release confirm, then `releaseCopy`;
    - a request shows "Sam asked to keep this" with Approve and Decline for the owner, and Withdraw for the asker;
    - "Ask to keep this" calls `requestCopy`;
    - an ownerless copy reached by a code shows "No one owns this book." and "Take this book", which calls `adoptCopy(code)`. By id it shows the line and no button;
    - a history entry with a subject reads "Natalie lent this to Sarah";
    - a person with `removed: true` reads "Sam (no longer a member)" as owner, holder, history actor and subject. Do this in `Name`, once;
    - a removed owner's copy reached by a code shows "Owned by Natalie (no longer a member)" and "Take this book";
    - a 403 `not-allowed` on any of these shows the existing "That's already changed…" notice and reloads;
    - a 401 drops to sign-in, as act does.
  - **`api.test.ts`:** each new function's method, path and body.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement.**
  - Each new action is a button or control rendered only when `copy.actions` includes it.
  - Give, Release and Lend have their own controls, as move does.
  - The plain buttons (request, withdraw, approve, decline) go through the existing `act` path, extended by type.
  - Inline confirm steps, no `window.confirm`.
  - `actionText` and `historyText` gain the Global Constraints wording. A subject renders through `Name`.
- [ ] **Step 4: Run all five; commit** `feat: copy page lends, gives, answers requests, releases and takes`.

### Task 7: My collection's requests, holding's released books, the People page

**Files:**
- Create: `src/client/screens/People.tsx`, `src/client/screens/People.test.tsx`
- Modify: `src/client/route.ts`, `src/client/App.tsx`, `src/client/screens/Home.tsx`, `src/client/screens/Mine.tsx`, `src/client/screens/Holding.tsx`
- Test: `src/client/screens/Mine.test.tsx`, `src/client/screens/Holding.test.tsx`, `src/client/route.test.ts`

**Interfaces:**
- Consumes: `listRequests`, `approveRequest`, `declineRequest`, `listPeople`, `renamePerson`, `linkPerson`, `listMembers`.
- Produces: the route `{ name: "people" }` at `/people`.

- [ ] **Step 1: Write the failing tests.**
  - **Mine** shows open requests above "My books": each is the book title linked to `/copies/<id>`, "<name> asked to keep this", Approve and Decline. Answering one reloads the list. A failed requests load hides the section and leaves the shelves.
  - **Holding** shows an ownerless copy with "No owner".
  - **People:**
    - lists placeholders with what each holds;
    - Rename (with `name-taken` → "You already have someone called that.");
    - Link: a member list, then "Link Sarah to Sam? The books Sarah has will show as theirs.", then `linkPerson`. A linked person shows "Linked to Sam" and no Link button;
    - signed out shows sign-in.
  - **Route:** `/people` and `/people/` match `{ name: "people" }`.
  - **Home** has a "People" button after "Friends' shelves".
- [ ] **Step 2: Run to fail; implement; run all five.**
- [ ] **Step 3: Update `docs/ROADMAP.md`.**
  - Step 3 is released as v0.3.0, and step 4's first release as v0.4.0.
  - Step 4's second release is built, not yet released.
  - Mark done the carry-overs this release closes (the spec's "Carry-overs this release closes"), and keep the relabel carry-over.
- [ ] **Step 4: Commit** `feat: requests on my collection, released books on holding, and the People page`.

## Release notes (for the PR body)

- **Before deploying,** run this read-only pre-check; expect 0. The new invariant requires every owned copy to have a holder, and old data must already meet it:
  ```sql
  select count(*) from copies where owner_id is not null and holder_member_id is null
  ```
- **The tag's deploy job** applies the migration, then deploys.
- **Rollback is unsafe once any book is lent to a placeholder, given, released or taken.** Old code reads a placeholder holder as "held by nobody", and an ownerless copy has no actions.
- **Reload open tabs.** Old pages expect `holder` never to be null.
