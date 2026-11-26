# Design Round (Release 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task gets the normal task review **and** an antagonist pass (the `antagonist` agent) before the next task starts.

**Goal:** Replace Home's button stack with a tab bar and walls of covers (A–Z rail, simple chips), a cover-first book page, and a warm light/dark look in Fraunces and Geist. Client only.

**Architecture:**
- **Stylesheets.** `src/client/index.css` splits into plain CSS files under `src/client/styles/`, loaded from one entry. OKLCH tokens live in `tokens.css`, and the label sheet's rules move unchanged into `print.css`, imported last.
- **Shell.** `App` gains a shell context, so screens can set the active tab and say "signed out". `TabBar` renders from it.
- **Walls.** Pure functions in `src/client/wall/model.ts` do the sorting, grouping, filtering and rail maths. `CoverWall` and `AlphaRail` are presentational, and screens load the data and hand it in.
- **Book page.** `CopyPage` keeps its data flow and flows, and gets a cover-first layout. Pure helpers in `src/client/book/model.ts` pick the main action and the back link.
- **Delivery.** Four pull requests, each releasable on its own.

**Tech Stack:** React 19, Vite 8, Vitest 4 (jsdom) with Testing Library, pnpm 11, and `@fontsource-variable/fraunces` and `@fontsource-variable/geist` 5.3.0 (OFL).

**Spec:** `docs/superpowers/specs/2026-11-26-design-round-design.md`. Read it before any task. It has the exact copy, tokens and behaviour this plan points at.

## Global Constraints

- **Client only.** No change under `src/worker/`, `migrations/`, `wrangler.jsonc` or `src/shared/` (except new pure types if needed).
- **New dependencies:** only `@fontsource-variable/fraunces@5.3.0` and `@fontsource-variable/geist@5.3.0` (and `@fontsource-variable/geist-mono@5.3.0` only if label codes change face). No router, no CSS framework.
- **Tokens only.** Every colour and `font-family` outside `src/client/styles/tokens.css` is a `var(--…)`. **Exempt:** `src/client/styles/print.css` and `src/client/labelsheet/`, which keep literal black, white and greys.
- **Colours are OKLCH.** Each text pair carries its WCAG ratio in a comment. Text needs at least 4.5:1, and focus rings, icons and hairlines that carry meaning need at least 3:1, in **both** settings.
- **Font tokens:** `--font-display: "Fraunces Variable", Georgia, serif;` and `--font-body: "Geist Variable", system-ui, sans-serif;`. Headings are always `font-style: normal`.
- **Tap targets** are at least 44×44 CSS px. Chips and rail pad their hit area beyond what's drawn.
- **Motion.**
  - Only `transform` and `opacity` animate, using the tokens `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`, `--ease-in: cubic-bezier(0.7, 0, 0.84, 0)`, `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)` and `--dur-micro: 120ms`.
  - Under `prefers-reduced-motion: reduce`, nothing moves.
- **Widths.** Every screen renders at 320, 375, 414 and 768px with no sideways page scroll. Use `overflow-x: clip` on `html` and `body`, never `hidden`. Tappable text never wraps to two lines, and display text uses `overflow-wrap: anywhere; min-width: 0`.
- **Hallmark gates.** Before each pull request is opened, run gates 1–5, 7, 10–17, 19, 22–27, 30, 33, 34, 36–41, 46–51, 53, 55 and 56 from `~/.claude/skills/hallmark/references/slop-test.md`, plus its six-axis self-critique. Paste the result into the PR body.
- **Copy.** New strings use typographic quotes and apostrophes (`’`, `“ ”`). Existing strings, and the tests that query them, keep theirs.
- **Private data.** Never use titles, reviews or ratings from `storygraph_export.csv` in fixtures, previews or screenshots. Never print or commit `.dev.vars`. Use public-domain books.
- **Tests.**
  - Testing Library, by role and visible text; no snapshot tests.
  - A cover tile's text is `aria-hidden`, but `getByText` still finds it. Where a tile repeats a title, query by role.
  - Run `pnpm test:client` for each task. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` must pass before each PR.
- **Pull requests.**
  - Each PR is a branch off the previous one: `design-1-look` off `design-round`, `design-2-shell` off `design-1-look`, `design-3-walls` off `design-2-shell`, `design-4-book` off `design-3-walls`.
  - Open each with `gh pr create --base <previous branch>`. When James merges the previous one, retarget with `gh pr edit <n> --base main`.
  - Never push to `main`, merge, tag, deploy or run a remote write (`AGENTS.md`).
  - PR bodies end with the session's attribution lines.
- **Releasable after every merge.** CI deploys the newest annotated tag on `main`, so after each PR the app works end to end.

## Review Focus

1. **Awkward titles.**
   - A title that is only an article ("The"), starts with punctuation or a digit ("'Salem's Lot", "1984", "¿Quién?"), or carries combining accents ("Émile") must still sort and group without an empty key.
   - Leading punctuation and digits go under "#"; "Émile" goes under E.
   - Pinned in Task 8.
2. **Very long unbroken titles.**
   - A 90-character title with no spaces, or a German compound, must wrap inside the cover tile, the book page `h1` and the requests bar, with no sideways scroll at 320px.
   - Pinned by the preview screenshots in Tasks 3, 9 and 13.
3. **Removed members and placeholder people as names.** They go into "With …", "From …", the status line, the Friends rows and the back link. They must read through `personLabel` and `holderLabel` ("Sam (no longer a member)"). Pinned in Tasks 9, 12 and 13.
4. **Bad saved state.** Corrupt JSON, an unknown collection id, or storage that throws in `sessionStorage` must leave the wall at the top showing All, never crash or show nothing. Pinned in Task 10.
5. **Walls at the edges.**
   - Zero books, one book, 25 books under one letter, and a filter that matches nothing.
   - The rail appears only past 24 books **and** at least two letters, and "No books match." offers Show all.
   - Pinned in Task 9.

---

## PR 1 — `design-1-look`: tokens, type and covers

Branch `design-1-look` off `design-round`.

### Task 1: Split the stylesheet without changing anything

**Files:**
- Create: `src/client/styles/index.css` (only `@import`s), `src/client/styles/tokens.css`, `src/client/styles/base.css`, `src/client/styles/screens.css`, `src/client/styles/print.css`
- Create: `scripts/print-check.sh`
- Modify: `src/client/main.tsx:4`, `src/client/labelsheet/preview.tsx:6` (both import `./styles/index.css` / `../styles/index.css`)
- Delete: `src/client/index.css`

**Interfaces:**
- Produces: `src/client/styles/index.css` is the one stylesheet entry. Its import order is `tokens.css`, `base.css`, `screens.css`, then `print.css` **last**. Later tasks add files between `base.css` and `print.css`, never after.

- [ ] **Step 1: Record the label-sheet baseline from `main`.** Write `scripts/print-check.sh <out-dir>`:
  - Start `pnpm vite --port 5199 --strictPort` in the background.
  - Print `http://localhost:5199/src/client/labelsheet/preview.html?outlines` twice with headless Chrome (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --no-pdf-header-footer --print-to-pdf=<out>/light.pdf`, and again with `--force-dark-mode` to `<out>/dark.pdf`).
  - Rasterise both with `pdftoppm -r 150 -png`, then stop Vite.
  - Confirm `--force-dark-mode` takes effect by checking that `matchMedia('(prefers-color-scheme: dark)')` is true in a one-off headless run. If it doesn't take effect, use the flag that does and note it in the script.
  - Run it on a clean checkout of `main` (`git worktree add`) into `scratchpad/print-main/`.
