# Label Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Make labels" prints at once, past sheets can be printed again, the owner sees a copy's label code, and an owner can replace a label.

**Architecture:** Two nullable columns on `labels` (`sheet_id`, `retired_at`) and a partial unique index keep "one live label per copy". Two new ledger modules, `sheets.ts` (reads) and `relabel.ts` (the replace write), sit beside `unlabelled.ts` and are spread into the ledger the same way. The client changes are the labels page, the copy page and a replace mode in pairing.

**Tech Stack:** Hono Worker, D1 via Drizzle (drizzle-kit migrations), React 19, Vitest (worker pool and jsdom), pnpm.

**Spec:** `docs/superpowers/specs/2026-11-26-label-tools-design.md`

## Global Constraints

- Schema changes add nullable columns and indexes only; no table rebuild (D1 cannot turn foreign keys off).
- A label code is shown only to its minter while blank, or to the copy's current owner once bound. Shelves, holding and candidates never carry a code.
- A re-printed label carries the same code; re-printing writes nothing.
- A retired label's page says "This label has been replaced." and nothing about the book; claim through it is refused.
- Every state-changing write is one guarded batch whose guards are re-checked inside the statements; a refused write changes no row.
- Copy is as the spec fixes it: "Make labels", "Print", "Print again", "Also print labels already on my books", "Replace label", "Replace the label on <title>?", "This label has been replaced."
- Commands: `pnpm test:worker <file>`, `pnpm test:client <file>`, `pnpm typecheck`, `pnpm lint`, `pnpm db:check`. All five pass before each commit.
- No deploy, `--remote`, `wrangler login` or `secret put` by any agent.

## Rulings made writing this plan

The first two are also written into the spec, which was amended in the same commit as this plan.

- **Sheet grouping is computed when read, not backfilled.** Reads group by `coalesce(sheet_id, 'old-' || minted_by || '-' || (minted_at / 1000))` (the `SHEET_KEY` constant). It matches the spec's "one sheet per member and minted second". It also catches labels that old code mints in the gap between applying the migration and deploying, which a backfill would miss.
- **The sheet-codes route answers `{ labels: { code, url }[] }`**, the shape `POST /api/labels` already answers, so the sheet renders both the same way.
- **A copy view carries the code it was reached by, not the joined row's code.** `renderCopy` takes the code in hand (carry-over from step 2), so a replace landing mid-read cannot hand a non-owner the new code.
- **Replacing is a rule, `"relabel"`, in `rules.ts`.** It is offered to the owner of a labelled copy. The button and the write come from the one place, as for every other action.
- **The owner's code shows as `Label <code>`** in a `.label-code` paragraph under the book.
- **The past-sheets row reads `<date> · <total> labels, <blank> blank, <mine> on your books`**, with the date from `toLocaleDateString()`.

## Review Focus

1. **A stale replace.** Replace was read against label A, but A has already been replaced. The second replace is refused (`not-allowed`): its new label stays blank, and the copy keeps one live label. (Task 3)
2. **Scanning the copy's own label as the new one.** This is refused `label-in-use`, and nothing changes. (Task 3)
3. **Claim racing a replace.** A claim through the old code that lands after the replace is refused, and the holder is unchanged. (Task 3)
4. **Print again after a failed partial run.** A later "Make labels" starts a fresh run. It must not resume onto the re-printed labels. (Task 4)
5. **A sheet with nothing left to print** (the checkbox off and every label used). It says so and does not open the print dialog. (Task 4)

---

### Task 1: Labels carry a sheet and can be retired

**Files:**
- Modify: `src/worker/db/schema.ts:101-113`
- Create: `drizzle/<generated>/migration.sql` (by `pnpm db:generate`, not by hand)
- Modify: `src/worker/ledger/ledger.ts:63-66` (COPY_SELECT), `:96-116` (mintLabels), `:118-125` (view), `:129-199` (renderCopy), `:366-369` (claim guard)
- Modify: `src/worker/ledger/unlabelled.ts:79,283-317` (the render callback carries the bound code)
- Modify: `src/shared/types.ts:35-39` (LabelView)
- Test: `src/worker/index.test.ts:115-130` (schema pin), `src/worker/ledger/ledger.test.ts`

