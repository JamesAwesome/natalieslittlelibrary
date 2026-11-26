# Design round: walls of covers

Drafted 2026-11-26 from James's answers in a brainstorm with mockups. It comes
before roadmap step 5 ("Open up"). It is the first of two releases: this one
is client-only; the second adds cover photos (see "Release 2" at the end).
Calls made without James are marked **(call)**.

## Why

James wants the app to feel like reading apps such as Apple Books and Kindle.
In his words, what he wants from them is "browsing walls of covers, simple
filtering and quick scanning by alphabet". Today the app is a stack of eight
equal buttons on Home, and books appear only as small rows in lists.

The genre is something to learn from, not copy: no names, icons, artwork or
look taken from either app.

## What James decided

- **Who lands where.** Everyone opens on their own wall of books.
- **The wall.** Covers three across, grouped under letter headings (A, B,
  C…), with an A–Z rail down the right edge to drag a thumb along (mockup
  option A of three).
- **Getting around.** A tab bar along the bottom: Books · Holding · Friends ·
  More (option A of three).
- **The look.** Near-white with warm greys and a rust highlight in the light
  setting. A warm dark brown "evening shelf" with an amber highlight in the
  dark setting. One colour family across both, so the app feels the same when
  the phone flips (pair 2 of three; he first picked a cool light look, then
  chose the warm pair once the mismatch was shown).
- **Type.** Fraunces for titles, letter headings and screen titles; Geist for
  everything else; the same in both settings (pairing 1 of two).
- **A book's page.** Cover first: a big cover at the top, then title, where
  the book is, one main button, the owner's other actions as a short list, and
  history at the bottom (option A of two).
- **Cover photos wait.** Taking a photo of a book with no cover is release 2.
  It is the only part that needs the server.
- **The playback was accepted as a whole** ("good"). It covered the four tabs,
  Natalie's extras on her wall, the signed-out book page, the restyle of the
  other screens, the two cover states, phone setup and accessibility. All of
  those are below.
- **How to build it:** restyle in place, CSS split by area, as a short series
  of pull requests (approach A below).

## Goals

1. Every signed-in person lands on a wall of their own books, covers first.
2. Any wall can be filtered with a few chips and scanned by letter with the
   thumb.
3. The four tabs make your books, what you hold, friends and the tools one tap
   away from anywhere.
4. A book's page is built around its cover, for a friend who just scanned the
   label as much as for its owner.
5. A book with no cover and a cover that failed to load look deliberate, and
   different from each other.
6. On a phone, the app looks right saved to the home screen and matches the
   phone's light or dark setting.

## Non-goals

- New data about books: no genres, tags, ratings or reading status. Filters
  use only what the app already knows.
- Search by typing **(call)**. James asked for filtering and scanning by
  letter; a search box can come later.
- Any server change. No new routes, tables or bindings in this release.
- Cover photos (release 2).
- Changing what any action does, who may do it, or what it is called on the
  server.

## Anti-goals (a failure even if everything technically works)

- A printed label sheet comes out differently: the wrong alignment or font,
  or the tab bar printing on the page.
- The camera scanner gets slower or less reliable.
- Text drops below 4.5:1 contrast, or a tap target drops below 44px, in
  either setting.
- The app feels like two different apps in light and dark.
- Chrome competes with the covers: heavy colour, cards in cards, or
  decoration on the wall.
- Anything copied from Apple Books or Kindle: names, icons, artwork or their
  particular look.

## Constraints

- **Stack.** React 19 and Vite 8, no router library (`src/client/route.ts`
  `matchRoute`), and no new build tooling. The only new dependencies are two
  font packages.
- **Screens stay thin.** The rules live in the Worker. The client still shows
  only what `CopyView.actions` allows.
- **Label sheets and the scanner keep working.**
  - `src/client/labelsheet/` and `src/client/scanner/` keep their behaviour.
  - The label sheet's rules (today `index.css:140-352`: the sheet styles, `@page label-sheet` and `@media print`) move unchanged
    into their own file.
  - `labelsheet/preview.tsx` imports the stylesheet through the same entry as
    `main.tsx`.
- **Tests.** About 655 client tests use Testing Library by role and visible
  text. Changed wording and structure means updating them in the same pull
  request. Snapshot tests are not the habit here and are not added.
- **Private data.** No titles, reviews or ratings from `storygraph_export.csv`
  in mockups, fixtures or screenshots. Use public-domain books.
- **Phone first.** It must render well at 320, 375, 414 and 768px wide. It is
  also used on a laptop for printing labels, where the column simply stays
  centred.
