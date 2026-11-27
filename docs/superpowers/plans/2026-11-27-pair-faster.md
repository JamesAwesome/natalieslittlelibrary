# Pair Faster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pairing is one tap from your own wall, and in a run of books the scanner comes back after each pair instead of leaving for the book's page.

**Architecture:** Client only. `CoverWall` gets a plus link beside its `h1` when `kind === "mine"`. `Pair` learns whether it was opened plain (`/pair`, no `?copy=`, no `?label=`); when it was, a successful save resets to the barcode step with a status note instead of calling `location.assign`.

**Tech Stack:** React 19, TypeScript, plain CSS with tokens, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-27-pair-faster-design.md`

## Global Constraints

- No server change: nothing under `src/worker/`, `src/shared/` or `drizzle/` changes.
- Colours from `src/client/styles/tokens.css` only; light and dark settings; 44px targets; text 4.5:1 or better.
- Renders at 320, 375, 414 and 768px wide with no sideways scroll (`scripts/shoot.mjs`).
- Tests by role and visible text; no snapshot tests.
- `/pair?copy=…` (with or without `&replace=1`) and `/pair?label=…` keep ending on `/b/<label>`, unchanged.
- The tab bar keeps its four tabs. More keeps "Pair a book"; the empty wall keeps its "Pair a book" link.
- One branch, `pair-faster`, from an up-to-date `main`; one pull request; the maintainer merges.
- After each task: the ordinary task review **and** an antagonist pass (`.claude/agents/antagonist.md`), with BLOCKING/SHOULD-FIX findings fed back into the fix loop.
- No private data (`storygraph_export.csv`) in fixtures, screenshots or the PR.

## Review Focus

1. **The label just paired is still in front of the camera** when the next book reaches the label step: it must not be sent again. Test in Task 2.
2. **Nothing from the last book leaks into the next:** typed title and author, the ISBN, the "Is it one of these?" list, a notice. Test in Task 2.
3. **An imported copy that stays in its own collection** must say so in the note, since the separate "stays" screen is gone on plain `/pair`. Test in Task 2.
4. **A double tap or a late answer after the reset** must not save twice or put a stale note up. `inFlight` must be released only once the reset happens. Test in Task 2.
5. **The plus at 320px beside a long title or in dark mode:** it must stay 44px and stay on the title's row without squeezing the title off-screen. Checked by shots in Task 1.

---

### Task 1: The plus on your wall

**Files:**
- Modify: `src/client/wall/CoverWall.tsx:63` (the `h1`)
- Modify: `src/client/styles/wall.css:37-39` (`.wall > h1`)
- Test: `src/client/wall/CoverWall.test.tsx`
- Also commit: `docs/superpowers/specs/2026-11-27-pair-faster-design.md`, this plan

**Interfaces:**
- Consumes: nothing new.
- Produces: in the DOM, `<div class="wall-head"><h1>…</h1><a class="wall-pair" href="/pair" aria-label="Pair a book">…</a></div>` when `kind === "mine"`. With any other kind, the `h1` renders as before (inside `.wall-head` or not; the builder's choice, as long as the CSS gives it the same margins).

- [ ] **Step 1: Write the failing tests** in `CoverWall.test.tsx`

```tsx
test("your own wall has a Pair a book link beside the title, loading, empty or full", () => {
  for (const over of [{}, { items: [] }, { loading: true }]) {
    const { unmount } = wall(over);
    expect(screen.getByRole("link", { name: "Pair a book" })).toHaveAttribute("href", "/pair");
    unmount();
  }
});