**Interfaces:**
- Produces:
  - the columns `labels.sheet_id text` and `labels.retired_at integer`, both nullable;
  - the index `labels_one_live_per_copy`, unique on `copy_id` where `retired_at is null and copy_id is not null`;
  - `LabelView` gains `{ kind: "retired" }`;
  - `COPY_SELECT` joins only the live label (`left join labels l on l.copy_id = c.id and l.retired_at is null`).
- Consumes: nothing new.

- [ ] **Step 1: Update the schema pin in `index.test.ts`.** In the labels entry:
  - columns: append `["sheet_id", "TEXT", 0, 0]` and `["retired_at", "INTEGER", 0, 0]`;
  - indexes: add `["labels_one_live_per_copy", 1, "c", 1, ["copy_id"]]`, sorted by name with the others.
- [ ] **Step 2: Write the failing ledger tests** in `ledger.test.ts`.

```ts
test("one mint is one sheet: every label shares a sheet id, and the next mint gets another", async () => {
  const { ledger } = make();
  await mint(ledger, 3);
  await mint(ledger, 2);
  const { results } = await env.DB.prepare("select sheet_id from labels order by rowid").all<{ sheet_id: string }>();
  expect(results.every((r) => typeof r.sheet_id === "string" && r.sheet_id.length > 0)).toBe(true);
  expect(new Set(results.slice(0, 3).map((r) => r.sheet_id)).size).toBe(1);
  expect(results[3].sheet_id).toBe(results[4].sheet_id);
  expect(results[0].sheet_id).not.toBe(results[3].sheet_id);
});

test("a retired label views as retired, signed in or not, and claim through it is not-found", async () => {
  const { ledger } = make();
  const { code } = await homeCopy(ledger);
  await env.DB.prepare("update labels set retired_at = 5 where code = ?").bind(code).run();
  expect(await ledger.view(code, null)).toEqual({ kind: "retired" });
  expect(await ledger.view(code, sam)).toEqual({ kind: "retired" });
  expect(await ledger.act(sam, { type: "claim", code })).toEqual({ rejected: "not-found" });
});

test("a copy reached by a code carries that code, even if the label changed between the read and the render", async () => {
  const { ledger: setup } = make();
  const { code: old, copyId } = await homeCopy(setup);
  const [spare] = await mint(setup);
  // Between view's label read and renderCopy's batch, the label is swapped by hand (as a replace would).
  const { ledger } = make({
    db: racing(() => env.DB.batch([
      env.DB.prepare("update labels set retired_at = 5 where code = ?").bind(old),
      env.DB.prepare("update labels set copy_id = ? where code = ?").bind(copyId, spare),
    ])),
  });
  const copy = asCopy(await ledger.view(old, sam));
  expect(copy.code).toBe(old);
  expect(JSON.stringify(copy)).not.toContain(spare);
});

test("the index allows one live label per copy", async () => {
  const { ledger } = make();
  const { copyId } = await homeCopy(ledger);
  const [spare] = await mint(ledger);
  await expect(env.DB.prepare("update labels set copy_id = ? where code = ?").bind(copyId, spare).run()).rejects.toThrow(/UNIQUE/);
});
```

- [ ] **Step 3: Run it to make sure it fails.**
  - Run: `pnpm test:worker src/worker/ledger/ledger.test.ts src/worker/index.test.ts`
  - Expected: FAIL, with no `sheet_id` column and the schema pin mismatched.
- [ ] **Step 4: Change the schema.**
  - In `schema.ts`, add `sheetId: text("sheet_id")` and `retiredAt: integer("retired_at")`.
  - Add the index: `uniqueIndex("labels_one_live_per_copy").on(t.copyId).where(sql\`${t.retiredAt} is null and ${t.copyId} is not null\`)`.
  - Keep `labels_copy_id_idx`.
  - Run `pnpm db:generate`, then check that the generated SQL is only `ALTER TABLE ... ADD` twice and one `CREATE UNIQUE INDEX`. Add a comment line at the top of the migration: `-- Fails if a copy already has two labels; none can today (every bind is guarded on the copy having none).`