- **Process.** Every change goes through a pull request from its own branch,
  and only James merges or tags (`AGENTS.md`).

## Approaches considered

- **A. Restyle in place, CSS split by area (chosen).** `index.css` becomes a
  few plain CSS files under `src/client/styles/`. New shared components:
  `TabBar`, `CoverWall` with an `AlphaRail`, `Cover`, and a cover-first book
  page layout. The screens are rewired onto them. It ships as four pull
  requests and one tag. It keeps the stack and adds no tooling. The cost is
  updating wording tests alongside each pull request.
- **B. Same, with CSS Modules per component.** Scoped styles can't leak into
  the label sheet. But every `className` in every screen changes, and the
  print rules are already isolated under `@media print`. Little gain for the
  churn.
- **C. Tailwind or a component library.** Dropped. It's a new build
  dependency that fights the existing tokens and rewrites every class string,
  and nothing asked for needs it.

## The design

### Routes and tabs

The path stays the source of truth. `matchRoute` keeps every existing path
and adds `/more`.

| Path | Shows | Active tab |
|---|---|---|
| `/` | Your wall (all your collections). Signed out: sign-in. | Books |
| `/mine` | Same as `/`; rewritten to `/` with `history.replaceState` **(call)** | Books |
| `/collections/:id` | That one collection's wall | Books if yours, else Friends |
| `/holding` | Wall of what you hold | Holding |
| `/members` | Friends list | Friends |
| `/members/:id` | That friend's wall (all their collections) | Friends |
| `/b/:code`, `/copies/:id` | A book's page | Books if you own it, Holding if you hold it, otherwise Friends **(call)** |
| `/more` | The More list (new) | More |
| `/pair`, `/labels`, `/import`, `/people` | As today, restyled | More |
| anything else | Not found | none |

- **Tab bar.**
  - It shows on every screen while signed in, and never while signed out.
  - It is a `<nav aria-label="Main">` of four links, with `aria-current="page"`
    on the active one.
  - It is fixed to the bottom, padded by `env(safe-area-inset-bottom)`, with
    `viewport-fit=cover` added to the viewport meta.
  - It carries the `app-chrome` class, so label printing hides it.
  - Each tab is a hand-drawn SVG icon from one stroke set, with a text label
    under it **(call)**. No emoji or Unicode glyphs.
- **Back.**
  - A book page shows a back link at the top. It goes back in history when the
    previous page was in the app, otherwise to its tab's root. It is labelled
    with where it goes ("‹ Books", "‹ Holding", "‹ Sam's books").
  - A book page reached by scanning a label has no in-app history, so its back
    link goes to the tab's root.
- **Home's buttons go.** Signed in, `/` is the wall.
  - The "Hi, {name}" line moves to the top of the More list.
  - Sign out moves to the end of the More list.
  - The `notice` that Home shows today (a `role="alert"` paragraph) shows above
    the wall instead.
- **Screen titles.** Each screen's `h1` is its own title ("My books",
  "Holding", "Friends", the friend's name, the book's title). "Natalie's
  Little Library" is no longer every screen's `h1`. It stays as the document
  title and on the sign-in screen **(call)**.

### The wall (`CoverWall`)

One component for every wall: your books, a single collection, Holding and a
friend's shelf. It takes `ShelfItem[]` and a description of whose wall it is.

- **Order.**
  - Books are sorted by title with `Intl.Collator` (base sensitivity, numeric),
    ignoring a leading "The ", "A " or "An " **(call)**. So "The Call of the
    Wild" files under C.
  - A title whose sort key starts with anything other than a letter A–Z, after
    stripping accents, files under "#", at the end.
- **Grouping.** A letter heading (`h2`, Fraunces, accent colour) starts each
  letter that has books. Letters with no books get no heading.
- **Grid.**
  - Three columns of `minmax(0, 1fr)` on phones, with the gutter on the right
    left free for the rail.
  - From 40rem up, the column widens and the grid goes to four or five columns
    **(call: builder picks the breakpoint by eye)**.
- **Each cover is a link** to the book's page.
  - Its accessible name is the title, then the authors.
  - That text is in the link, visually hidden **(call)**, because the cover
    image has `alt=""`.
  - Below the cover is one short line, shown only when it applies:
    - on your own wall, "With {holder}" when the book is out;
    - on Holding, "From {owner}";
    - on a friend's wall, "Out" when the book isn't at home.
- **Header.**
  - It stays at the top while the wall scrolls.
  - It holds the screen title, a count line ("248 books · 3 lent out" on your
    own wall; "{n} books" elsewhere), and the chips.