test("no Pair a book link on a friend's wall, Holding or a collection", () => {
  for (const kind of ["friend", "holding", "my-collection"] as WallKind[]) {
    const { unmount } = wall({ kind });
    expect(screen.queryByRole("link", { name: "Pair a book" })).not.toBeInTheDocument();
    unmount();
  }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run --config vitest.client.config.ts src/client/wall/CoverWall.test.tsx`
Expected: the first new test FAILS (no link named "Pair a book"); the second passes.

- [ ] **Step 3: Add the link in `CoverWall`**

Wrap the `h1` and, when `kind === "mine"`, an `<a className="wall-pair" href="/pair" aria-label="Pair a book">` holding an inline 24×24 SVG plus (`<path d="M12 5v14M5 12h14" />`, `aria-hidden="true"`, `focusable="false"`) in `<div className="wall-head">`. Keep `headingRef`/`tabIndex` on the `h1` exactly as now.

- [ ] **Step 4: Style it** in `wall.css`

`.wall-head`: flex row, `align-items: center`, `justify-content: space-between`, `gap: var(--space-3)`, and the `h1`'s old `margin-bottom: var(--space-1)` moves here, with the `h1` at `margin: 0; min-width: 0`. `.wall-pair`: `flex: none`, 44×44px, `border-radius: 50%`, `background: var(--color-accent)`, `color: var(--color-paper)` (6.81:1 light, 8.40:1 dark, per `tokens.css`), the SVG at 22px with `stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; fill: none`, and `:focus-visible` with the same focus ring that other links use. Delete the `.wall > h1` rule.

- [ ] **Step 5: Run the client tests**

Run: `pnpm test:client`
Expected: all pass, including the two new tests and the existing `h1`/`headingRef` tests.

- [ ] **Step 6: Shoot it**

With `pnpm dev` running, shoot the preview wall (`src/client/preview/preview.html`, which renders `CoverWall`, `kind` defaulting to `mine`; add `&empty` and `&loading` for those states):
`node scripts/shoot.mjs "http://localhost:5173/src/client/preview/preview.html" <scratch>/shots --widths 320,375,414,768 --schemes light,dark --dpr 2 --expect ".wall"`
Expected: exit 0 (no sideways scroll). In each shot the plus is a circle on the title's row, clear of the chips and the A–Z rail.

- [ ] **Step 7: Lint, typecheck, commit**

Run: `pnpm lint && pnpm typecheck` (expected: clean).

```bash
git add docs/superpowers/specs/2026-11-27-pair-faster-design.md docs/superpowers/plans/2026-11-27-pair-faster.md \
  src/client/wall/CoverWall.tsx src/client/wall/CoverWall.test.tsx src/client/styles/wall.css
git commit -m "feat: a Pair a book plus beside My books on your own wall"
```

---

### Task 2: Pair goes straight back to scanning

**Files:**
- Modify: `src/client/screens/Pair.tsx` (state near `:66-104`, `save` at `:246-270`, the `isbn` step at `:475-488`, the `stays` screen at `:625-630`)
- Modify: `src/client/styles/screens.css` (the note's layout, near the other `.pair-page` rules)
- Test: `src/client/screens/Pair.test.tsx`

**Interfaces:**
- Consumes: `addCopy`, `labelCopy` (both resolve to `CopyView`, carrying `book: BookInfo` and `collection: CollectionRef | null`); `Cover` from `./BookCard` with `size="row"`; `Name`.
- Produces: nothing other files use.

**Decisions:**
- `loops = copyId === null && !fromLabel`, where `fromLabel` is read once at mount: `useState(() => new URLSearchParams(location.search).get("label") !== null)`. A `?label=` that doesn't parse still counts as "from a label" (it came from a book's page).
- New state: `last: { title: string; authors: string[]; coverUrl: string | null; label: string; stays: string | null } | null` and `count: number` (this visit only).
- In `save`, after a successful `addCopy`/`labelCopy` with `loops` true and `mine === seq.current && live.current`: call `startOver()`, then set `refused.current = label`, `setLinked(null)`, `setLast({...})` from the response's `book` and the `stayed` name (or `null`), `setCount((n) => n + 1)`, release `inFlight.current = false`, and focus the `h1` (give it `ref` and `tabIndex={-1}`). Nothing else changes: `writePick` still runs; `loops` false keeps today's `setStays`/`location.assign` exactly.
- Copy, exact:
  - Note, first paragraph: `Paired <Name>{title}</Name>.` plus, when `stays` is set, ` It stays in <Name>{stays}</Name>.`
  - Link: `See it`, `href={`/b/${label}`}`.
  - Tally: `{count} paired this time` (also "1 paired this time").
  - Prompt, replacing "Scan the barcode on the back of the book." when `last !== null`: `Scan the barcode on the back of the next book.`
  - After "No barcode? Type it in", when `last !== null`: a link `Done`, `href="/"`.
- The note is a `<div role="status" className="pair-done">` with the `row` cover beside the text, shown only on the `isbn` step. It is rendered empty (not absent) on the `isbn` step before the first pair, so screen readers announce it when it fills.

- [ ] **Step 1: Write the failing tests** in `Pair.test.tsx` (reuse `show`, `click`, `wantOf`, `para`, `findPara`, `mockOnMount`, `mineIs`, `item`)

```tsx
test("plain /pair: a save comes back to the barcode step with a note, a link and a count", async () => {
  // look → Yes → stub label, with addCopy resolving to { ...copy, book, collection: null }
  await waitFor(() => expect(wantOf()).toBe("isbn"));
  expect(assign).not.toHaveBeenCalled();
  expect(para("Paired Dune.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "See it" })).toHaveAttribute("href", "/b/t7k2q9xzmb");
  expect(para("1 paired this time")).toBeInTheDocument();
  expect(para("Scan the barcode on the back of the next book.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute("href", "/");
  expect(screen.getByRole("heading", { level: 1, name: "Pair a book" })).toHaveFocus();
});

test("a second pair replaces the note and counts two", async () => {
  // pair Dune with t7k2q9xzmb, then a second book (addCopy resolves with title "Emma") with "stub other label"
  expect(await findPara("Paired Emma.")).toBeInTheDocument();
  expect(queryPara("Paired Dune.")).not.toBeInTheDocument();
  expect(para("2 paired this time")).toBeInTheDocument();
});

test("the label just paired, still in view, is not sent for the next book", async () => {
  // pair once with t7k2q9xzmb, then set mockOnMount = { want: "label", reading: { kind: "label", code: "t7k2q9xzmb" } },
  // scan the next ISBN and confirm Yes
  await waitFor(() => expect(wantOf()).toBe("label"));
  expect(api.addCopy).toHaveBeenCalledTimes(1);
});

test("nothing typed for the last book is left in the form for the next", async () => {
  // No barcode? Type it in → title "Emma", author "Jane Austen" → stub label → back on isbn → No barcode? Type it in
  expect(screen.getByLabelText("Title")).toHaveValue("");
  expect(screen.getByLabelText("Author")).toHaveValue("");
});

test("a book picked from Is it one of these? comes back to scanning too", async () => {
  // similar → "This one: …" → stub label → labelCopy resolves
  await waitFor(() => expect(wantOf()).toBe("isbn"));
  expect(assign).not.toHaveBeenCalled();
});

test("a double tap on the last step saves once and counts once", async () => {
  // as the existing "a double tap on the final step sends one request", on plain /pair
  expect(api.addCopy).toHaveBeenCalledTimes(1);
  expect(para("1 paired this time")).toBeInTheDocument();
});

test("?copy= and ?label= still end on the book's page", async () => {
  // one save each; both expect(assign).toHaveBeenCalledWith("/b/…") and no "Paired" note
});
```

The comments name the setup; the builder writes it with the file's existing helpers. The assertions are fixed.

The file's shared `copy` fixture (`:46`) is `{ copyId, code } as CopyView`, with no `book`. The real server always returns `book` and `collection`, and the note reads the title and cover from the response. So the fixture becomes `{ copyId: "c1", code: "t7k2q9xzmb", book, collection: null } as CopyView`.

The imported-copy case (Review Focus 3) is the existing test "a scan that finds an imported copy tells you it stays where it was, and does not navigate" (`:1017`), converted in Step 4. Its assertions become `await findPara("Paired Dune. It stays in Home library.")`, `getByRole("link", { name: "See it" })` with `href="/b/t7k2q9xzmb"`, `wantOf() === "isbn"`, and `assign` not called.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run --config vitest.client.config.ts src/client/screens/Pair.test.tsx`
Expected: the new plain-`/pair` tests FAIL (assign was called, no note); the `?copy=`/`?label=` test passes.

- [ ] **Step 3: Implement the decisions above in `Pair.tsx`**, and add `.pair-done` to `screens.css` (cover and text side by side, `background: var(--color-paper-2)`, rounded, `gap: var(--space-3)`; tally in `--color-muted` at `--text-sm`).

- [ ] **Step 4: Update the existing tests that now loop**

Run the file. About twenty existing tests assert `assign` after a save. For each one that fails, apply this rule and nothing else:
- Opened with plain `show()` (no `?label=`, no `?copy=`): replace the navigation assertion with `await findPara("Paired <title>.")` and `expect(assign).not.toHaveBeenCalled()`, and rename "goes to the book's page" / "navigates" in the test's name to "comes back to scanning". Keep every other assertion in the test (what was sent, how many times). The stays test at `:1017` converts as described above.
- Opened with `?label=` or `?copy=`: it must still pass unchanged. If one fails, that's a bug in `loops`, not in the test.

- [ ] **Step 5: Run the client tests, lint, typecheck**

Run: `pnpm test:client && pnpm lint && pnpm typecheck`
Expected: all pass, clean.

- [ ] **Step 6: Shoot the note**

With `pnpm dev`, pair a public-domain book on plain `/pair`, then shoot the page at `--widths 320,375 --schemes light,dark --dpr 2 --expect ".pair-page"`. Expected: exit 0; the note's cover, text and "See it" fit on one row at 375 and wrap cleanly at 320.

- [ ] **Step 7: Commit**

```bash
git add src/client/screens/Pair.tsx src/client/screens/Pair.test.tsx src/client/styles/screens.css
git commit -m "feat: plain Pair comes straight back to scanning after each book"
```

---

### Task 3: Docs and the pull request

**Files:**
- Modify: `README.md:10` (the **Pair** line)

- [ ] **Step 1:** In the README's **Pair** step, add one sentence: open it from the plus beside My books; after each book, the scanner comes back for the next one.
- [ ] **Step 2:** Run `pnpm test` (expected: all pass), commit `docs: README says where Pair starts and that it loops`, push `pair-faster`, and open the PR with `gh pr create`. The PR body says what changed and links the spec, and refers to the maintainer by role, not by name. The Task 1 and Task 2 shots go to the maintainer directly (they're remote), not into the PR.