- [ ] **Step 5: Change the ledger.**
  - `mintLabels`: draw one `crypto.randomUUID()` per call, and write it as `sheet_id` on every insert in every round.
  - `view`: select `retired_at` too, and answer `{ kind: "retired" }` when it is not null, before looking at `copy_id`.
  - `COPY_SELECT`: join the live label only.
  - The claim `labelGuard`: add `and retired_at is null`.
  - `renderCopy(copyId, viewer, codeInHand: string | null)` replaces the `labelInHand` boolean. `CopyView.code` and the public view's `code` are `codeInHand`, never the joined row's code, and the claim is offered when `codeInHand !== null`. Callers pass the code they hold:
    - `view` passes its code, and `act` passes the claim code or null;
    - `viewCopy` and `moveCopy` pass null;
    - `createUnlabelled`'s render callback becomes `(copyId, viewer, code)`, and `labelCopy` and `bindToUnlabelled` pass the code they bound.
- [ ] **Step 6: Run the worker tests, typecheck, lint and db:check.**
  - Run: `pnpm test:worker && pnpm typecheck && pnpm lint && pnpm db:check`
  - Expected: all pass. A client `switch` on `LabelView.kind` that typecheck flags gets a `retired` case that renders nothing yet; Task 5 fills it in.
- [ ] **Step 7: Commit.** `feat: labels carry a sheet id and can be retired; one live label per copy`

### Task 2: Past sheets, read

**Files:**
- Create: `src/worker/ledger/sheets.ts`
- Modify: `src/worker/ledger/ledger.ts` (Ledger interface; spread `createSheetReads(db, deps.siteUrl)` into the returned ledger)
- Modify: `src/shared/types.ts` (add `SheetSummary`)
- Modify: `src/worker/index.ts` (two GET routes, registered **before** `app.get("/api/labels/:code", ...)`, which would otherwise take "sheets" as a code)
- Test: `src/worker/ledger/sheets.test.ts` (new; same `beforeEach`/`afterEach` as `ledger.test.ts`), `src/worker/index.test.ts`

**Interfaces:**
- Consumes: `labels.sheet_id`, `labels.retired_at` (Task 1).
- Produces:
  - `export type SheetSummary = { id: string; at: number; total: number; blank: number; mine: number }`. Here `at` is the earliest `minted_at`, and `mine` counts labels bound to copies the member owns and not retired.
  - `Ledger.sheets(member: Member): Promise<SheetSummary[]>`, newest first, ties broken by the latest rowid first.
  - `Ledger.sheetCodes(member: Member, sheetId: string, opts: { includeMine: boolean }): Promise<{ code: string; url: string }[] | Rejection>`, in mint order (`order by rowid`). It is `not-found` when the member minted no label with that sheet key, or when `sheetId` is longer than 200 characters.
  - `export const SHEET_KEY = "coalesce(l.sheet_id, 'old-' || l.minted_by || '-' || (l.minted_at / 1000))"` in `sheets.ts`. Both reads use it.
  - `GET /api/labels/sheets` answers `{ sheets: SheetSummary[] }`.
  - `GET /api/labels/sheets/:id?include=mine` answers `{ labels: { code, url }[] }`. `include` absent or any other value means blank labels only. Both routes are member-only.

- [ ] **Step 1: Write the failing tests** in `sheets.test.ts`. Use `make`, `mint`, `homeCopy`, `natalie`, `sam` and `kim` from `test/ledger-fixtures`.