- **Chips.** A row of toggle buttons, scrolling sideways when they don't fit.
  Each is at least 44px tall: the tap area is padded beyond the drawn pill.
  `aria-pressed` marks the selected one.
  - **Your wall:**
    - All · At home · Lent out · No label · Collection ▾.
    - Collection ▾ lists your collections and ends with "New collection…",
      which opens the existing create form in place.
    - This replaces Mine's "only unlabelled" toggle and its create form.
  - **A friend's wall:** All · At home · Collection ▾ (their collections).
  - **Holding and a single collection:** no chips.
  - **Combining.** Status chips (At home, Lent out, No label) are exclusive with
    one another. Collection ▾ combines with any of them. Filters are local
    state, not in the URL **(call)**.
- **The A–Z rail.**
  - It shows only when the wall has more than 24 books and at least two
    letters **(call)**.
  - It is one vertical strip down the right edge, holding all 27 marks
    (A–Z, then #). Marks for letters with no books are drawn muted.
  - The strip's touch area is at least 44px wide. Individual letters are not
    separate targets.
  - On `pointerdown` and `pointermove` it maps the finger's height to a mark.
    It scrolls that letter's heading, or the next letter with books, under the
    sticky header (`scroll-margin-top`), and shows the current letter in a
    small bubble beside the thumb while dragging.
  - It has `aria-hidden="true"`. Screen-reader users move by the letter
    headings, which are real headings.
  - With reduced motion, the scroll jumps instead of gliding.
- **Requests bar (owner only).**
  - When anyone has asked to keep one of your books, a bar shows above the
    chips: "1 request" or "{n} requests".
  - Tapping it opens the approve and decline list from Mine as it is today,
    with the same wording and confirmations.
- **Empty walls.**
  - Your own, empty: "You haven't added any books yet.", with Pair a book and
    Import from StoryGraph as links.
  - For a friend with no books of their own, the same line also links to
    Friends and to Holding.
  - Holding, empty: "You aren't holding anyone's books."
  - Empty after filtering: "No books match.", with a "Show all" button.
- **Loading.** A skeleton of cover-shaped tiles, not a spinner. Failures keep
  today's `Trouble` with Try again.
- **Size.** About 250 covers, `loading="lazy"`, with `width` and `height` set
  on every `img`. No virtualisation **(call)**.

### Covers (`Cover`)

A cover sits in a fixed 2:3 box.

- **Fit.**
  - On the wall: `object-fit: cover`, cropping a little rather than leaving
    uneven tiles **(call)**.
  - On a book's page: the cover keeps its own proportions, up to a maximum
    width and height.
- **Three states, each visibly different:**
  1. **Loaded.** The image, with a soft shadow in the light setting and a deeper
     one in the dark.
  2. **No cover** (`coverUrl` is null). A tile in the second paper tone, with
     the title set in Fraunces and the first author in Geist. It is meant to
     look like a plain cloth binding, not an error.
  3. **Failed to load** (`onError`). The same tile family, plus a hairline
     inset border and a small "Cover didn't load" line under the title
     **(call)**.

  Today states 2 and 3 share `cover-missing`. Both are tested by role and
  text.
- **Sharpness.** Google Books thumbnails (`googleCover` in
  `src/worker/booklookup/sources.ts`) are about 128px wide, and Open Library
  "medium" covers are about 180px. A 160px cover on a 3× screen may look soft.
  - PR 1 puts real covers of public-domain editions on the wall and the book
    page, and the builder judges them at real size.
  - If they look soft, the client may ask for a larger image of the same cover
    (Open Library `-M` to `-L`; for Google, whatever size parameter actually
    works). It falls back to the stored URL on error, and the stored URL never
    changes.
  - If nothing larger is reliable, the book page's cover shrinks to what the
    source supports. **Builder's call, shown to James in PR 1.**

### A book's page

The layout for `/b/:code` and `/copies/:id`, reached from the wall or by
scanning a label. It is option A from the mockups.

- **From the top:**
  1. The back link.
  2. The cover, centred, about 150–180px wide.
  3. The title (`h1`, Fraunces) and the authors.
  4. A status line: "At home", or "With {holder}". For anyone but the owner it
     adds "· {owner}'s book".
  5. A meta line, owner only: the collection and the label code.
  6. The main button, full width.
  7. The other actions, as a list of 44px rows with a chevron.
  8. History (`h2`).
- **Which button is main.** It is picked from `copy.actions` in this order
  **(call)**: I have this book, Mark as returned, Take this book, Approve, Lend,
  Ask to keep this, Withdraw. Every other allowed action is a row. A request
  shows as a line above the button, as today.
- **Flows stay put.** Lend, give, approve, release and move open in place
  below the button, as today. Their steps, wording and confirmations don't
  change; only their styling does.
- **Signed out.**
  - The same layout, with "Sign in to take it" as the main button (the existing
    sign-in link with `returnTo`) and no tab bar.
  - Public label views (`kind: "public"`) show cover, title and authors.
  - Unknown, retired and blank labels keep today's messages, in the new
    styling.

### Friends, Holding and More

- **Friends (`/members`).**
  - A list of members other than you. Each row has the member's picture (or
    initial on an accent disc), name and book count, and links to their wall.
  - The count is the sum of `memberCollections(id)` counts, fetched for each
    member after the list loads. A row whose count fails shows no count.
  - No cover strip: that would need every friend's whole shelf on every visit.