- [ ] **Step 2: Move the rules.**
  - `index.css:1-26` (the tokens) goes to `tokens.css`.
  - `index.css:238-273`, `282-297` and `299-352` (the sheet, `@page label-sheet` and `@media print`) go **byte for byte** to `print.css`.
  - Everything else goes to `base.css` (element rules) or `screens.css` (`.copy-page`, `.pair-page`, `.labels-page` controls, `.label-code`, `.shelf-page`, `.import-page`), in their current order.
- [ ] **Step 3: Verify.**
  - `pnpm test:client`: all 655 pass.
  - `pnpm build`: OK.
  - `scripts/print-check.sh scratchpad/print-branch` produces the same number of pages as `scratchpad/print-main/`, and `magick compare -metric AE` reports `0` for every page, in light and in dark.
- [ ] **Step 4: Commit** with the message `refactor: split the stylesheet by area; label sheet rules move unchanged`.

### Task 2: The new tokens and type

**Files:**
- Modify: `src/client/styles/tokens.css`, `src/client/styles/base.css`, `src/client/styles/screens.css`, `package.json`, `pnpm-lock.yaml`
- Create: `src/client/styles/oklch.ts`, `src/client/styles/tokens.test.ts`

**Interfaces:**
- Produces:
  - **Colour tokens** (each defined on `:root` and again under `@media (prefers-color-scheme: dark)`): `--color-paper`, `--color-paper-2`, `--color-ink`, `--color-muted`, `--color-accent`, `--color-rule`, `--color-link`, `--color-link-visited`, `--color-alert-bg`, `--color-alert-ink`, `--color-tile`, `--color-tile-ink`, `--color-focus`.
  - **Font tokens:** `--font-display`, `--font-body`.
  - **Scales:** `--space-1`…`--space-8` (4px steps: 4, 8, 12, 16, 20, 24, 32, 48), `--text-sm`, `--text-base`, `--text-lg`, `--text-xl`, `--text-2xl`, `--text-3xl` (a 1.25 scale from 16px), plus the easing and duration tokens from Global Constraints.
  - **Function:** `contrast(fg: string, bg: string): number` in `oklch.ts`. It parses `oklch(L% C H)` strings and returns the WCAG 2.1 ratio.

- [ ] **Step 1: Write the failing test.** `tokens.test.ts` reads `tokens.css` as text with `node:fs` and pulls the custom properties out of the `:root` block and out of the dark block separately. For **each** setting it asserts:
  - `contrast(ink, paper) >= 4.5`, `contrast(muted, paper) >= 4.5`, `contrast(muted, paper-2) >= 4.5` and `contrast(accent, paper) >= 4.5`;
  - `contrast(link, paper) >= 4.5`, `contrast(link-visited, paper) >= 4.5` and `contrast(alert-ink, alert-bg) >= 4.5`;
  - `contrast(paper, ink) >= 4.5` (an ink-filled button) and `contrast(tile-ink, tile) >= 4.5`;
  - `contrast(focus, paper) >= 3` and `contrast(rule, paper) >= 1.2` (hairlines are decorative except where noted).

  Also a sanity check: `contrast("oklch(20% 0.012 60)", "oklch(98% 0.005 75)")` is between 17.0 and 17.2.
- [ ] **Step 2: Run it.** `pnpm test:client src/client/styles/tokens.test.ts` should FAIL (the tokens are missing).
- [ ] **Step 3: Implement.**
  - `oklch.ts`: convert OKLCH to linear sRGB with the standard OKLab matrices, clamp, take relative luminance, and return `(L1+0.05)/(L2+0.05)`.
  - `tokens.css`:
    - Start from the spec's table under The look → Tokens (paper, ink, muted and accent per setting). Derive the rest on the same hue family (55–75), so the test passes, and write each pair's ratio in a comment.
    - Keep the old names (`--bg`, `--fg`, `--accent`, `--accent-fg`, `--alert-bg`, `--alert-fg`, `--cover-bg`, `--link`, `--link-visited`) as aliases of the new tokens until Task 15 removes them, so screens keep working.
  - `pnpm add @fontsource-variable/fraunces@5.3.0 @fontsource-variable/geist@5.3.0`, and import both in `styles/index.css` before `tokens.css`.
  - `base.css`:
    - `body` gets `font-family: var(--font-body)`, `background: var(--color-paper)`, `color: var(--color-ink)`, with weight 400 in light and 350 in dark.
    - `h1, h2, h3` get `font-family: var(--font-display); font-weight: 600; font-style: normal; overflow-wrap: anywhere; min-width: 0`.
    - `html, body { overflow-x: clip }`.
    - Buttons become ink-filled with paper text and an 8px radius.
    - Every button and link gets `:focus-visible` (`outline: 2px solid var(--color-focus); outline-offset: 2px`, no transition), plus `:active` (`transform: translateY(1px)`), `:disabled` (opacity 0.5 and `cursor: not-allowed`) and `@media (hover: hover)` hover rules.
  - Replace raw px spacing in `base.css` and `screens.css` with `--space-*` where it maps exactly. Leave layout widths alone.
