# Collections: a member's books in named places

Drafted 2026-11-25 from James's answers. A builder check and an adversarial
review (Codex) were folded in the same day. It belongs to roadmap step 3
("Collections") and extends the main spec,
`docs/superpowers/specs/2026-11-16-little-library-design.md`. Calls made
without James are marked **(call)**.

## Why

A person's books live in more than one place: James's examples are a
"personal library", a "beach house library" and a "classroom library". Today a
member's collection is simply every copy they own, so the app cannot say where
a book that is at home actually is, or show a place's shelf on its own.

## What James decided

- A collection is a named place where some of one member's books live.
- **One owner per collection.** Collections are never shared now.
- Borrowers are still friends with accounts; nothing new for classrooms.
  Loans to people without accounts stay in step 4, as planned.
- **Later, not now, but the shape must allow them:**
  - transferring a whole collection to another member, or merging two
    collections, as a single step;
  - roles on a collection, such as a "collection steward";
  - per-collection settings, such as "books free to claim" for a
    take-a-book-leave-a-book library.
- **Approach 1** (below).

## Goals

- Every owned copy is in exactly one collection, which belongs to the copy's
  owner.
- A member can create, rename and delete (when empty) their own collections,
  and move their books between them.
- Pairing a book, and the StoryGraph import, ask which collection the books go
  in **(call: the import takes one target collection for the whole run)**.
- When a book is at home, its page says which collection it is at. "Mark as
  returned" puts it back in its collection: lending never changes a copy's
  collection.
- Natalie's overview (step 3) groups her books by collection, showing who
  holds each one.
- Nothing changes for a member who never creates a second collection.

## Non-goals (now)

- Shared collections, roles, stewards, collection settings, whole-collection
  transfer or merge.
- Sub-collections and tags. A book is in one place.
- Ordering books within a collection.
- A history entry for moving a book between one's own collections **(call:
  shelf-keeping, not lending)**.

## Anti-goals

- Re-shaping today's lending rules for this change. `decide()` stays the one
  place that says who may do what, and keeps reading `owner_id`. (Roles and
  "free to claim" will change rules when they are built: see "For later".)
- Telling non-members where books live. The public label page shows no
  collection name and no other new information **(call)**.
- A future feature that needs a table rebuild. D1 cannot run
  `PRAGMA foreign_keys=OFF`, so a rebuild fails once tables have rows. Every
  later change must be an added table or an added nullable or defaulted
  column.

## Approaches

1. **Chosen: a collections table and `copies.collection_id`, with the owner
   still stored on the copy.**
   - Today's rules stay untouched.
   - The cost is one invariant the ledger must keep on every write.
   - A later whole-collection transfer is one batch.
2. **The collection owns the copy.**
   - Transfer becomes one update.
   - But every rule would be rewritten to read the owner through the
     collection.
   - `copies.owner_id` cannot be dropped from a table with rows, so it would
     linger.
3. **Tags (many-to-many).** Rejected: a book is in one place.

## Design

### Data

The migration only adds things. Codex ran its shape on a seeded SQLite
database, with foreign keys on, and it needed no rebuild.

- New table `collections`:

  | Column | Definition |
  | --- | --- |
  | `id` | text, primary key |
  | `owner_id` | text, not null, references `members` |
  | `name` | text, not null |
  | `name_key` | text, not null |
  | `is_default` | integer, not null, default 0 |
  | `created_at` | integer, not null |

- Indexes:
  - unique `(owner_id, name_key)`: names are unique per owner;
  - partial unique `(owner_id) where is_default = 1`: at most one default
    per owner.
- `copies` gains `collection_id`, text, nullable, referencing `collections`,
  with an index.
- The migration:
  1. creates a default collection named "Home library" for every member who
     owns at least one copy;
  2. sets `collection_id` on every owned copy to its owner's default.

  It is written in the migration SQL, Drizzle's schema and snapshot are kept
  in step with it, and it is tested on a seeded database.

### Names (call)

- Trimmed, then 1 to 60 code points, counted on the server.
- Control and bidi-override characters are refused.
- `name_key` is the NFC-normalised name, lower-cased with JavaScript's
  Unicode `toLowerCase`, so "École" and "école" clash. SQLite's `lower()`
  folds only ASCII.
- Renaming a collection to a case-only variant of its own name succeeds.
- Names are always displayed inside `<bdi>`.

### The invariant

The ledger is the only writer of `copies` and `collections`. It keeps this
invariant:

- `owner_id` is null exactly when `collection_id` is null.
- When they are not null, the owner of `collection_id` is `owner_id`.
- Every member who owns a copy has exactly one default collection.

How it holds:

- **Every write is guarded on the state it read**, as today.
  - A write that places a copy in a collection selects the destination in
    the same statement, e.g. `… where exists (select 1 from collections where
    id = :c and owner_id = :actor)`. Ownership is checked inside the write,
    not only before it.
  - A write that changes a copy's owner sets both columns in that same
    statement.
  - Results are checked with `meta.changes`, and a write that changed nothing
    becomes a Rejection.
