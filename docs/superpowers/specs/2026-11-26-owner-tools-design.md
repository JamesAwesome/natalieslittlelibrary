# Owner tools: lend, give, ask to keep, release and take

Drafted 2026-11-26 from the maintainer's answers. It is the second of two releases for
roadmap step 4 ("Owner tools"); the first, label tools
(`2026-11-26-label-tools-design.md`), is live as v0.4.0. It extends the main
spec, `docs/superpowers/specs/2026-11-16-little-library-design.md`, whose
"Flows" and "Who may do what" sections already fix most rules here. Calls made
without the maintainer are marked **(call)**.

## Why

Natalie lends books out and forgets who she lent them to. The app records a
handoff only when the borrower scans the label and claims it, and a borrower
who doesn't bother leaves no trace. Many of her friends are not members, and
for them nothing can be recorded at all.

So the heart of this release is Natalie recording a loan herself, at the
moment she hands the book over, to anyone. Giving, asking to keep, releasing
and taking a released book complete the ownership half of the main spec.

## What the maintainer decided

- The owner can record a loan herself, to a member or to a person with no
  account.
- Lending to a member makes them the holder, as if they had scanned it.
- Claiming keeps working whoever holds the book: a friend who has it passed
  on, or a book Natalie forgot to record, is claimed by whoever scans it.
- People with no account are **linkable placeholders**: a typed name becomes a
  saved person, and when that friend later joins, the placeholder is linked to
  their account and what they hold moves over.
- Placeholders are built as their own kind of person (approach 1 below), not
  as members who cannot sign in.
- The proposals played back were accepted as a whole: giving with no accept step, asking to keep with approve, decline
  and withdraw, open requests shown on her collection, release and take, and
  the placeholder rules below.

## Goals

- **Lend.** From a copy page, the owner taps "Lend" and picks or types who:
  - a member, who becomes the holder and sees it on their holding list;
  - one of the owner's placeholders, who becomes the holder;
  - a new name, which becomes a new placeholder and the holder.
  The box suggests the owner's own placeholders and the active members as the
  owner types. History gets "Natalie lent this to Sarah". "Mark returned"
  brings it home, as now.
- **Give to a member.** The owner picks a member; the copy is theirs at once,
  with no accepting step. It goes into the new owner's default collection. If
  the copy was home with the old owner, the new owner becomes the holder;
  otherwise whoever holds it still does.
- **Ask to keep.** A member holding someone else's copy taps "Ask to keep
  this". The owner sees open requests at the top of their collection page and
  on the copy page, with Approve and Decline. The asker can withdraw. Approve
  makes the asker the owner (they already hold it). A request is cancelled
  whenever the copy's owner or holder changes any other way.
- **Release.** The owner releases a copy: it has no owner and leaves their
  collection. It keeps its label and history. The holder does not change: if
  it was home, the former owner is still recorded as holding it.
- **Take a released book.** Any member who scans a released copy's label can
  tap "Take this book" and becomes its owner and holder, including whoever is
  holding it. This is the main spec's "adopt".
- **Tombstones for removed members.** Removing a member keeps their row
  (`removed_at`), so their name stays in history; this release makes that
  visible and unsticks their books (a removed user needs a tombstone, and
  their books become takeable).
  - Wherever a removed member is named (owner, holder, history, a request, a
    linked placeholder), they show as "Sam (no longer a member)".
  - A copy whose owner was removed can be taken like a released one: any
    active member who scans its label taps "Take this book" and becomes owner
    and holder. Claim is not offered on it.
  - A request by a removed member counts as no request: it is not shown, it
    cannot be approved, and the next write to the copy clears it **(call:
    removal is done by hand in the database today, so there is no removal
    write to clear it in)**.
- **Placeholders.**
  - Each member has their own placeholders. Natalie's "Sarah" is hers; if
    the maintainer lends to the same Sarah, they make their own **(call: nobody's list of
    non-members is shown to anyone else)**.
  - A placeholder is made the first time a name is typed in Lend. Names are
    matched without regard to case, so "sarah" finds "Sarah".
  - A "People" page lists the member's placeholders, what each holds, and
    "Link to a member" and "Rename".
  - Only the member who made a placeholder links it **(call: anyone could
    claim to be "Sarah")**. Linking makes every copy the placeholder holds,
    whoever owns it, held by that member instead, in one write. A linked
    placeholder stays linked and is no longer suggested in Lend; the member
    is suggested instead.
  - History is never rewritten. An entry about a placeholder shows the linked
    member's name once linked.