```ts
test("sheets lists the member's mints newest first with counts", async () => {
  let t = 1000;
  const { ledger } = make({ now: () => t });
  await mint(ledger, 3);                          // sheet A at 1000
  t = 5000;
  await homeCopy(ledger);                         // sheet B at 5000: one label, on Natalie's copy
  ok(await ledger.mintLabels(sam, 2));            // Sam's: never in Natalie's list
  const list = await ledger.sheets(natalie);
  expect(list.map((s) => [s.at, s.total, s.blank, s.mine])).toEqual([[5000, 1, 0, 1], [1000, 3, 3, 0]]);
});

test("sheetCodes gives blanks in mint order; includeMine adds labels on the member's own books only", async () => { /* mint 3, add one of them to a copy Natalie owns, add one to a copy whose owner_id is then set to Sam with SQL: blanks → [the 1 blank]; includeMine → [Natalie's bound one, blank] in mint order; Sam's never */ });
test("a label on a book the member owns but that was replaced is never printed", async () => { /* bind, then set retired_at; includeMine excludes it */ });
test("someone else's sheet, an unknown id and an over-long id are not-found", async () => {});
test("labels minted before sheet ids existed group by member and minted second", async () => { /* insert 3 labels with null sheet_id, minted_at 7000, 7400 and 8100 by Natalie, plus one by Sam at 7000: Natalie's list has two sheets (2 and 1), and sheetCodes on the first id returns those 2 */ });
```

Route tests in `index.test.ts`:

```ts
test("GET /api/labels/sheets signed out is 401, and is not taken for a label code", async () => { /* get("/api/labels/sheets", "") → 401 */ });
test("GET /api/labels/sheets/:id?include=mine answers labels with urls", async () => { /* sign in, POST /api/labels {count: 2}, list sheets, fetch codes: 2 labels, url `${SITE}/b/<code>` */ });
```

- [ ] **Step 2: Run them to make sure they fail.**
  - Run: `pnpm test:worker src/worker/ledger/sheets.test.ts src/worker/index.test.ts`
  - Expected: FAIL, with `ledger.sheets` not a function.
- [ ] **Step 3: Implement `createSheetReads(db: D1Database, siteUrl: string)`** in `sheets.ts`, returning `{ sheets, sheetCodes }`.
  - Each read is one query over `labels l left join copies c on c.id = l.copy_id where l.minted_by = ?`. `mine` is `l.copy_id is not null and l.retired_at is null and c.owner_id = <member>`.
  - Build the URL the way `mintLabels` does: `new URL("/b/" + code, siteUrl)`.
  - Wire it into the ledger and add the two routes.
- [ ] **Step 4: Run the tests, typecheck, lint.**
  - Run: `pnpm test:worker && pnpm typecheck && pnpm lint`
  - Expected: all pass.
- [ ] **Step 5: Commit.** `feat: past label sheets and their codes, for printing again`

### Task 3: Replace a label, and the owner's code, on the server

**Files:**
- Create: `src/worker/ledger/relabel.ts`
- Modify: `src/worker/ledger/rules.ts` (the `"relabel"` action)
- Modify: `src/shared/types.ts`:
  - `ActionType` adds `"relabel"`;
  - `HistoryEntry.type` adds `"relabelled"`;
  - `CopyView` adds `ownerCode: string | null`.
- Modify: `src/worker/ledger/ledger.ts` (`renderCopy` sets `ownerCode`; Ledger interface; spread `createRelabel(...)`)
- Modify: `src/worker/index.ts` (`POST /api/copies/:id/relabel`)
- Modify: `src/client/screens/CopyPage.tsx`, the minimum to keep the copy page correct with the new types:
  - add `relabel: "Replace label"` to `actionText` and `relabelled: "replaced its label"` to `historyText`;
  - filter `relabel` out of `buttons`, as `label` is, so it can never fall through `act()` to `returnCopy`.
- Test: `src/worker/ledger/rules.test.ts`, `src/worker/ledger/relabel.test.ts` (new), `src/worker/index.test.ts`, plus every existing test whose expected `actions` for an owner of a labelled copy now include `"relabel"`, and client fixtures typecheck flags for the missing `ownerCode` (set `ownerCode: null`).

