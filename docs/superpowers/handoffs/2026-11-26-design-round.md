# Handoff: design round

Written 2026-11-26 at the end of the session that shipped v0.5.0.

## The ask

James wants a full design round for the app before step 5 ("Open up"). The inspiration is reading apps like Apple Books (iBooks) and Kindle. That's all he has said about it so far. Everything else below is context, not a decision of his.

Treat Apple Books and Kindle as a genre to learn from, not something to copy. The genre includes:
- cover-first grids and shelves;
- a book's detail page built around its cover;
- calm typography;
- collections as a main way to move around.

Don't reproduce either app's own look, names, icons or artwork.

## Start here

1. Branch from an up-to-date `main` (see `AGENTS.md`: every change goes through a pull request, and only James merges, tags or deploys).
2. Use `superpowers:brainstorming` before designing anything.
   - Offer the visual companion when the first visual question comes up. This round is about looks, so mockups matter.
   - The `hallmark` and `frontend-design:frontend-design` skills are worth loading when it comes to drawing screens.
3. Things James hasn't said, which the brainstorm should get him to describe in his own words (ask them, don't assume):
   - What he likes about Apple Books and Kindle.
   - Whether this round is only the look (type, colour, spacing, covers), or also how the app is laid out and how you move around it. Today that's a Home page full of buttons.
   - Who it's mainly for: Natalie managing about 250 books, friends scanning one label, or both.
   - Whether he wants mockups he can react to before a spec.
4. Then the usual path: a spec in `docs/superpowers/specs/`, then `superpowers:writing-plans`, then `superpowers:subagent-driven-development`. Every task gets a reviewer and an antagonist.

## Where things stand

- **v0.5.0 (owner tools) is live** at books.waffle.haus. It adds lend to a member or a placeholder name, give, ask to keep and approve, release and take, and the People page.
- **Step 5 is on hold** until this round is done. Its first item is settling the final domain.
- **Step 4 isn't checked off yet.** Its done-when ("each has been done once with a real book") is James's to do on a phone.
- **PR #12 (roadmap marks v0.5.0 released) is open**, waiting for James.
- **This handoff's PR** also adds a "Design round" section to `docs/ROADMAP.md`.

## The client today

- **Stack.** React 19 and Vite 8, with no router library: `src/client/route.ts` `matchRoute` maps paths to screens. Screens are in `src/client/screens/`. They are thin by design; the rules live in the Worker.
- **Screens:** Home, SignIn, Pair (`/pair`), Labels (`/labels`), Mine (`/mine`), Holding (`/holding`), Members and Shelf (`/members`, friends' shelves), People (`/people`), Import (`/import`), CopyPage (`/b/<code>` and by id), Trouble, NotFound.
- **Navigation.** Home is a stack of buttons: Pair a book, Print labels, My books, What I'm holding, Friends' shelves, People, Import from StoryGraph, Sign out. Other screens have a BackLink.
- **Styling.**
  - Everything is in one stylesheet, `src/client/index.css` (515 lines). There are no CSS modules and no Tailwind.
  - Colours are tokens on `:root`, in a warm paper palette (`--bg #fffaf2`, `--accent #8a3b12`), with dark mode under `prefers-color-scheme`.
  - Contrast ratios are written next to the link colours. Keep that habit.
  - The font is `system-ui`. The layout is a single 32rem column.
- **Covers.**
  - Covers come from Google Books (`coverUrl`, which can be null).
  - `BookCard.tsx` shows a 96px cover, and shelf rows show 64×96.
  - The same `cover-missing` placeholder is shown whether the book has no cover or the image failed to load.
- **Phone setup.** There's no web app manifest, `theme-color` or home-screen icon yet. `index.html` is bare.
- **Keep working.** Printing label sheets (`src/client/labelsheet/`, with its own print styles and alignment) and the camera scanner (`src/client/scanner/`) must keep working. Their tests and the print layout are fragile.
- **Tests.** There are 655 client tests that use Testing Library, querying by role and visible text. A redesign that changes wording or structure has to update them. Snapshot tests are not the habit here.

## Requests James queued that fit this round

- **Cover photo:** when a book has no cover, let the owner take a photo of it. Not built.
- **Cover states:** a cover that failed to load must look different from a book with no cover. Not built.

## Rules that still apply

- **Natalie's reading data.** `storygraph_export.csv` is her private reading data. Never use its titles, reviews or ratings in mockups or test fixtures. Use made-up books or well-known public-domain ones.
- **Secrets.** `.dev.vars` holds secrets: never print or commit it. James's email is private.
- **Accessibility.** Keep 4.5:1 text contrast in both themes and tap targets of at least 44px. The phone browser is the main platform.
- **How James works.** He tries each step on a real phone before the next one starts. Ask him only questions whose answers change what gets built. Bold each question, one decision per question, with the context and your recommendation.