## Non-goals

- Merging two placeholders ("Sarah" and "sarah" made before this release
  matched names, or "Sarah" and "Sarah K"). Rename covers a typo.
- Notifications of any kind. Requests are seen by visiting.
- "Free to claim" collections (step 3's "For later").
- Due dates, borrow requests, removing a copy.
- A placeholder that can sign in, or a member linking a placeholder to
  themselves.
- A screen for removing a member (removal stays a database edit).

## Anti-goals

- A placeholder's name shown to a non-member, or a member's placeholder list
  shown to another member. A copy's holder name is shown to members, as every
  holder name is today.
- History edited or deleted, by linking or anything else.
- A copy left with an owner but no collection, or a collection but no owner.
- A schema change that rebuilds a table. Only added tables and nullable
  columns (D1 cannot turn foreign keys off).

## Approaches

1. **Placeholders as their own kind of person (chosen).** A new `people`
   table; a copy's holder is a member or a placeholder. Contained, tested in
   one place; every reader of "holder" learns a third case.
2. **Placeholders as members who cannot sign in.** Existing "a member holds
   it" code works unchanged, but every member list (Lend, shelves, sign-in,
   admin) must filter them out, and a missed filter leaks Natalie's private
   names. Linking becomes merging two members, and history would need
   rewriting or an alias layer. Rejected for the leak risk.

