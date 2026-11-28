# Caching and layout shift

Drafted 2026-11-28, after v0.9.0. It follows the handoff
`docs/superpowers/handoffs/2026-11-28-caching-and-shift.md`, whose plan the
maintainer approved in the brainstorm. Calls made without the maintainer are
marked **(call)**.

## Why

The maintainer sees a lot of loading and layout shift. Every visit to a screen
reads everything again behind a skeleton, the app's own scripts and styles are
revalidated on every load, covers come from third parties with short cache
lives, and the fonts swap in late. When the wall's data lands, the count line
and the pinned row appear above the grid and push every cover down.

They asked for two things, in this order:
1. Cache more, covers included, and make real use of Cloudflare's caching.
2. Then cut the layout shift.

## Goals

1. A screen you come back to in the same tab draws at once, from what it showed
   last time, and refreshes behind it.
2. The app's scripts, styles and fonts load once and are never revalidated until
   a deploy changes them.
3. A cover a browser has seen once never goes back to the network. A cover
   anyone has fetched recently is served from Cloudflare, not from Open Library
   or Google.
4. The first-ever load of a wall doesn't jump when its data lands.
5. CLS is measured before and after PR 2, and the number goes down.

## Non-goals

- Offline use, a service worker, or an installable-app cache.
- Live updates of other people's changes. A remembered screen may show their
  change one refresh late, as it does today with a reload.
- Remembering reads across tabs or after the tab closes.
- Caching on the copy page (`CopyPage`), see "Which screens remember".
- Changing how covers look, their sizes, or the cover tile states.
- Moving covers into storage of our own (R2, D1). The edge cache holds them.

## Anti-goals

- A remembered screen that shows controls for a state that is gone, after your
  own write. Your writes always clear the memory.
- A refresh that moves the page under your thumb. This includes moving the wall
  away from the place `useWallPlace` restored.
- A cover route anyone can use to fetch arbitrary URLs, or one that serves
  anything but an image from our origin.
- A deploy that doesn't reach a browser because the HTML got cached.
- Another person's library data left in a browser after sign-out.

## Approaches considered

The maintainer picked the approach in the brainstorm. These were the
alternatives:

- **Covers: a Worker proxy with the edge cache (chosen).** One route,
  `/covers/…`, fetches only from the two cover hosts, keeps the image in
  Cloudflare's cache and gives browsers a year-long immutable lifetime. Readers'
  browsers also stop contacting Open Library and Google.
  - *Leave covers on third parties.* Not chosen: Open Library's 10-minute
    `expires` means a wall of 250 covers goes back to the network every visit.
  - *Copy covers into R2 at pairing time.* Not chosen: it needs a backfill, a
    bucket and a write path, for images the edge cache already keeps.
  - *Workers Cache (`"cache": { "enabled": true }`).* Not chosen: it charges
    every request to the Worker, static assets included, and it caches the
    Worker's own responses, not the upstream fetch.
- **Return visits: remember each screen's last read (chosen)** and refresh
  behind it.
  - *A client-side router* so screens stay mounted. Not chosen: it is a rewrite
    of navigation for a problem a small memory solves.
  - *HTTP caching of `/api/*`.* Not chosen: those answers differ per person and
    are `no-store` on purpose.
- **Shift: reserve the space in the skeleton (chosen),** then measure and fix
  what's left. *Hide the page until everything has loaded* was not chosen,
  because it trades a jump for a blank screen.

## What the code does today (the facts the design rests on)

- **Every screen change is a full page load.** Links are plain `<a href>`, and
  `App` reads `location` once. There is no client-side router. A page restored
  from the back-forward cache reloads itself (`App.tsx`, `pageshow`). So
  anything kept in JavaScript memory is gone on the next screen. The wall's
  scroll place survives because it is in `sessionStorage`
  (`src/client/wall/memory.ts`).
- **Boot is two round trips in a row.** `App` calls `getMe`, and only when it
  answers does the screen start its own reads. Mine reads `myCollections`, then
  every shelf in parallel, plus `listRequests`.
