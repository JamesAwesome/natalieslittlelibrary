# Handoff: caching and layout shift

Written 2026-11-28, after v0.9.0 (find a book) shipped. The next session writes the design doc.

## The ask

The maintainer sees a lot of loading and layout shift. They asked for two things, in this order:
1. Cache more, covers included, and make real use of Cloudflare's caching so the app stops reloading things.
2. Then find out how to cut the layout shift.

The maintainer approved the plan below in the brainstorm. Write it up as a design doc; don't reopen it.

## Start here

1. Work on the branch `caching-and-shift`, which carries this handoff. Rebase it on `main` first. Every change reaches `main` through a pull request (see `AGENTS.md`).
2. Brainstorming is done and the approach is approved. Write the full design doc at `docs/superpowers/specs/2026-11-28-caching-and-shift-design.md`.
   - Run the builder check from `superpowers:brainstorming` before handing it over.
   - Bring the maintainer only the questions that change what gets built.
3. After the maintainer approves the doc, go to `superpowers:writing-plans`, then `superpowers:subagent-driven-development`.
   - Every task gets a reviewer and an antagonist (`.claude/agents/antagonist.md`).
   - Ship two PRs: caching first, shift second.
4. Committed text says "the maintainer", never a name.

## What was found (evidence, 2026-11-28)

- **Hashed assets are revalidated on every load.**
  - Live `/assets/*.js`, CSS and woff2 come back with `cache-control: public, max-age=0, must-revalidate` (cf-cache-status HIT, with an etag). The HTML is the same.
  - Workers static assets set nothing, because `wrangler.jsonc` has no headers config and there's no `public/_headers`.
- **Fonts swap late.**
  - `src/client/styles/index.css` imports `@fontsource-variable/fraunces` and `/geist`, which use `font-display: swap`.
  - Nothing preloads them. The browser finds them only after the CSS is parsed, so the first paint is in Georgia / system-ui and the text reflows when the fonts arrive. That moves the h1, the count line and the chip widths.
  - The build emits latin, latin-ext, cyrillic and vietnamese files. Only latin matters for preloading.
- **Covers come straight from third parties, and are cached briefly.**
  - Open Library `covers.openlibrary.org/b/...-M.jpg` answers 200 with `cache-control: public` and `expires` 10 minutes out. It no longer redirects to archive.org.
  - Google `books.google.com/books/content?...` sends `private, max-age=86400`.
  - The `<img>` tags are in `src/client/screens/BookCard.tsx` (`CoverFor`): `referrerPolicy="no-referrer"`, lazy except the hero, and `naturalWidth <= 1` treated as failed.
  - `src/client/covers.ts` `largerCover` asks for `-L.jpg?default=false` for the hero, so a missing large cover is a 404.
  - Stored URL shapes are made in `src/worker/booklookup/sources.ts`: OL `cover.medium`, and Google via `googleCover` (https, no curl).
- **Covers don't cause shift.** `covers.css` gives every size a fixed box with a 2:3 aspect ratio, and the hero keeps its 160×240 box.
- **Every screen reads from scratch on every visit,** coming back from a book included.
  - `useLoaded` (`src/client/screens/useLoaded.ts`) has no cache.
  - Boot is `getMe` in `App.tsx`, then the screen.
  - Mine (`src/client/screens/Mine.tsx`) reads `myCollections`, then every shelf in parallel (`src/client/wall/load.ts`), plus `listRequests`.
  - The skeleton (`CoverWall` with `loading`) is nine tiles, with no count line and no chips row. When the data lands, the count line and the 60px row (104px on an upright phone with the find box) appear above the grid, and everything jumps down. This is the largest shift seen.

## The approved plan

**PR 1: caching**
- **Asset headers.** Add `public/_headers` with `/assets/*` set to `Cache-Control: public, max-age=31536000, immutable`. The HTML stays revalidated so deploys land.
- **Font preload.** Preload the latin woff2 of both fonts from `index.html`.
- **Cover proxy.** Add a Worker route `/covers/…` that fetches covers through Cloudflare:
  - It fetches only from Open Library and Google's cover hosts, so it can't be used as an open proxy.
  - It keeps each image in the edge cache (Cache API).
  - It answers browsers with a long immutable `Cache-Control`.
  - The client points `<img>` at it.
  - Side benefit: readers' browsers stop contacting Open Library and Google directly.
  - Cost: one Worker request per cover the first time each browser sees it, within the free plan.