- **Holding (`/holding`).** Your wall of what you hold, with "From {owner}"
  under each cover.
- **More (`/more`).**
  - "Hi, {name}" at the top.
  - A plain list of 44px rows: Pair a book, Print labels, People, Import from
    StoryGraph.
  - Sign out on its own, at the end.
- **Pair, Labels, Import and People.** The same behaviour and wording, in the
  new type, colour and spacing. The scanner's video and overlay and the label
  sheet's preview keep their own sizing.

### The look

- **Tokens.** All colours are OKLCH custom properties in
  `src/client/styles/tokens.css`. Nothing outside that file names a colour or
  a font family directly.
  - The light set sits on `:root`. The dark set sits under
    `@media (prefers-color-scheme: dark)`.
  - Keep the habit of writing each text pair's contrast ratio in a comment.
  - Starting values (ratios are WCAG 2.1, computed from the OKLCH values):

  | Token | Light | Dark |
  |---|---|---|
  | `--color-paper` | `oklch(98% 0.005 75)` | `oklch(19% 0.015 55)` |
  | `--color-ink` | `oklch(20% 0.012 60)` (17.1:1) | `oklch(94% 0.015 75)` (15.5:1) |
  | `--color-muted` | `oklch(47% 0.012 60)` (6.5:1) | `oklch(74% 0.03 70)` (8.0:1) |
  | `--color-accent` | `oklch(47% 0.13 45)` rust (6.8:1) | `oklch(76% 0.11 60)` amber (8.4:1) |

  - The builder still has to derive and measure, in both settings:
    - the second paper tone (chips, tiles) and muted text on it;
    - hairline rules;
    - link and visited-link colours;
    - the alert background and text;
    - the text on an ink-filled button;
    - the text on the no-cover and failed tiles;
    - the focus ring.

    Each text pair needs at least 4.5:1. The focus ring, icons and hairlines
    that carry meaning need at least 3:1.
- **Accent as a highlighter.** Rust or amber marks:
  - the active tab, letter headings, the rail, links and the focus ring;
  - the selected state, wherever it isn't ink.

  Main buttons are filled with ink, with paper-coloured text **(call)**,
  because Hallmark keeps the accent off large fills.