- **Screens on `useLoaded`:** Mine (wall and requests), Shelf, Members (the list
  and a member's wall), People and Holding. CopyPage has its own loader.
- **Cover URLs** are stored only if they are https on `covers.openlibrary.org`
  or `books.google.com` (`safeCoverUrl` in `src/shared/bookFacts.ts`). Every
  `<img>` for a cover is made in one place, `CoverFor` in
  `src/client/screens/BookCard.tsx`. The preview fixtures use Open Library URLs,
  and one deliberately broken one on `covers.invalid`.
- **Static assets** get Cloudflare's default
  `Cache-Control: public, max-age=0, must-revalidate`, because there is no
  `_headers` file.
- **How the cover hosts answer**, observed with curl on 2026-11-28, using the
  booklookup User-Agent and no referrer, on the preview fixtures' public ids and
  Penguin's *Pride and Prejudice* ISBN:
  - Open Library `/b/id/<id>-M.jpg` and `-L.jpg?default=false` answer
    **302 to `archive.org`**, which answers 302 to an `ia<n>.us.archive.org`
    host, which answers 200 `image/jpeg` with `public, max-age=10800`. The
    `/b/isbn/` form redirects the same way. The handoff said Open Library no
    longer redirects. That holds for some covers, not these.
  - A missing `-L.jpg?default=false` is a 404 with an empty body.
  - A missing `-M.jpg` is 200 `image/gif`, 43 bytes: the 1×1 placeholder.
  - Google `books/content?...` answers 200 `image/jpeg` with
    `private, max-age=86400` for a real cover, fetched with no cookies. For an
    unknown id, it answers 200 `image/png` of about 1.3 KB (its "image not
    available" picture) with `private, max-age=30`. Today the app shows that
    picture as the cover, and the proxy keeps it so.
- **Fonts:** the build emits `fraunces-latin-wght-normal-<hash>.woff2` and
  `geist-latin-wght-normal-<hash>.woff2` in `dist/client/assets`, among other
  subsets. Nothing preloads them.

The first fact changes one word of the approved plan. The plan said the last
read is kept "in memory". In-memory state can't survive a full page load, so
the memory lives in `sessionStorage`, next to the wall place. It is still one
tab and one session. **(call)**

## PR 1: caching

### Asset headers

- Add `public/_headers`. Vite copies `public/` into the client build output, and
  the Cloudflare Vite plugin supports `_headers` at build, preview and deploy
  ([docs](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)).
  The file:

  ```
  /assets/*
    ! Cache-Control
    Cache-Control: public, max-age=31536000, immutable
  ```

  The `! Cache-Control` line detaches the default. Without it, Cloudflare's docs
  warn that two `Cache-Control` values can be joined into conflicting
  directives ([docs](https://developers.cloudflare.com/workers/static-assets/headers/)).
  The builder checks the actual header with `vite preview` and curl. If the
  detach turns out to be unnecessary or wrong, the builder drops it, as long as
  the response carries exactly one `Cache-Control` with these values.
- Only `/assets/*` gets the change. Every file there has a content hash in its
  name. The HTML, the manifest and the icons keep the default, so a deploy
  always lands.
- `_headers` doesn't apply to Worker responses
  ([docs](https://developers.cloudflare.com/workers/static-assets/headers/)), so
  the cover route sets its own headers.

### Font preload

- A small Vite plugin in `vite.config.ts` adds two
  `<link rel="preload" as="font" type="font/woff2" crossorigin href="…">` tags
  to the built `index.html`. It runs in `transformIndexHtml` and reads the
  bundle, with one link each for the latin `wght` normal file of Fraunces and of
  Geist. `crossorigin` is required, or the browser fetches the font twice.
- **The build fails if either file is missing from the bundle** (a fontsource
  rename, say), so the preload can't silently go away. **(call)**
- It is build-only. `vite dev` doesn't need it. **(call)**

### Cover proxy

**Route.** `GET /covers/<source>/<path>?<query>`, where `<source>` is one of two
fixed keys **(call)**:

| key  | upstream                         | allowed paths                            |
|------|----------------------------------|------------------------------------------|
| `ol` | `https://covers.openlibrary.org` | `/b/<id\|isbn\|olid>/<value>-<S\|M\|L>.jpg` |
| `gb` | `https://books.google.com`       | anything under `/books/`                 |

- The upstream URL is rebuilt from the fixed host, the path and the query
  string. Nothing in the request can name another host, so it isn't an open
  proxy. `?default=false` survives because the query is carried through as is.
- Add `/covers/*` to `assets.run_worker_first` in `wrangler.jsonc`, so a cover
  path never falls through to the single-page-app `index.html`.
- **The client rewrites, the API doesn't change (call).** `covers.ts` gains
  `coverSrc(url)`, which maps a stored URL on one of the two hosts to its
  `/covers/…` path and leaves any other URL as it is. `CoverFor` applies it to
  each attempt after `largerCover`. Stored data, API answers, Pair and the tests
  of the lookup stay as they are. The preview's `covers.invalid` fixture still
  fails, as it should.
- **The direct URL stays as the last attempt (call).** `CoverFor`'s attempts
  become: the proxied larger cover (hero only), the proxied stored cover, and
  then the stored cover direct. If the hosts refuse requests from Cloudflare,
  which can't be tested before release, covers fall back to what happens today
  instead of all showing "Cover didn't load". The cost is one extra request
  for a cover that is truly missing. A release-day check (below) shows whether
  the fallback is ever used.

**Handling, in order:**
1. Only GET and HEAD. Anything else gets 405.
2. Refuse cross-site embedding: when `Sec-Fetch-Site` is `cross-site` or
   `same-site`, answer 403, as `/api/books/lookup` does. Our own `<img>` tags are
   same-origin. **(call)**
3. An unknown source key or a path the table doesn't allow gets 404 with no
   upstream fetch.
4. Look up the request in `caches.default`, keyed by the canonical proxy URL
   (origin, path and query). A hit is returned as is.
5. On a miss, fetch upstream with the same `User-Agent` the book lookup uses, no
   cookies and no referrer, and a timeout of about 8 seconds for the whole chain
   (the builder may tune this).
   - **Redirects are followed by hand** (`redirect: "manual"`), at most three
     hops, and only to https hosts on the source's list: for `ol`,
     `covers.openlibrary.org`, `archive.org` and any `*.archive.org`; for `gb`,
     `books.google.com`. A hop anywhere else is a 502. Open Library's covers
     take two hops today (see "How the cover hosts answer"). **(call)**
6. Classify the final upstream answer:
   - **Image:** status 200, a `Content-Type` of `image/jpeg`, `image/png`,
     `image/gif` or `image/webp`, and a body under 2 MB. It gets
     `Cache-Control: public, max-age=31536000, immutable`, is put in the edge
     cache, and is returned.
   - **Placeholder:** an image that stands for "no cover". It is returned as
     is, but with `Cache-Control: public, max-age=86400`, and the edge cache
     keeps it for a day. A cover that appears upstream later then shows up
     within a day. **(call)** There are two rules, one per source, from what
     was observed:
     - `ol`: a body under 1 KB, such as the 43-byte 1×1 gif. The client's
       `naturalWidth <= 1` check still marks it failed.
     - `gb`: an upstream `max-age` under one hour. Google gives its "image not
       available" picture `max-age=30`, and a real cover `max-age=86400`.
     The tests pin both with fixtures shaped like the observed answers.
   - **Not found:** upstream 404 (the large-cover fallback). Answer 404 with
     `Cache-Control: public, max-age=86400`, and keep it in the edge cache for a
     day. The client falls back to the stored medium URL, as it does today.
     **(call: negatives are cached for a day)**
   - **Anything else** (a 5xx, a timeout, a wrong content type, too large, a
     redirect to a host we don't allow): answer 502 with `no-store`, and don't
     cache it. The client shows "Cover didn't load", as it does today.
7. A response from this route carries only `Content-Type`, `Content-Length`,
   `Cache-Control`, `X-Content-Type-Options: nosniff` and
   `Content-Security-Policy: default-src 'none'`. No upstream header passes
   through, `Set-Cookie` included. The Cache API won't store a response with
   `Set-Cookie` anyway.
- `cache.put` runs in `ctx.waitUntil`, so the reply doesn't wait on it.

**Access: no session needed (call).** The public label page (`/b/<code>`)
shows a cover to signed-out visitors. A cover tells a stranger nothing the
upstream wouldn't, and the route can reach only two image hosts. Anyone who
wants to burn the free plan's 100,000 requests a day can already do that with
`/api/health`.

**Cost.** Each browser makes one Worker request per cover, the first time it
sees that cover, and never again until its HTTP cache evicts the cover. That
uses one cache match, at most four upstream fetches (three redirect hops) and
one put, well inside the 50 subrequests the free plan allows each request. About 250 covers of a few
dozen KB each is nothing to the edge cache, which allows 512 MB per object. The
edge cache is per data centre and may evict, and a miss just refetches.

**Module and tests.** The route lives in its own module (`src/worker/covers/`),
built like `createBookLookup`: `createCoverProxy({ fetch, cache, timeoutMs })`.
Tests stub both upstream and the cache, following the stub pattern in
`src/worker/booklookup/booklookup.test.ts`, and never reach the real hosts.
`index.ts` wires it with the global `fetch` and `caches.default`. A route-level
test in `index.test.ts` checks the cases that need no upstream: a bad key or
path is 404, a POST is 405, cross-site is 403, and `/covers/…` doesn't return
the app's HTML. Under `vite dev` the route runs in the plugin's local workerd,
and the code must not depend on a cache hit there. When tests use a real ISBN,
it is a well-known public one, never one from the library.

### Remembered reads

**Where.** `sessionStorage`, one entry per read, keys prefixed `read:`. Each
entry is an envelope `{ build, member, data }`:
- `build` is a build id that Vite injects with `define` at build time. A stored
  entry from a different build is ignored and removed, so a deploy mid-session
  never feeds old-shaped data to new code. **(call)**
- `member` is the id of the member the read was made for. An entry is used only
  while that is the current member, so one person's reads can never draw for
  another, even if a clear was missed. **(call)**

**Hook.** `useLoaded(load, enabled, key?)`. With a key:
- **First render:** if `enabled` and a usable entry exists, the state starts as
  `{ status: "ok", data }`. The read happens in the `useState` initialiser, so
  StrictMode's double effects don't matter.
- **The effect still runs `reload`,** as it does today.
- **When the refresh lands with the same data** (compare the JSON text), there
  is no `setState`. Nothing re-renders, and nothing moves. This is the common
  case.
- **When it lands with different data:** set it and store it.
- **A 401:** clear every `read:` entry and go `lost`, as today.
- **A 404:** drop this key and go `gone`, as today.
- **Any other failure while remembered data is showing:** keep showing it. Don't
  replace the screen with "Something went wrong". The remembered data is at
  most this session old, and the next visit tries again. With nothing
  remembered, a failure is `failed`, as today. **(call)**
- `retry` and `lose` behave as today.

Without a key, `useLoaded` behaves exactly as it does now.

**Which screens remember (call):**

| read                          | key                        |
|-------------------------------|----------------------------|
| boot `getMe`                  | `read:me`                  |
| Mine's wall                   | `read:mine:wall`           |
| Mine's requests               | `read:mine:requests`       |
| Shelf                         | `read:shelf:<id>`          |
| Members list                  | `read:members`             |
| A member's wall               | `read:member:<id>`         |
| People                        | `read:people`              |
| Holding                       | `read:holding`             |

- **The boot read is included** because it is the first of the two round trips.
  Without it, a remembered wall still waits for `/api/me`, and the page shows
  only the app name until then. `App` doesn't use `useLoaded`, so it reads and
  writes the same store through the same helper. **(call)**
  - `App` starts from the remembered member, and verifies it behind.
  - If `/api/me` answers with no member, or with a different member, `App`
    clears every `read:` entry and goes on with the answer: sign-in for none,
    or a fresh boot for the other member. `/api/me` answers a signed-out
    visitor 200 `{ member: null }`, not 401, so this clear is needed on top of
    the one for 401s in `call`.
  - If `/api/me` fails (a network error or a 503) while a remembered member is
    showing, keep showing it, as the screens keep their data. With nothing
    remembered, it behaves as today: a 503 is the trouble page, and anything
    else is sign-in.
  - What this risks: when a session has ended elsewhere, the tab draws that
    same member's own last screen for one round trip, then drops to sign-in.
    It never draws another member's data, because entries carry the member id
    and sign-in clears them.
- **CopyPage is left out.** It is where actions happen (claim, return, lend,
  approve). A copy shown from memory could offer an action for a state someone
  else has just changed. It is also usually reached from a wall that is already
  fresh.

**Clearing.** In `src/client/api.ts`:
- Every non-GET `call` clears all `read:` entries when it starts, and again when
  it settles, success or failure. The second clear catches a read that started
  before the write and finished after it.
- `logout` clears them, before the request and after it, so no library data
  outlives a sign-out in that tab.
- Any 401 from `call` clears them.
- Starting a sign-in (the link to `/auth/login` in `SignIn`) clears them, so the
  next person to sign in on that tab starts empty.
- `/api/me` answering with no member, or another member, clears them (see the
  boot read above).
- `sessionStorage` is per tab, so a write in another tab doesn't clear this
  one. This tab then shows the old state for one refresh. That is accepted.

**Size.** A wall of about 250 books is a few hundred KB of JSON, well under
`sessionStorage`'s quota. A failed write (a full store or private mode) is
ignored, as `savePlace` already does.

**Wall places.** `useWallPlace` restores once, when `ready` first turns true.
With remembered data that is the first render, against the same layout the
person left, which is what it was built for. The refresh must not undo that:
- If the data is unchanged, nothing renders (see above).
- If the data changed and the person is scrolled at or below the wall's anchor
  (`WALL_ANCHOR`), the anchor keeps its position on screen across the update.
  Measure it before the commit and `scrollBy` the difference in a layout effect.
  iOS Safari doesn't do CSS scroll anchoring, so the code does it. The builder
  decides whether this lives in `useWallPlace` or in `CoverWall`.
- Mine's `ready` needs both reads. Both are remembered, so it is true at once
  on a return visit, and it stays true through the refresh, because the state
  stays `ok`.
- Per `.claude/agents/antagonist-techniques.md`, check `scrollY` deep in the
  wall, not only at the top.

## PR 2: layout shift

### Skeleton

- While `loading`, `CoverWall` renders the count line and the pinned row
  (chips, and the find box where it shows) as placeholders of the same height as
  the real ones: 60px, or 104px on an upright phone with the find box. Use the
  same CSS boxes as the real elements, so their heights can't drift apart. The
  placeholders are `aria-hidden`, and they have no controls a person can reach.
- The anchor (`WALL_ANCHOR`) still appears only when the wall is ready.
- An empty or incomplete wall, which has no count line, may still close the
  reserved line when its data lands. That is rare, and accepted. **(call)**
- With PR 1, a return visit doesn't show the skeleton at all. This fixes first
  visits and fresh tabs.

### Measure

- **Tool:** a copy of `scripts/shoot.mjs` in the scratchpad, with
  `captureBeyondViewport: false`. It adds a buffered `PerformanceObserver` for
  `layout-shift` and reports the summed value and the largest entries, with
  their sources.
- **Where:** the dev preview (`/src/client/preview/preview.html?view=wall`).
  PR 2 adds a `&loadfor=<ms>` parameter to the preview, which shows the skeleton
  for that long and then the wall, so the real transition can be measured
  without signing in. **(call)**
- **When:** before any PR 2 change, then after. Widths 375 and 414 upright, and
  one landscape phone width, in both colour schemes. Record the numbers in the
  PR body.
- Fix any other shift it finds, within the wall screens.

### Fallback fonts

- Only if the measurement still shows a shift from the font swap on a cold
  load: add `@font-face` fallbacks (`Fraunces Fallback`, `Geist Fallback`) over
  local Georgia and system-ui, with `size-adjust`, `ascent-override`,
  `descent-override` and `line-gap-override` matched to the real fonts. Put them
  second in the font stacks.
- If the preload from PR 1 already makes the swap invisible, skip this and say
  so in the PR.

## Verification

- **PR 1:**
  - `pnpm build` and `vite preview`, then curl a file under `/assets/` (exactly
    one `Cache-Control`, the immutable one), the HTML (still revalidated) and
    `/covers/ol/b/id/<fixture id>-M.jpg` (an image, the long lifetime, and
    no `Set-Cookie`).
  - `/covers/xx/…` and `/covers/ol/../…` get 404.
  - A missing `/assets/nope.js`, asked for plainly and with
    `Sec-Fetch-Mode: navigate`, doesn't come back as the app's HTML with the
    immutable header. The docs don't say whether `_headers` applies to the
    single-page-app fallback. If it does, the rule has to be narrowed, for
    example to the file types the build emits.
  - The preview's cover fixtures (`/b/id/` URLs, the shape the app stores) load
    through `/covers/ol/…`, which proves the redirect chain is followed.
  - The built `index.html` has both preload links, and their files exist.
  - After the maintainer releases it, a read-only curl of the live site
    confirms the same headers, and the same missing-asset check.
  - **Release day:** a live `/covers/ol/b/id/<fixture id>-M.jpg` and one Google
    cover come back as images. Workers Logs show few or no failed cover
    requests, which means the direct fallback isn't being used. If they all
    fail, Open Library or Google is refusing Cloudflare, and the covers are
    still showing only because of the fallback.
  - In the preview, a return visit to the wall renders with no skeleton and
    keeps its scroll place deep down.
- **PR 2:** the CLS numbers before and after, in the PR body.
- **The maintainer's phone checks:**
  - Going back to the wall from a book is instant, and stays where it was.
  - Covers show on a second visit with no flicker.
  - The first load doesn't jump.

## Left to the builder

- Exact names, file layout inside `src/worker/covers/`, and how `coverSrc`
  parses.
- The upstream timeout, within reason.
- Where the anchor-keeping on refresh lives.
- How the build id is made (a hash or a timestamp both do).
- The exact placeholder markup in the skeleton, as long as it uses the real
  boxes.

## Off limits

- `storygraph_export.csv` and `.dev.vars`.
- Fetching real covers by the library's own ISBNs. Use well-known public ones.
- `wrangler deploy`, `--remote` writes, tags without the maintainer's approval.