- **Last read per screen.** The client keeps each screen's last read for the session (in memory). A return visit renders it at once and refreshes behind it. Any write (non-GET) clears the memory, so only other people's changes can show stale for a moment.

**PR 2: layout shift**
- **Skeleton.** The loading skeleton reserves the count line and the pinned row, so the first load doesn't jump.
- **Measure.** Record CLS (a `PerformanceObserver` for `layout-shift`) in headless Chrome, before and after, and fix what it finds.
- **Fallback fonts.** If the swap on a first-ever visit still shows, add metric-matched fallbacks (`size-adjust` and the `*-override` descriptors).

## Questions the design doc must settle (builder-level, check before deciding)

- **Headers file.** Confirm that Workers static assets honour `public/_headers` with this config (`assets.not_found_handling: single-page-application`, `run_worker_first: ["/api/*", "/auth/*"]`), and that Vite copies it to `dist/client`. Check current Cloudflare docs; don't go from memory.
- **Proxy URL design.**
  - Choose between a client-side rewrite (a `coverSrc(url)` next to `largerCover`) and the API returning proxied URLs.
  - Decide how the upstream URL is encoded. Note that the `?default=false` query must survive.
  - Add `/covers/*` to `run_worker_first`.
- **Upstream failures.**
  - Upstream 404s (the large-cover fallback) and errors must pass through as failures and must not be cached for a year. Decide whether to cache negatives briefly.
  - The client's `naturalWidth <= 1` check must keep working.
- **Access.** Decide whether `/covers/*` needs a session. The public label page (`/b/<code>`, `kind: "public"`) shows a cover to signed-out visitors.
- **Sizes.** Covers are a few dozen KB each, about 250 books. Check the Cache API's behaviour on a custom domain and on the free plan.
- **Dev and tests.** Decide how the route behaves under `vite dev` (the Cloudflare plugin) and in the worker test pool. Upstream must be stubbed in tests; there is a pattern for this in `src/worker/booklookup`.
- **Last-read memory and wall places.**
  - It must not break `useWallPlace` (`src/client/wall/memory.ts`). The place restores once, when `ready` first turns true. With cached data, `ready` is true at once, and a refresh landing later must not move the page. Mine's comment on `ready` explains why nothing above the grid may change height after it.
  - A 401 from the refresh must still drop to sign-in (`lost`), and a 404 must still mean `gone`.
  - The memory's key and lifetime (per path? per call?), and StrictMode double effects, are open.
- **Where the clearing hook lives.** The invalidate-on-write hook sits in `src/client/api.ts`, around its single `fetch` helper and `logout`.

## Tools already in the repo

- **`scripts/shoot.mjs`** takes true-width headless Chrome screenshots. Its capture is full-page (`captureBeyondViewport: true`).
  - For sticky or fixed UI, copy it to the scratchpad with `captureBeyondViewport: false` and an eval hook.
  - That copy can also read `PerformanceObserver` entries and `scrollY` after a scripted visit.
- **The dev preview** is at `/src/client/preview/preview.html?view=wall` (`&loading`, `&q=`, `&status=`, `&collection=`). It's a good place to measure the skeleton-to-wall shift without signing in. The real screens need a Google sign-in, which only the maintainer can do.
- **`.claude/agents/antagonist-techniques.md`** includes the 2026-11-28 lesson: a taller sticky row turns programmatic `focus()` into page jumps. Check `scrollY` deep in the wall, not just at the top.

## Off limits

- `storygraph_export.csv` and `.dev.vars` (`AGENTS.md`).
- Don't fetch real library covers by the library's ISBNs for testing. Use well-known public ISBNs.
- No `wrangler deploy` and no `--remote` writes. Releases are tags the maintainer approves.

## Still open from earlier releases

There are phone checks the maintainer hasn't done yet:
- **v0.9.0:** iOS doesn't zoom when the find box is tapped; the search key dismisses the keyboard; the 104px row feels right.
- **Earlier ones:** listed in the release PRs (#18, #21, #22).