- [ ] **Step 4: Verify.**
  - `pnpm test:client`: the new tests pass, and so do all 655 existing ones.
  - `scripts/print-check.sh`: 0 AE difference from `print-main`.
- [ ] **Step 5: Commit** with the message `feat: warm OKLCH tokens in both settings, Fraunces and Geist`.

### Task 3: `Cover` with three states, and the dev preview

**Files:**
- Modify: `src/client/screens/BookCard.tsx` (`Cover`), `src/client/screens/BookCard.test.tsx`, `src/client/screens/CopyPage.test.tsx:90,576-578`, `src/client/screens/Pair.test.tsx` and `src/client/App.test.tsx` (any query the tile's text makes ambiguous)
- Create: `src/client/styles/covers.css` (imported before `print.css`), `src/client/preview/preview.html`, `src/client/preview/preview.tsx`, `src/client/preview/fixtures.ts`

**Interfaces:**
- Produces:
  - `Cover(props: { url: string | null; title: string; authors: string[]; size?: "wall" | "row" | "hero" }): JSX.Element`.
  - The wrapper element is `aria-hidden="true"` and has `data-state="loaded" | "none" | "failed"`.
  - It keeps `loading="lazy"`, `referrerPolicy="no-referrer"`, `alt=""`, and explicit `width` and `height` on the `img`.
  - The preview page is a dev-only route at `/src/client/preview/preview.html?view=<name>`, rendering fixtures with no API. Later tasks add views to it.

- [ ] **Step 1: Write the failing tests** in `BookCard.test.tsx`:
  - `"a null cover shows the title tile"`: `Cover` with `url: null, title: "Beowulf", authors: []` renders the text "Beowulf" and no `img`, and doesn't render "Cover didn’t load".
  - `"a cover that fails to load says so"`: fire `error` on the `img`. Then "Cover didn’t load" is visible, along with the title.
  - `"a loaded cover has no tile text"`.
  - `"the cover is hidden from assistive tech"`: the wrapper has `aria-hidden="true"`.
- [ ] **Step 2: Run them.** `pnpm test:client src/client/screens/BookCard.test.tsx` should FAIL.
- [ ] **Step 3: Implement.**
  - `Cover` builds its tiles as the spec describes under Covers → Three states:
    - **No cover:** a `--color-tile` tile with the title in Fraunces and the first author in Geist.
    - **Failed:** the same tile, plus a `--color-muted` inset hairline and a "Cover didn’t load" line.
    - Each size has a fixed 2:3 box. `wall` and `row` use `object-fit: cover`; `hero` keeps the cover's own proportions within a max width and height.
  - Update `Book` and `ShelfList` to pass `title` and `authors`.
  - Update `CopyPage.test.tsx:90,576-578` to tell the states apart by visible text, not by `.cover-missing`.
  - Switch the queries the antagonist found ambiguous (four in `Pair.test.tsx`, one in `App.test.tsx`, all "Found multiple elements") to role queries. Change nothing else in those tests.
- [ ] **Step 4: Build the preview.**
  - `preview.html` and `preview.tsx` mirror `labelsheet/preview.tsx`: a dev-only page, imported from `../styles/index.css`, and not added to the build's inputs.
  - Its view `covers` shows every state at every size.
  - Fixtures use public-domain editions with **real** cover URLs. Find them by querying Open Library (`https://covers.openlibrary.org/b/isbn/<isbn>-M.jpg`) and Google Books (`https://www.googleapis.com/books/v1/volumes?q=isbn:<isbn>`, then `googleCover`'s rules) for a few public-domain titles. Include one 90-character unbroken title.
- [ ] **Step 5: Do the sharpness check.**
  - Screenshot the preview at 375px wide with a device scale factor of 3: `--headless --screenshot --window-size=375,812 --force-device-scale-factor=3`.
  - Judge the `hero` size. If the covers look soft, add `largerCover(url: string): string` in `src/client/covers.ts`, which rewrites Open Library `-M.jpg` to `-L.jpg` and passes every other URL through. Use it only for `size="hero"`, with `onError` falling back to the stored URL before showing the failed tile. Add a test for the fallback.
  - Record what you decided, and attach a screenshot, in the PR body for James.
- [ ] **Step 6: Verify.**
  - `pnpm test:client`: all pass.
  - Screenshots of `?view=covers` at 320, 375, 414 and 768px, light and dark (`--force-dark-mode`), show no sideways scroll and the long title wrapping.
  - `scripts/print-check.sh`: 0 AE difference.
- [ ] **Step 7: Commit** with the message `feat: cover tiles for no cover and a failed load; dev preview page`.

**PR 1:** run the Hallmark gates, then `gh pr create --base design-round` with the title "Design round 1: tokens, type and covers". In the body put the print-check result, the sharpness decision and screenshots, and the gate results.

---

## PR 2 — `design-2-shell`: tab bar and More

Branch `design-2-shell` off `design-1-look`.

### Task 4: Routes and the route-to-tab map

**Files:**
- Modify: `src/client/route.ts`, `src/client/route.test.ts`
- Create: `src/client/shell.tsx`, `src/client/shell.test.tsx`

**Interfaces:**
- Produces:
  - In `route.ts`: `Route` gains `{ name: "more" }`, and `matchRoute("/more")` returns it.
  - In `shell.tsx`:
    - `type Tab = "books" | "holding" | "friends" | "more"`.
    - `tabFor(route: Route): Tab | null`. Data-dependent routes (`copy`, `copy-by-id`, `shelf`) and `not-found` return `null`.
    - `tabRoot: Record<Tab, { href: string; label: string }>`, which is `{ books: {"/", "My books"}, holding: {"/holding", "Holding"}, friends: {"/members", "Friends"}, more: {"/more", "More"} }`.
    - `const APP_NAME = "Natalie's Little Library"`.
    - `ShellContext`, a React context of `{ setTab(tab: Tab | null): void; setSignedOut(on: boolean): void }` with no-op defaults.
    - `useTab(tab: Tab | null | undefined): void`. It calls `setTab` once, the first time it receives a value that isn't `undefined`, and never again for that mount.

- [ ] **Step 1: Write the failing tests.**
  - `route.test.ts`: `"/more"` maps to more.
  - `shell.test.tsx`, `tabFor`:
    - `home` and `mine` give books;
    - `holding` gives holding;
    - `members` and `member` give friends;
    - `more`, `pair`, `labels`, `import` and `people` give more;
    - `copy`, `copy-by-id` and `shelf` give null.
  - `shell.test.tsx`, `useTab`: it calls `setTab` exactly once across re-renders with changing values.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run them.** They should PASS.
- [ ] **Step 5: Commit** with the message `feat: more route and the route-to-tab map`.

### Task 5: `TabBar` and the App shell

**Files:**
- Create: `src/client/TabBar.tsx`, `src/client/TabBar.test.tsx`, `src/client/styles/shell.css`
- Modify: `src/client/App.tsx`, `src/client/App.test.tsx`, `src/client/screens/SignIn.tsx`, `index.html` (viewport meta gets `viewport-fit=cover`)

**Interfaces:**
- Consumes: `Tab`, `tabFor`, `tabRoot`, `ShellContext` (Task 4).
- Produces:
  - `TabBar(props: { active: Tab | null }): JSX.Element`. It renders `<nav aria-label="Main" className="tab-bar app-chrome">` with four links in order: My books → `/`, Holding → `/holding`, Friends → `/members`, More → `/more`. Each link's visible label is `Books`, `Holding`, `Friends` or `More`. Only the active one has `aria-current="page"`.
  - `SignIn` calls `setSignedOut(true)` on mount and `setSignedOut(false)` on unmount.

- [ ] **Step 1: Write the failing tests.**
  - `TabBar.test.tsx`:
    - four links with the hrefs above;
    - `aria-current="page"` only on the active one;
    - none current when `active` is null;
    - each icon is an inline `svg` with `aria-hidden="true"`.
  - `App.test.tsx`:
    - signed in at `/holding`, the Main navigation is present and Holding is current;
    - signed out at `/`, no Main navigation;
    - signed in at `/holding` with the screen's load answering 401 (the screen falls back to `SignIn`), the Main navigation goes away;
    - while `getMe` is pending, no navigation;
    - at `/b/x`, no tab is current until the screen calls `setTab`.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
  - `App` holds `tab` (initially `tabFor(route)`) and `signedOut` state, and provides `ShellContext`.
  - It renders `<TabBar active={tab} />` after the screen when `member !== null && !signedOut && !trouble`.
  - `#root` gets bottom padding for the bar (`calc(var(--tab-bar-h) + env(safe-area-inset-bottom))`) only while the bar is shown, through a class on `#root`. It never goes on `body`.
  - `shell.css`:
    - the bar is fixed to the bottom, with paper background, a top hairline and safe-area padding on the bottom, left and right;
    - 44px or taller targets;
    - the active tab uses `--color-accent`, a filled icon variant and weight 600, so it differs by more than colour.
  - The icons are hand-drawn 24×24 SVGs with a 1.6 stroke, one shared style. The active one gets `fill: currentColor` on its `.fill` paths.
- [ ] **Step 4: Verify.**
  - `pnpm test:client`: all pass.
  - `scripts/print-check.sh`: 0 AE difference, and the bar is absent from the PDFs.
- [ ] **Step 5: Commit** with the message `feat: tab bar, hidden when signed out or the session is lost`.

### Task 6: More replaces Home; `/` shows My books

**Files:**
- Create: `src/client/screens/More.tsx`, `src/client/screens/More.test.tsx`
- Delete: `src/client/screens/Home.tsx`, `src/client/screens/Home.test.tsx` (move any still-meaningful cases to `More.test.tsx`)
- Modify: `src/client/App.tsx`, `src/client/App.test.tsx`, `src/client/screens/BackLink.tsx`

**Interfaces:**
- Produces: `More(props: { member: Member | null; returnTo: string; notice?: string; onLogout: () => void })`.

- [ ] **Step 1: Write the failing tests.** `More.test.tsx`:
  - signed in, it shows `h1` "More", the text "Hi, Natalie", and links in order: Pair a book `/pair`, Print labels `/labels`, People `/people`, Import from StoryGraph `/import`;
  - a "Sign out" button calls `onLogout`;
  - `notice` shows as `role="alert"` above Sign out;
  - signed out, it shows `SignIn`.

  `App.test.tsx`:
  - `/` signed in renders the My books screen (today's `Mine`);
  - `/mine` calls `history.replaceState(null, "", "/")` and renders the same;
  - a failed logout shows "Couldn't sign out. Check your connection and try again." on `/more`.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
  - `route.name === "home" || "mine"` renders `Mine`, with `replaceState` for `mine`. `more` renders `More` with the logout wiring that Home had.
  - `BackLink` points to `/` with the text "Back to my books".
  - Delete `Home`.
- [ ] **Step 4: Run them.** `pnpm test:client` should pass.
- [ ] **Step 5: Commit** with the message `feat: More screen; home is My books`.

### Task 7: Each screen's own `h1`

**Files:**
- Modify: `src/client/screens/{Mine,Holding,Members,Shelf,CopyPage,Pair,Labels,People,NotFound}.tsx` and their tests

**Interfaces:**
- Consumes: `APP_NAME` (Task 4).

- [ ] **Step 1: Update the tests first.** Each screen's `h1` is:

  | Screen | `h1` |
  |---|---|
  | Mine | "My books" |
  | Holding | "Holding" (its `h2` "What I'm holding" goes) |
  | Members (list) | "Friends" |
  | Members (`:id`) | the member's name |
  | Shelf | the collection's name (today's `h2` becomes the `h1`, and keeps its focus-after-rename `ref`) |
  | CopyPage | the book's title for `copy` and `public` views; otherwise `APP_NAME` |
  | Pair | "Pair a book" |
  | Labels | "Print labels" |
  | Import | "Import from StoryGraph" (unchanged) |
  | People | "People" |
  | NotFound | `APP_NAME` |
  | Any screen showing `SignIn` | `APP_NAME` |

  Assert each with `getByRole("heading", { level: 1, name })`.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
  - `CopyPage`'s book title is currently `Book`'s `h2`. Make `Book` take `headingLevel?: 1 | 2` (default 2) and pass 1 from `CopyPage`. Its separate `heading` goes away when a book is shown.
  - `CopyPage` and `Shelf` call `useTab` once loaded:
    - **CopyPage:** `books` if `copy.owner?.id === member.id`; `holding` if `copy.holder` is the member; `friends` otherwise. For blank, unknown and retired labels, `books`.
    - **Shelf:** `books` if `owner.id === member.id`, else `friends`.
- [ ] **Step 4: Run them.** `pnpm test:client`: all pass.
- [ ] **Step 5: Commit** with the message `feat: each screen titles itself; book and collection pages pick their tab`.

**PR 2:** run the Hallmark gates and the print check, then `gh pr create --base design-1-look` with the title "Design round 2: tab bar and More".

---

## PR 3 — `design-3-walls`: walls of covers

Branch `design-3-walls` off `design-2-shell`.

### Task 8: The wall model

**Files:**
- Create: `src/client/wall/model.ts`, `src/client/wall/model.test.ts`

**Interfaces:**
- Produces:
  - **Sorting and grouping:**
    - `sortKey(title: string): string` drops a leading `The`, `A` or `An` followed by whitespace (case-insensitive), and returns the title unchanged if that would leave it empty.
    - `letterOf(title: string): string` takes the first character of `sortKey`, NFD-normalised with combining marks removed and upper-cased. A–Z stays as it is; anything else becomes `"#"`.
    - `groupByLetter<T extends { book: { title: string } }>(items: T[]): { letter: string; items: T[] }[]` returns groups in A…Z then `#` order, with only non-empty groups. Within a group, items are sorted by `sortKey` with `new Intl.Collator("en", { sensitivity: "base", numeric: true })`, ties broken by `copyId`.
  - **Filtering:**
    - `type Status = "all" | "home" | "out" | "unlabelled"`.
    - `type WallFilter = { status: Status; collectionId: string | null }`.
    - `const ALL: WallFilter = { status: "all", collectionId: null }`.
    - `applyFilter(items: ShelfItem[], f: WallFilter): ShelfItem[]`. `home` keeps `item.home`; `out` keeps `!item.home`; `unlabelled` keeps `!item.labelled`; a collection keeps `item.collection?.id === f.collectionId`.
  - **The rail:**
    - `const RAIL_MARKS: readonly string[]` holds the 27 marks A…Z then `#`.
    - `markAt(offsetY: number, height: number): string` clamps to the first and last mark.
    - `targetLetter(mark: string, present: string[]): string | null` returns `mark` if present, otherwise the next present letter after it in `RAIL_MARKS` order, otherwise the last present letter, otherwise null.
    - `showRail(itemCount: number, groupCount: number): boolean` is `itemCount > 24 && groupCount >= 2`.
  - **Count line:** `countLine(items: ShelfItem[], owner: boolean): string` returns "1 book" or "{n} books", and when `owner` and some are out, appends " · {k} lent out".

- [ ] **Step 1: Write the failing tests.**
  - `sortKey("The Call of the Wild") === "Call of the Wild"`, and `sortKey("The") === "The"`.
  - `letterOf("Émile")` is "E"; `letterOf("'Salem's Lot")`, `letterOf("1984")` and `letterOf("¿Quién?")` are "#"; `letterOf("an apple")` is "A".
  - Grouping is identical with the collator's locale mocked to `"sv"`: wrap `Intl.Collator` with a spy that records the locale and assert `"en"`.
  - `#` comes last.
  - "Book 2" sorts before "Book 10".
  - `applyFilter` covers each status, and a collection combined with `out`.
  - `markAt(0, 270) === "A"`, `markAt(269, 270) === "#"`, `markAt(-5, 270) === "A"` and `markAt(999, 270) === "#"`.
  - `targetLetter("C", ["A","D"]) === "D"`, `targetLetter("Z", ["A","D"]) === "D"` and `targetLetter("A", []) === null`.
  - `showRail(25, 2)` is true; `showRail(24, 5)` and `showRail(25, 1)` are false.
  - `countLine` gives "1 book", "248 books · 3 lent out", and "5 books" when not the owner.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run them.** They should PASS.
- [ ] **Step 5: Commit** with the message `feat: wall model: sort, group, filter and rail maths`.

### Task 9: `CoverWall` and `AlphaRail`

**Files:**
- Create: `src/client/wall/CoverWall.tsx`, `src/client/wall/CoverWall.test.tsx`, `src/client/wall/AlphaRail.tsx`, `src/client/wall/AlphaRail.test.tsx`, `src/client/styles/wall.css`
- Modify: `src/client/preview/preview.tsx` (add `?view=wall`)

**Interfaces:**
- Consumes: Task 8 model; `Cover` (Task 3); `personLabel` and `holderLabel` (`BookCard.tsx`).
- Produces:
  - `type WallKind = "mine" | "friend" | "holding" | "my-collection" | "friend-collection"`.
  - `CoverWall(props)`, with these props:
    - `kind: WallKind`;
    - `title: string` (rendered as the `h1`);
    - `items: ShelfItem[]`;
    - `collections?: CollectionRef[]`;
    - `top?: ReactNode`, for alerts and the requests bar, rendered between the count line and the chips;
    - `incomplete?: boolean`, which hides the count line;
    - `onNewCollection?: () => void`;
    - `filter: WallFilter` and `onFilter(f: WallFilter): void`, so the filter is controlled (Task 10 persists it);
    - `empty: ReactNode`, what to show when `items` is empty;
    - `loading?: boolean`, which shows a skeleton instead of the wall.
  - `AlphaRail(props: { present: string[]; onPick(letter: string): void })`.

- [ ] **Step 1: Write the failing tests** in `CoverWall.test.tsx`, using `shelfFixtures`:
  - It shows the `h1` and the count line, and hides the count line when `incomplete`.
  - Each letter group is an `h2` with `id="letter-<L>"` (`#` → `letter-hash`).
  - Each book is a link to `/copies/<id>`, whose accessible name is "{title}, {authors joined by ", "}" through visually hidden text.
  - **Notes under covers:**
    - `mine`: "With Ann" when out, nothing when home;
    - `holding`: "From Ann", or "No owner" when `owner` is null;
    - `friend`: "Out" when not home.
    - A removed holder reads "With Sam (no longer a member)".
  - **Chips:**
    - `mine` has All, At home, Lent out and No label, each a toggle button with `aria-pressed`, plus a "Collection" menu button with `aria-haspopup="menu"`.
    - `friend` has All and At home plus the menu.
    - `holding`, `my-collection` and `friend-collection` have no chips.
  - **Filter clicks:** "Lent out" calls `onFilter({status:"out", collectionId:null})`, and "All" calls it with `status: "all"` while keeping `collectionId`.
  - **The Collection menu:**
    - It opens a `menu` with "All collections" then each collection.
    - For `mine` it also has "New collection…", which calls `onNewCollection`.
    - With a collection picked, `mine`'s menu also has a "Manage {name}" link to `/collections/<id>`.
  - **Empty and filtered-empty:**
    - With an empty filtered result, it shows "No books match." and a "Show all" button that calls `onFilter(ALL)`.
    - With an empty `items`, it shows `empty`.
  - **The rail:** it renders only when `showRail` holds (test 24 vs 25 items, and 25 under one letter).
- [ ] **Step 2: Write the failing tests** in `AlphaRail.test.tsx`:
  - It is `aria-hidden="true"` and has `touch-action: none` set inline.
  - `pointerdown` at a `clientY` maps through `getBoundingClientRect` (mocked) to `onPick(targetLetter(...))`, and calls `setPointerCapture`.
  - Marks not in `present` carry `data-empty`.
- [ ] **Step 3: Run them.** They should FAIL.
- [ ] **Step 4: Implement.**
  - `CoverWall`:
    - It renders `applyFilter`, then `groupByLetter`.
    - The grid is `repeat(3, minmax(0, 1fr))` and widens to 4–5 columns from 40rem.
    - Only the chips row is `position: sticky; top: 0`, and each letter heading has `scroll-margin-top` set to the chips row's height.
    - `onPick` calls `document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "instant" })`. Mock `scrollIntoView` in the tests.
    - Add a `loading?: boolean` prop. While it's true, the wall shows a skeleton of nine tile-shaped blocks with no `<img>` (`aria-hidden`), and no chips or rail. The screens in Task 11 pass it while their read is in flight. Test it.
  - `AlphaRail` sits fixed between the chips row and the tab bar, inside `env(safe-area-inset-right)`, with a hit strip at least 44px wide.
    - It handles `pointerdown` and `pointermove` (with capture) and `pointerup` and `pointercancel`.
    - It scrolls instantly while dragging, and shows a bubble with the current letter (`aria-hidden`).
    - Empty marks are smaller and lighter, not just a different colour.
  - Add `?view=wall` to the preview, with 60 public-domain fixture books across many letters, one no-cover, one failed and one 90-character title.
- [ ] **Step 5: Verify.**
  - `pnpm test:client`: all pass.
  - Preview screenshots at 320, 375, 414 and 768px, light and dark, show no sideways scroll and no wrapped chip labels.
  - On a 320px screenshot, at least two full rows of covers show below the chips.
- [ ] **Step 6: Commit** with the message `feat: CoverWall and AlphaRail`.

### Task 10: Keep your place on a wall

**Files:**
- Create: `src/client/wall/memory.ts`, `src/client/wall/memory.test.ts`

**Interfaces:**
- Produces:
  - `loadPlace(key: string): { filter: WallFilter; scrollY: number } | null`. It returns null on a missing value, bad JSON, a wrong shape, or storage that throws.
  - `savePlace(key: string, place: { filter: WallFilter; scrollY: number }): void` swallows errors.
  - `useWallPlace(key: string, ready: boolean, collectionIds: string[]): [WallFilter, (f: WallFilter) => void]`:
    - It initialises from `loadPlace`, dropping a `collectionId` not in `collectionIds`.
    - It sets `history.scrollRestoration = "manual"`.
    - It saves `{ filter, scrollY: window.scrollY }` on `pagehide` and on unmount.
    - Once `ready` first becomes true, it restores `window.scrollTo(0, scrollY)` in a layout effect.
  - The key is `wall:${location.pathname}`.

- [ ] **Step 1: Write the failing tests.**
  - Round trip.
  - Bad JSON, `{ filter: 5 }` and a throwing `Storage.prototype.getItem` each give null.
  - A throwing `setItem` doesn't throw.
  - The hook restores the filter.
  - The hook drops an unknown `collectionId`.
  - The hook calls `scrollTo(0, 840)` only after `ready` becomes true.
  - The hook saves on `pagehide`.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run them.** They should PASS.
- [ ] **Step 5: Commit** with the message `feat: walls remember chips and scroll for the visit`.

### Task 11: My books, Holding, collections and friends' walls on `CoverWall`

**Files:**
- Create: `src/client/wall/load.ts`, `src/client/wall/load.test.ts`
- Modify: `src/client/screens/Mine.tsx`, `Mine.test.tsx`, `Holding.tsx`, `Holding.test.tsx`, `Shelf.tsx`, `Shelf.test.tsx`, `Members.tsx` (the `:id` branch), `Members.test.tsx`, `src/client/screens/ShelfList.tsx` (move `BookCount` to `BookCard.tsx` if `ShelfList` users drop to People only)

**Interfaces:**
- Consumes: `CoverWall` (Task 9); `useWallPlace` (Task 10); `getShelf`, `myCollections`, `memberCollections`, `getHolding`, `listRequests`, `approveRequest`, `declineRequest`, `createCollection` (`api.ts`).
- Produces:
  - `loadShelves(collections: CollectionSummary[]): Promise<{ items: ShelfItem[]; failed: number }>`.
    - It reads each collection with `getShelf`. A 404 is skipped, a 401 is rethrown, and anything else counts toward `failed`.
    - It throws a plain `Error("all failed")` only when every read failed and there was at least one collection.

- [ ] **Step 1: Write the failing tests.**
  - `load.test.ts`: all succeed; one 404 is skipped; one 500 gives `failed: 1`; all fail rejects; a 401 rejects with the `ApiError`.
  - `Mine.test.tsx`, rewritten to match:
    - **Loading:** `/` shows "My books" with every collection's items merged.
    - **Partial failure:** one shelf fails, so it shows `role="alert"` "Some books couldn't load." with Try again, and no count line.
    - **Requests:** they show as a button "1 request". Pressing it reveals the existing approve and decline list, wording and confirm unchanged. A failed requests read shows "Couldn't load requests."
    - **New collection:** "New collection…" from the menu reveals the existing create form. Its errors and wording are unchanged.
    - **Empty:** an empty wall says "You haven’t added any books yet." with links "Pair a book" `/pair` and "Import from StoryGraph" `/import`. For a member who owns no books it also links "Friends" `/members` and "Holding" `/holding` **(spec: friends with no books)**.
  - `Holding.test.tsx`: the wall with "From Ann", "No owner" for an owner-less book, and empty "You aren’t holding anyone’s books."
  - `Shelf.test.tsx`:
    - The owner sees Rename, Make this the default and Delete above a `my-collection` wall, with behaviour and tests unchanged.
    - A visitor sees a `friend-collection` wall.
  - `Members.test.tsx` (`:id`):
    - "{name}" shows as the `h1` over a `friend` wall merged from `memberCollections` and then `getShelf` for each.
    - Partial failure works as in Mine.
    - Zero collections shows "No books here yet."
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
  - Each screen wires `useWallPlace` with the `ready` flag set once its data has loaded.
  - Mine's "only unlabelled" toggle goes away, because the No label chip replaces it.
- [ ] **Step 4: Verify.**
  - `pnpm test:client`: all pass.
  - `scripts/print-check.sh`: 0 AE difference.
- [ ] **Step 5: Commit** with the message `feat: my books, holding, collections and friends' shelves are walls of covers`.

### Task 12: The Friends list

**Files:**
- Modify: `src/client/screens/Members.tsx` (the list branch), `Members.test.tsx`
- Create: `src/client/screens/Avatar.tsx`

**Interfaces:**
- Produces: `Avatar(props: { person: Person; size: number })`. It shows an `img` with `referrerPolicy="no-referrer"` and `alt=""`. When `pictureUrl` is null or the image errors, it falls back to the initial on an accent disc (with `--color-paper` text measured at 4.5:1 or better, so add that pair to `tokens.test.ts`).

- [ ] **Step 1: Write the failing tests.**
  - The `h1` is "Friends". Each row is a link to `/members/<id>`, named with the person's name through `personLabel`, and shows "{n} books": the sum of `memberCollections(id)` counts, fetched after the list.
  - A row whose count fails shows no count, and the other rows still show theirs.
  - A picture that fires `error` shows the initial.
  - With no one else, it shows "No one else is here yet."
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.** Rows are 44px or taller, with a hairline between them. There is no cover strip.
- [ ] **Step 4: Run them.** They should PASS.
- [ ] **Step 5: Commit** with the message `feat: friends list with pictures and book counts`.

**PR 3:** run the Hallmark gates, the print check and the preview screenshots, then `gh pr create --base design-2-shell` with the title "Design round 3: walls of covers".

---

## PR 4 — `design-4-book`: book page, the rest, phone setup

Branch `design-4-book` off `design-3-walls`.

### Task 13: The cover-first book page

**Files:**
- Create: `src/client/book/model.ts`, `src/client/book/model.test.ts`, `src/client/styles/book.css`
- Modify: `src/client/screens/CopyPage.tsx`, `CopyPage.test.tsx`, `src/client/preview/preview.tsx` (add `?view=book`)

**Interfaces:**
- Consumes: `matchRoute` (`route.ts`); `tabRoot` and `Tab` (Task 4); `Cover` with `size="hero"` (Task 3).
- Produces:
  - `MAIN_ORDER: ActionType[]` is `["claim","return","adopt","approve","lend","request","withdraw"]`.
  - `mainAction(actions: ActionType[], code: string | null): ActionType | null` returns the first of `MAIN_ORDER` in `actions`, skipping `claim` and `adopt` when `code === null`.
  - `backFor(referrer: string, origin: string, copy: CopyView, tab: Tab): { href: string; label: string }`:
    - A same-origin referrer whose `matchRoute(pathname)` is:
      - `home` or `mine` → `{ "/", "My books" }`;
      - `holding` → `{ "/holding", "Holding" }`;
      - `member` with `id === copy.owner?.id` → `{ "/members/<id>", "<personLabel(owner)>’s books" }`;
      - `shelf` with `id === copy.collection?.id` → `{ "/collections/<id>", collection.name }`.
    - Anything else, including a malformed referrer, gives `tabRoot[tab]`.

- [ ] **Step 1: Write the failing tests.**
  - `model.test.ts`:
    - `mainAction(["lend","give"], "c")` is "lend".
    - `mainAction(["claim","request"], null)` is "request".
    - `mainAction(["give","move"], "c")` is null.
    - `backFor` covers each referrer kind: another origin, an empty string, `"not a url"`, a `member` whose id isn't the owner, and a removed owner's name.
  - `CopyPage.test.tsx`:
    - **Order:** the `h1` is the title, then the authors, then the status line. The status line is "At home", or "With Sam", plus "· Natalie’s book" for non-owners and "No one owns this book." for none.
    - **Owner extras:** the owner sees "In {collection} · Label {code}".
    - **Buttons:** exactly one main button (the `mainAction` one), with the other allowed actions as row buttons or links (label and relabel stay links to `/pair`). With no main action, there's no main button.
    - **Flows unchanged:** lend, give, approve, release and move keep their existing tests unchanged.
    - **Back link:** its href and text come from `backFor`. Mock `document.referrer` with `Object.defineProperty`.
    - **Signed out:** there is no back link, and `SignIn` appears in the main button's place.
    - **Tab:** `useTab` is called with owner → books, holder → holding, otherwise friends; blank, unknown and retired labels → books.
- [ ] **Step 2: Run them.** They should FAIL.
- [ ] **Step 3: Implement.**
  - Lay out `Copy` and the `public` view as the spec describes under A book's page. The hero cover is about 150–180px wide and centred, and the main button is full width and ink-filled.
  - Row actions are 44px or taller with a chevron and hairlines.
  - History goes under an `h2` "History".
  - The flows' markup keeps its wording; only classes change.
  - Add `?view=book` (owner, friend, signed-out and no-owner variants) to the preview.
- [ ] **Step 4: Verify.**
  - `pnpm test:client`: all pass.
  - Preview screenshots at 320, 375, 414 and 768px, light and dark, with the 90-character title, show it wrapping and no sideways scroll.
- [ ] **Step 5: Commit** with the message `feat: cover-first book page with one main action and a real back link`.

### Task 14: Restyle Pair, Labels, Import and People

**Files:**
- Modify: `src/client/styles/screens.css`, `src/client/screens/{Pair,Labels,Import,People}.tsx` (class names only where needed) and their tests only if wording or structure changes (it shouldn't)

- [ ] **Step 1: Restyle.**
  - Forms, selects, fieldsets, field errors and alerts move onto the tokens, the spacing scale and the eight states. Inputs get visible labels above them, error text below, and `aria-invalid` where there's an error.
  - The scanner's video and overlay sizing (`Scanner.tsx:174`) and the label preview's `.sheet-area` don't change.
  - `.label-code` gets a monospace token. Add `--font-mono` with `ui-monospace` only if Geist Mono isn't added. Gate 37 allows three families at most.
- [ ] **Step 2: Remove the old token aliases** from `tokens.css` (`--bg`, `--fg`, `--accent-fg`, `--cover-bg`, …). `grep -rn "var(--\(bg\|fg\|accent-fg\|alert-fg\|cover-bg\|link\)\b" src/client` must find nothing outside `tokens.css`.
- [ ] **Step 3: Verify.**
  - `pnpm test:client`: all pass, with no test edits beyond class-free queries.
  - `scripts/print-check.sh`: 0 AE difference.
  - Screenshots of the Labels and Pair screens aren't possible without signing in, so add `?view=forms` to the preview, rendering the shared form controls in every state, and screenshot it at 320 and 768px, light and dark.
- [ ] **Step 4: Commit** with the message `feat: pair, labels, import and people in the new look`.

### Task 15: Phone setup

**Files:**
- Create: `public/manifest.webmanifest`, `public/icons/icon.svg`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/apple-touch-icon.png`
- Modify: `index.html`

- [ ] **Step 1: Draw the icon.** `icon.svg` is a simple mark in the light tokens' rust on paper, with no text and no emoji. Rasterise it with `magick -background none icon.svg -resize 192x192 icon-192.png` (and at 512 and 180).
- [ ] **Step 2: Write the manifest:**

  ```json
  { "name": "Natalie’s Little Library", "short_name": "Little Library", "start_url": "/", "display": "browser",
    "background_color": "<light paper as hex>", "theme_color": "<light paper as hex>",
    "icons": [{ "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
              { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }] }
  ```

  The hex values are the light `--color-paper` converted with `oklch.ts`. Put the conversion in a comment in the PR.
- [ ] **Step 3: Update `index.html`.**
  - `<link rel="manifest">` and `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`.
  - Two `<meta name="theme-color" media="(prefers-color-scheme: light|dark)">`, one with each setting's paper.
  - `<meta name="color-scheme" content="light dark">`.
- [ ] **Step 4: Verify.**
  - `pnpm build`: `dist/client` contains `manifest.webmanifest` and `icons/`.
  - `pnpm test`: passes.
- [ ] **Step 5: Commit** with the message `feat: manifest, home-screen icon and theme colour`.

**PR 4:**
- Run the Hallmark gates, the print check and the preview screenshots.
- Then `gh pr create --base design-3-walls` with the title "Design round 4: book page, the rest, phone setup".
- In the body, list **James's phone checks**:
  - the label sheet on real Avery sheets;
  - the A–Z rail drag on an iPhone;
  - whether the home-screen icon opens in Safari or as a separate web app (iOS 26). If it opens as a web app, a follow-up adds the one-line tip to More, per the spec.
  - going back to a wall keeps your place;
  - both light and dark settings.