Requests: stored on the copy (who asked, when) rather than in a table of their
own **(call: the spec allows one open request per copy, and the write that
changes owner or holder clears it in the same statement, so cancellation
cannot be forgotten; the request's whole story is in history)**.

## Design

### Data

All added; nothing rebuilt.

- `people`: `id`, `created_by` (member), `name`, `name_key` (lowercased,
  trimmed), `linked_member_id` (nullable), `created_at`, `linked_at`
  (nullable). Unique on (`created_by`, `name_key`).
- `copies.holder_person_id`, nullable, references `people`. At most one of
  `holder_member_id` and `holder_person_id` is set. A copy with an owner
  always has one of them.
- `copies.requested_by` (member, nullable) and `copies.requested_at`
  (nullable): the open request, if any. Set together or not at all.
- `events.subject_member_id` and `events.subject_person_id`, nullable: the
  other person in an event ("lent to", "gave to").
- New event types: `lent`, `given`, `requested`, `withdrawn`, `approved`,
  `declined`, `released`, `adopted`. Linking writes no event.
- `test/invariant.ts` gains: at most one holder column set; an owned copy has
  a holder; `requested_by` is set only on an owned copy whose holder is that
  member and who is not the owner; `owner_id` and `collection_id` are null
  together.

### Rules

`decide()` in `rules.ts` stays the one place that says who may do what. Its
state gains the holder person and the open request; its result gains the new
owner, the subject, and whether the request is cleared.

| Action | Who | When | Result |
|---|---|---|---|
| Lend | owner | the chosen person is not already the holder and is not the owner | holder is the member or placeholder; request cleared |
| Give | owner | the recipient is another active member | owner and collection are the recipient's, holder too if it was home; request cleared |
| Ask to keep | the holder, a member, not the owner | the copy has an owner and no open request | request set |
| Withdraw | the asker | their request is open | request cleared |
| Approve | owner | a request is open | owner and collection are the asker's; request cleared |
| Decline | owner | a request is open | request cleared |
| Release | owner | the copy has a label **(call: a released copy is taken by scanning its label, so an unlabelled one could never be taken, labelled or returned again)** | owner and collection null; holder unchanged; request cleared |
| Take (adopt) | any active member, label in hand | the copy has no owner, or its owner was removed | owner, holder and collection are theirs; request cleared |
| Claim | unchanged: any member neither holder nor owner, label in hand | the copy has an owner who is not removed | holder is the claimer (a placeholder holder is replaced); request cleared |
| Mark returned | unchanged: owner, when someone else holds it, member or placeholder | | holder is the owner; request cleared |

Every write that changes owner or holder clears the request in the same
statement. Every write is one batch guarded on the whole state it was decided
against (owner, both holder columns, request, and, for claim and take, the
label), as claim and return are today; a changed copy yields `not-allowed`.

Give, approve and take put the copy in the new owner's default collection and
set `owner_id` and `collection_id` in one statement, with `ensureDefault` for
the new owner earlier in the same batch. Release nulls both.
**(call: if the new owner has no default and a non-default collection already
uses the default name, the default gets the next free name, "Home library 2",
so a transfer never leaves an owner without a default; today's `on conflict do
nothing` would.)**

A removed member cannot be lent to, given to, or be the asker of an approved
request; the write refuses with `not-allowed`.

### Ledger

- `act(copy, viewer, action)` takes the new actions. Lend carries
  `{ to: { member: id } | { person: id } | { name: string } }`; a name that
  matches one of the owner's placeholders uses it (or its linked member, once
  linked), otherwise one is made in the same batch. Give carries `{ to: memberId }`. Take carries the label
  code, as claim does.
- `people(member)`: the member's placeholders, each with what it holds and its
  link.
- `renamePerson(member, personId, name)` and `linkPerson(member, personId,
  memberId)`, both creator-only. A rename that clashes with another of their
  placeholders is `name-taken`. Linking a placeholder that is already linked,
  or to a removed member, is `not-allowed`.
- `requests(member)`: open requests on copies the member owns, newest first.
- `holding(member)` also lists ownerless copies the member holds
  **(call: a released book at home would otherwise be on no list at all)**.
- The StoryGraph import's "already have it" check also skips books the member
  gave away, had approved away, or released (their `given`, `approved` or
  `released` events) **(call: until now a copy never left its owner, so a
  re-import of an export that still says "owned" would quietly bring those
  books back; a book bought again is added by scanning, as any new book is)**.
- `CopyView.holder` gains `{ kind: "person"; id; name }`, the name being the
  linked member's when linked (then it is `kind: "member"`). The `""` named
  holder goes. `CopyView` gains `request: { by: Person; at } | null`.
  `HistoryEntry` gains the new types and an optional `subject`. `Person`
  gains `removed?: true`, set only for a removed member, so every place that
  shows a person can show the tombstone.

### Routes

All member-only, behind the existing same-site and member guards.

- `POST /api/copies/:id/lend` `{ to }`, `/give` `{ to }`, `/request`,
  `/withdraw`, `/approve`, `/decline`, `/release`.
- `POST /api/labels/:code/adopt`, like claim.
- `GET /api/people`, `POST /api/people/:id/rename` `{ name }`,
  `POST /api/people/:id/link` `{ member }`.
- `GET /api/requests`.

### Client

- **Copy page:** the actions the view returns, as now. "Lend" opens a name box
  with suggestions: the owner's unlinked placeholders and active members
  other than the owner, and "Lend to "<typed>"" when nothing matches exactly.
  "Give" opens a member list and confirms "Give <title> to <name>?". "Release"
  confirms "Release <title>? It leaves your collection and anyone who scans it
  can take it." An open request shows "<name> asked to keep this" with
  Approve and Decline for the owner, and Withdraw for the asker.
- **My collection:** open requests at the top, each with Approve and Decline.
  Copies with a placeholder holder show "With Sarah".
- **People page:** in the menu. Placeholders, what each holds, Rename, and
  Link to a member (a member list, then "Link Sarah to <member>? The books
  Sarah has will show as theirs.").
- **A released copy's page:** "No one owns this book." with "Take this book"
  when the label was read. A removed owner's copy shows "Owned by Sam (no
  longer a member)" with the same button.
- **Tombstone:** a person with `removed` renders as "<name> (no longer a
  member)" everywhere `Name` is used.

## Carry-overs this release closes

- Give, take and approve set owner and collection together with
  `ensureDefault` in the batch; release nulls both (step 3).
- The `ensureDefault` name clash (step 3), per the call above.
- A copy with no member holder renders as held by "" (step 2).
- The claim guard SQL is generalized rather than copied for eight more actions
  (step 2).
- Label retirement: no new writer retires a label, so the relabel carry-over
  still holds and stays in the roadmap.

## Left to the builder

- Where the People page sits in the menu, and its wording.
- The order and grouping of the owner's buttons on a copy page.
- How the Lend suggestions are fetched (one call or two).
- History wording beyond the examples here.

## Done when

Each action has been done once with a real book, including a loan to a
placeholder who then joins and is linked.