**Interfaces:**
- Consumes: `retired_at` and the live-label `COPY_SELECT` (Task 1).
- Produces:
  - `decide(state, viewer, "relabel")` gives `{ holderMemberId: state.holderMemberId, event: "relabelled" }` when the viewer is the owner and `state.labelled`; otherwise `not-allowed`.
  - The `ACTIONS` order becomes `["claim", "return", "move", "label", "relabel"]`.
  - `CopyView.ownerCode` is the copy's live label code when the viewer is the owner, on every member view. It is `null` for anyone else or for an unlabelled copy. `CopyView.code` is unchanged.
  - `Ledger.replaceLabel(owner: Member, copyId: string, input: { code: string; replacing: string }): Promise<CopyView | Rejection>`. On success it answers the copy as `renderCopy(copyId, owner, true)` renders it, so `code` and `ownerCode` are both the new code.
  - Rejections, checked in this order:
    - `invalid`: `copyId` or `input` fields that are not strings;
    - `label-unknown`: the new code does not parse or does not exist;
    - `label-in-use`: the new label is bound, retired or not;
    - `not-found`: no such copy;
    - `not-allowed`: the rule refuses, `replacing` is not the copy's live code, or the guarded batch changed nothing while the new label is still blank.
  - `POST /api/copies/:id/relabel` takes `{ code, replacing }`, both strings, or answers 400. The id goes through `idParam`, as `/label` does.

- [ ] **Step 1: Write the failing tests.**
  - `rules.test.ts` table changes:
    - "owner at home" → `["move", "relabel"]`;
    - "owner while the book is out" → `["return", "move", "relabel"]`;
    - "owner of a copy with no label" stays `["move", "label"]`.
  - `relabel.test.ts`:

```ts
test("replace retires the old label, binds the new one, and adds one relabelled entry", async () => {
  const { ledger } = make();
  const { code: old, copyId } = await homeCopy(ledger);
  const [fresh] = await mint(ledger);
  const copy = ok(await ledger.replaceLabel(natalie, copyId, { code: fresh, replacing: old }));
  expect(copy.code).toBe(fresh);
  expect(copy.ownerCode).toBe(fresh);
  expect(copy.history[0].type).toBe("relabelled");
  expect(copy.history.filter((h) => h.type === "relabelled")).toHaveLength(1);
  expect(await ledger.view(old, natalie)).toEqual({ kind: "retired" });
  expect(asCopy(await ledger.view(fresh, natalie)).copyId).toBe(copyId);
  const rows = await env.DB.prepare("select code, retired_at from labels where copy_id = ? order by rowid").bind(copyId).all();
  expect(rows.results).toEqual([{ code: old, retired_at: 1000 }, { code: fresh, retired_at: null }]);
});

test("after a replace the copy is listed once on its shelf and in holding, still labelled", async () => {});
test("only the owner may replace; a removed owner may not", async () => { /* sam → not-allowed; set natalie removed_at → not-allowed; labels unchanged */ });
test("an unlabelled copy cannot be replaced", async () => { /* import or add-without-label path: not-allowed */ });
test("a stale replacing code is refused and its new label stays blank", async () => {
  /* replace old→a succeeds; replace with replacing: old, code: b → not-allowed; b still blank; one live label */
});
test("the copy's own label as the new one is label-in-use; an unknown code is label-unknown", async () => {});
test("two replaces racing for one copy: one wins, the copy keeps one live label", async () => {
  /* make({ db: gated(2) }); Promise.all of replace(old→a) and replace(old→b); exactly one ok, the other not-allowed or label-in-use; count of live labels for the copy is 1 */
});
test("the same replace sent twice at once applies once: one relabelled entry, one live label", async () => {
  /* make({ db: gated(2) }); Promise.all of two identical replace(old→a); one ok, the other not-allowed or label-in-use;
     events of type relabelled for the copy: 1; live labels for the copy: 1 */
});
test("a claim through the old code that lands after the replace is refused", async () => {
  /* make({ db: racing(() => ledger2.replaceLabel(...)) }) for Sam's claim on old; result not-found or not-allowed; holder still natalie */
});
test("ownerCode is the live code for the owner on any view, and null for anyone else", async () => {
  /* viewCopy(copyId, natalie).ownerCode === code; viewCopy(copyId, sam).ownerCode === null; view(code, sam).copy.ownerCode === null */
});
```

  - `index.test.ts`: "POST /api/copies/:id/relabel replaces, and a body without replacing is 400", and "a cross-site relabel is 403".