- **Type.**
  - **Packages.** `@fontsource-variable/fraunces` and
    `@fontsource-variable/geist` (both 5.3.0, OFL), self-hosted by Vite.
  - **Loading.** Latin subset only, and `font-display: swap`. There are no
    requests to Google at runtime.
  - **Fraunces** sets screen titles, book titles, letter headings and the
    no-cover tile, at weight 600, always upright.
  - **Geist** sets everything else.
  - **Sizes.** A 1.25 scale from a 16px body.
  - **Dark setting.** The body weight drops from 400 to 350 to make up for
    light text on dark.
  - **Code.** Label codes keep a monospace face, but not the system default:
    Geist Mono, from `@fontsource-variable/geist-mono`, if the label code
    styles need a change; otherwise leave them **(builder's call)**.
- **Spacing.** A 4px scale as tokens (`--space-1` … `--space-8`), replacing
  raw px values as each area is touched.
- **Motion.**
  - Almost none: press feedback on buttons (120ms), the rail bubble, and chips
    changing state.
  - The three named easings as tokens. Only `transform` and `opacity` animate.
  - Reduced motion removes all movement.
- **Phone setup.**
  - Two `theme-color` metas, one per `prefers-color-scheme`, set to paper.
  - A `manifest.webmanifest` with name "Natalie's Little Library", short name
    "Little Library" and `display: "browser"`.
  - Icons at 192 and 512, plus a 180px `apple-touch-icon`.
  - **Why `display: "browser"` (call):** on iOS a home-screen app keeps its own
    cookies apart from Safari's. A label scanned with the Camera opens in
    Safari, which would then be signed out, so the saved app opens Safari too.
  - The icon is a simple mark in the tokens' rust and paper. The builder draws
    it, and James sees it in PR 4.

### Hallmark gates

James asked for the Hallmark skill to keep this from looking generated. The
builders are agents that may not have the skill loaded, so the rules that
apply are written here.

- **Applies to every pull request:**
  - Tokens only: no raw colour or font values outside `tokens.css`.
  - Every interactive element styled in its states: default, hover (inside
    `@media (hover: hover)` only), `:focus-visible` (a 2px ring, offset 2px,
    shown instantly), active, disabled with a reason, loading, error and
    success where they apply.
  - Checked at 320, 375, 414 and 768px wide:
    - no sideways page scroll (`overflow-x: clip` on `html` and `body`);
    - no tappable text wrapping to two lines;
    - long titles wrap inside words.
  - Hallmark's listed tells, none of which may appear:
    - no italic headings;
    - no cards inside cards;
    - no pure black or white;
    - no gradients;
    - no glassmorphism;
    - no emoji icons;
    - no bounce easing;
    - no `transition: all`;
    - no fade-up on scroll;
    - no celebratory toasts;
    - straight quotes become typographic ones in new copy.
  - Before opening each pull request, the builder runs Hallmark's slop test
    (`~/.claude/skills/hallmark/references/slop-test.md`, the page-scope gates
    that apply to an app) and its six-axis self-critique. The result goes in
    the PR body.
- **Doesn't apply:** macrostructures, nav and footer archetypes, hero
  enrichment, and the diversification log. They are for marketing pages, not
  an app's screens.
- **Files.** `tokens.css` lives in `src/client/styles/`, not at the project
  root, because Vite bundles from `src/client`. `.hallmark/preflight.json` is
  committed with this spec **(call)**, so later runs see what was found.

## Delivery

Four pull requests, merged in order, each green on `app` CI and safe to sit
on `main` untagged. James tags once, after trying the last one on a phone.

1. **Tokens, type and covers.**
   - Split `index.css` into `styles/tokens.css`, `base.css`, `print.css` (the
     label sheet's rules, unchanged) and per-area files, loaded from one entry.
   - Add the fonts and the new tokens in both settings.
   - Add `Cover` with its three states.
   - Do the real-cover sharpness check.
   - Existing screens pick up the new look without changing structure.
   - Done when: every existing test passes with only cover-state test
     updates, and a label sheet prints exactly as before.
2. **App shell.**
   - Add `TabBar`, the route-to-tab map, `/more`, the `/mine` rewrite, the
     signed-out shell (no tabs) and per-screen `h1`s.
   - Home's buttons are removed.
   - Done when: every screen is reachable from the tabs, and the tab bar
     doesn't print.
3. **Walls.**
   - Add `CoverWall`, `AlphaRail`, the chips and the requests bar.
   - Mine, Shelf, Holding and a member's shelves move onto the wall.
   - Add the Friends list with counts.
   - `ShelfList` goes once nothing uses it.
4. **Book page and the rest.**
   - The cover-first book page, including signed out.
   - Restyle Pair, Labels, Import and People.
   - Add the manifest, icons and `theme-color`.

Each pull request gets a reviewer and an antagonist, as every plan task does
here.

### Tests to add

- The sort key: articles, accents, digits, and "#" coming last.
- Grouping into letters.
- The rail's position-to-letter mapping, as a pure function.
- Chip filtering, including Collection combined with a status chip.
- The route-to-tab map, including a book page for owner, holder and anyone
  else.
- The main-button priority.
- The three cover states.
- Empty walls.
- Friends counts, including one failing.
- The tab bar is absent when signed out.

## Left to the builder

- Exact sizes, spacing and breakpoints within the tokens and the Hallmark
  gates.
- The tab icons and the home-screen icon, in one hand-drawn stroke style.
- The derived colour tokens, measured to the ratios above.
- How to get sharper covers, if the PR 1 check says they're needed.
- Whether label codes need Geist Mono.

## Release 2: cover photos (later, not designed here)

James's queued request: when a book has no cover, its owner can take a photo
of it. This needs:
- a storage bucket that James creates in Cloudflare;
- a binding in `wrangler.jsonc`;
- an upload route with size and type limits;
- shrinking the photo in the browser before upload.

The no-cover tile from this release gets a "Take a photo" button then. It gets
its own brainstorm and spec after release 1 is tried on a phone.