- **A default exists before anything needs it.**
  - Every path that gives a member a copy first runs a conditional "create my
    default if I have none" insert in the same batch: add, adopt, and in step
    4 give and approve-request.
  - The copy write then selects the persisted default row. It never uses the
    id the request proposed, because a concurrent request may have won.
  - A member's first collection, however it is made, is their default.
- **Switching the default** runs in one batch:
  1. Clear the old default, guarded on the new one existing and belonging to
     the actor.
  2. Set the new one, guarded on that member having no default left.
  3. Check both results; if either changed nothing, the batch is refused.
- **Deleting** is one guarded statement: the collection must be the actor's,
  not the default, and no copy may reference it (`not exists`). Lent-out and
  unlabelled copies count as in it.
- **Rolling out.** For the seconds between the migration and the new Worker,
  the old Worker can add a copy with a null `collection_id`. Reads treat an
  owned copy with a null collection as being in its owner's default, and the
  next ledger write to it sets the column. A later migration backfills any
  that remain.
- A test-only query asserts the invariant over the whole database after the
  ledger tests. The concurrency tests use the existing racing and gated
  helpers.

### Ledger additions

Each refusal is a `Rejection`, as today.

- `add(...)` takes an optional `collectionId`, which must be one of the
  actor's own. Without one, the copy goes into the default.
- `createCollection(member, name)`, `renameCollection(member, id, name)`,
  `deleteCollection(member, id)` and `makeDefault(member, id)`.
  - A clash is refused with a new reason, `name-taken`.
  - A missing or someone else's collection is refused with `not-found`.
- `moveCopy(member, copyId, collectionId)`: only the owner, only into their
  own collections. The holder and history are untouched.
- Release (step 4) nulls both columns. Adopt, give and approve-request (step
  4) put the copy into the new owner's default.

### Views and routes

- `CopyView.collection` is `{ id, name } | null`, filled for member viewers
  on any copy, whether it is home or out **(call: friends may see where a
  friend's book lives; the public view has none)**.
  - Owner line: "Owned by Natalie · Beach house library".
  - At home: "At home".
- `GET /api/collections/mine`: the viewer's collections, each with its count
  of owned copies, lent-out and unlabelled included.
- `GET /api/collections/:id`: one collection's shelf.
  - It is member-only, and lists only member-visible fields.
  - It is built by its own serializer, never `renderCopy()`, and never
    includes a label code: a code is the proof of having the book in hand.
  - Tests assert no `code` anywhere in the nested JSON.
- `POST`, `PATCH` and `DELETE` routes for collections and moves, with the
  existing same-site and member guards.
- The main spec's `collection(member, viewer)` interface becomes these two
  reads **(call)**.

### Pairing and import

- The label step has a "Collection" picker with "New collection…".
- The last pick is remembered in `localStorage` under a key that includes
  the member's id.
  - It is validated against `/mine` before use. If it is stale or someone
    else's, the picker falls back to the default with a one-line notice.
  - A save refused as `not-found` refreshes the list and asks again.
- The StoryGraph import takes one target collection for the whole run, using
  the same guarded add.

### Removed members (call)

- A removed member's collections and copies keep their owner, and their
  history is kept.
- No one can manage them until an admin tool exists (step 4 owner tools or
  later), which is the same as for their copies today.
- Writes check that the actor is not removed.

## For later: shape recorded now, not built

These keep to "added tables or columns". Some **will** change rules in
`decide()`, and that is expected.

- **Whole-collection transfer** to member B. One batch, with every statement
  guarded on the same prior state: the collection's owner is still A, and B
  is an active member.
  1. Ensure B has a default.
  2. Update the copies (owner, and the holder where it was at home with A).
  3. Update the collection's owner.
  4. Check every statement's `meta.changes`.

  Policy, decided now so the shape fits:
  - A transferred default stops being a default.
  - If A has no other collection, A is left with none, which is allowed
    because A then owns no copies.
  - A name clash at B is refused with `name-taken`.
- **Merge** within one owner: move the copies, then delete the source. The
  default cannot be the source.
- **Roles**: a later `collection_roles(collection_id, member_id, role)` table.
  A steward's return must set the holder to the owner rather than to the
  actor, so `decide()`'s results change when roles land.
- **Settings**: each is an added column on `collections` with a safe default,
  e.g. `free_to_claim integer not null default 0`; there is no JSON blob.
  "Free to claim" will change `claim`'s meaning, and its rules are undecided:
  - Does claiming move ownership, or only the holder?
  - Can a non-owner leave a book in the collection?
  - If books there can be ownerless, the first invariant needs an explicit
    exception for that collection.

## Left to the builder

- The exact copy and layout of the picker and the step 3 overview and shelf
  screens.
- The default name, if "Home library" reads oddly.