- [ ] **Step 2: Run them to make sure they fail.**
  - Run: `pnpm test:worker src/worker/ledger/relabel.test.ts src/worker/ledger/rules.test.ts`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `rules.ts`: the `relabel` branch, plus the action in `ACTIONS`.
  - `renderCopy`: `ownerCode: row.owner_id === viewer.id ? row.code : null` (the member view only; the public view has no `ownerCode`).
  - The `CopyPage.tsx` map entries and the `buttons` filter listed under Files, with a test in `CopyPage.test.tsx`: "relabel is never an action button".
  - `createRelabel(db, now, render)` in `relabel.ts`: the reads above, then one `db.batch` of three statements, following the pattern of `bind` in `unlabelled.ts`. The guard **G** is the whole pre-state:
    - the old label is live on this copy (`code = <replacing> and copy_id = <copyId> and retired_at is null`);
    - the new label is blank (`exists BLANK`);
    - the actor owns the copy;
    - the actor is `ACTIVE`.

    The statements, in this order:
    1. `insert into events (copy_id, at, actor_id, type) select ?, ?, ?, 'relabelled' where G`.
    2. `update labels set retired_at = ? where code = <replacing> and copy_id = <copyId> and retired_at is null and <the rest of G>`.
    3. `update labels set copy_id = ?, bound_at = ? where code = <new> and copy_id is null and not exists (select 1 from labels where copy_id = <copyId> and retired_at is null) and exists (select 1 from labels where code = <replacing> and copy_id = <copyId> and retired_at is not null)`.
  - Statement 3's change count says whether the batch applied. On 0, re-read the new label: bound gives `label-in-use`, otherwise `not-allowed`.
  - A losing batch (stale, raced or repeated) matches none of the three, so it writes nothing and never trips the unique index. `now` is fixed at 1000 in the fixtures, so no guard may compare `retired_at` to this batch's own time.
  - Add the route.
- [ ] **Step 4: Run all worker tests, typecheck, lint.** Update the existing `actions` expectations and client fixtures that typecheck flags.
  - Run: `pnpm test:worker && pnpm test:client && pnpm typecheck && pnpm lint`
  - Expected: all pass.
- [ ] **Step 5: Commit.** `feat: replace a label; the owner sees the copy's code`

### Task 4: Labels page prints at once and lists past sheets

**Files:**
- Modify: `src/client/api.ts`:
  - `listSheets = () => call<{ sheets: SheetSummary[] }>("/api/labels/sheets")`;
  - `sheetLabels = (sheetId: string, includeMine: boolean) => call<{ labels: { code: string; url: string }[] }>(`/api/labels/sheets/${id(sheetId)}${includeMine ? "?include=mine" : ""}`)`.
- Modify: `src/client/screens/Labels.tsx`
- Test: `src/client/screens/Labels.test.tsx` (mock `listSheets` and `sheetLabels` beside `mintLabels`; the default `listSheets` resolves `{ sheets: [] }`)

**Interfaces:**
- Consumes: the two GET routes (Task 2), `SheetSummary`.
- Produces: none.

- [ ] **Step 1: Write the failing tests.** Change "Print calls window.print": `print` is now called once by Make labels and once more by Print.

```ts
test("Make labels opens the print dialog once, after the labels are on the page", async () => {
  print.mockImplementation(() => expect(codes()).toHaveLength(48));
  show();
  await make();
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
});
test("a run of two sheets prints once, after both", async () => {});
test("a run that fails part way does not print; Try again prints once it completes", async () => {});
test("previous sheets are listed newest first with their counts", async () => {
  /* listSheets → [{id:"s2", at, total:48, blank:40, mine:8}, {id:"s1", ...}]; rows read "<date> · 48 labels, 40 blank, 8 on your books" in that order */
});
test("Print again prints that sheet's blank labels, laid out on the chosen sheet, and makes none", async () => {
  /* sheetLabels("s2", false) → 2 labels; codes() equals them; print called; mintLabels not called; "These labels now exist" absent */
});
test("the checkbox asks for the labels already on my books", async () => { /* check "Also print labels already on my books", Print again → sheetLabels("s2", true) */ });
test("a sheet with nothing to print says so and does not print", async () => {
  /* sheetLabels → { labels: [] }; text "Every label on that sheet is already on a book."; print not called */
});
test("Print again after a failed partial run, then Make labels, starts a fresh run", async () => {
  /* 2 sheets, second mint fails; Print again; Make labels → mintLabels called twice more (48, 48) and codes() has 96 new codes */
});
test("making labels refreshes the list of previous sheets", async () => { /* listSheets called again after the run */ });
test("a list that fails to load says so and the page still makes labels", async () => { /* "Couldn't load your previous sheets." */ });
```

- [ ] **Step 2: Run them to make sure they fail.**
  - Run: `pnpm test:client src/client/screens/Labels.test.tsx`
  - Expected: FAIL.
- [ ] **Step 3: Implement in `Labels.tsx`.**
  - Printing: a `printSoon` state, set when a full run completes or when a re-print lands. A `useEffect` on `[labels, printSoon]` calls `window.print()` once and clears the flag. The effect runs after commit, so the labels are in the DOM.
  - Re-printing:
    - It clears `partial` and `failed`, and sets a `reprint` flag that hides the "These labels now exist" line.
    - It shares the `inFlight` guard with `make`.
  - The list:
    - It loads on mount for a member, and again after each completed or partial run.
    - It sits below the Print button, under the heading "Previous sheets", with the checkbox above the rows.
    - A 401 from any of these calls sets `lost`.
- [ ] **Step 4: Run the client tests, typecheck, lint.**
  - Run: `pnpm test:client && pnpm typecheck && pnpm lint`
  - Expected: all pass.
- [ ] **Step 5: Commit.** `feat: Make labels prints at once; previous sheets can be printed again`

### Task 5: Copy page shows the owner's code, offers Replace label, explains a retired label

**Files:**
- Modify: `src/client/screens/CopyPage.tsx`
- Modify: `src/client/index.css` (`.label-code`: the sheet label's font family and size)
- Test: `src/client/screens/CopyPage.test.tsx`

**Interfaces:**
- Consumes: `CopyView.ownerCode`, the `"relabel"` action and its `actionText` entry, and `LabelView` `retired` (Tasks 1 and 3).
- Produces: the link `/pair?copy=<copyId>&replace=1`. Task 6 reads it.

- [ ] **Step 1: Write the failing tests.**

```ts
test("the owner sees the label code under the book; nobody else does", async () => {
  /* ownerCode "t7k2q9xzmb" → paragraph "Label t7k2q9xzmb"; ownerCode null → no .label-code element */
});
test("Replace label links to pairing in replace mode, only when offered", async () => {
  /* actions ["move","relabel"] → link "Replace label" href "/pair?copy=c1&replace=1"; without relabel → no link; never rendered as an action button */
});
test("a replaced label says so and shows no book", async () => {
  /* getLabel → { kind: "retired" }: text "This label has been replaced."; no img, no buttons */
});
```

- [ ] **Step 2: Run them to make sure they fail.**
  - Run: `pnpm test:client src/client/screens/CopyPage.test.tsx`
  - Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Render `relabel` (already in `actionText`, and already filtered out of `buttons` by Task 3) as a link beside "Put a label on it".
  - Render the code paragraph after `<Book />`.
  - Add the `retired` branch.
- [ ] **Step 4: Run the client tests, typecheck, lint.**
  - Run: `pnpm test:client && pnpm typecheck && pnpm lint`
  - Expected: all pass.
- [ ] **Step 5: Commit.** `feat: copy page shows the owner's label code and offers Replace label`

### Task 6: Pairing replaces a label, and the roadmap is updated

**Files:**
- Modify: `src/client/api.ts`: `relabelCopy = (copyId: string, code: string, replacing: string) => call<CopyView>(`/api/copies/${id(copyId)}/relabel`, "POST", { code, replacing })`.
- Modify: `src/client/screens/Pair.tsx` (replace mode)
- Modify: `docs/ROADMAP.md` (step 4)
- Test: `src/client/screens/Pair.test.tsx` (add `relabelCopy` to the api mock)

**Interfaces:**
- Consumes:
  - `/pair?copy=<id>&replace=1` (Task 5);
  - `CopyView.ownerCode` and the `"relabel"` action (Task 3);
  - `POST /api/copies/:id/relabel` (Task 3).
- Produces: none.

- [ ] **Step 1: Write the failing tests** in `Pair.test.tsx`, using `show("?copy=c1&replace=1")`. Here `getCopy` resolves a view with `actions: ["move", "relabel"]`, `ownerCode: "t7k2q9xzmb"` and the book Dune.

```ts
test("replace mode asks for a label, confirms, then replaces and goes to the new label's page", async () => {
  /* scanner wants a label; read "h4k7m2p9qr"; text "Replace the label on Dune?"; click "Replace" →
     relabelCopy("c1", "h4k7m2p9qr", "t7k2q9xzmb") once; assign("/b/h4k7m2p9qr"); labelCopy and addCopy never called */
});
test("Cancel at the confirm goes back to scanning and saves nothing", async () => {});
test("a copy that can't be relabelled shows the cannot step", async () => { /* actions without "relabel" */ });
test("a label already on a book is refused with the blank-label notice and scanning resumes", async () => {
  /* relabelCopy rejects 409 label-in-use → "That label is already on a book. Use a blank one." */
});
test("a replace refused not-allowed says the label just changed and reloads the copy", async () => {
  /* 403 not-allowed → notice "This book's label just changed. Try again."; getCopy called again; the new ownerCode becomes `replacing` */
});
test("without replace=1, ?copy= still labels an unlabelled copy as before", async () => { /* existing behaviour pinned */ });
```

- [ ] **Step 2: Run them to make sure they fail.**
  - Run: `pnpm test:client src/client/screens/Pair.test.tsx`
  - Expected: FAIL.
- [ ] **Step 3: Implement replace mode.**
  - Read `replace=1` once, as `copy` is.
  - `loadCopy` requires `"relabel"` in `actions` and a non-null `ownerCode` in replace mode, or `"label"` otherwise; it falls back to `cannot` as today.
  - Extend `Payload` with `{ copyId: string; replacing: string }`.
  - Add a `replaceconfirm` step after a label is read: the book card, "Replace the label on <title>?", and the buttons "Replace" and "Cancel".
  - `save` calls `relabelCopy` for that payload and then `location.assign(`/b/${label}`)`, staying in flight as today.
  - Errors:
    - `label-in-use` and `label-unknown` take the existing branch;
    - `not-allowed` shows the notice above and calls `loadCopy` again;
    - `not-found` goes to `cannot`.
- [ ] **Step 4: Update the roadmap** in `docs/ROADMAP.md` step 4:
  - Add a line under the heading: "First release (label tools, `docs/superpowers/specs/2026-11-26-label-tools-design.md`): built, not yet released: print at once, past sheets, the owner's code, replace a label. The second release carries lending to a name, giving, requests and release."
  - Mark these carry-overs "Done: (label tools)":
    - "Replacing a label retires the old one";
    - "When a copy can have two labels, the copy view must be given the requested code rather than reading it from the joined label row". `renderCopy` takes the code in hand (Task 1).
- [ ] **Step 5: Run everything.**
  - Run: `pnpm test && pnpm typecheck && pnpm lint`
  - Expected: all pass.
- [ ] **Step 6: Commit.** `feat: pairing replaces a label; roadmap updated`

## Release notes for James (not a task)

The migration adds two columns and one index. Before applying it in production, run this read-only check, which should return no rows:

```sql
select copy_id, count(*) from labels where copy_id is not null group by copy_id having count(*) > 1
```

Apply the migration, then deploy. The order is safe because old code never reads the new columns.
