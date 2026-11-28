# Caching and layout shift

Drafted 2026-11-28, after v0.9.0. It follows the handoff
`docs/superpowers/handoffs/2026-11-28-caching-and-shift.md`, whose plan the
maintainer approved in the brainstorm. A builder check and an antagonist pass
have read it. Calls made without the maintainer are marked **(call)**.

## Why

The maintainer sees a lot of loading and layout shift:
- Every visit to a screen reads everything again behind a skeleton, the boot
  read included.
- The app's own scripts, styles and fonts are revalidated on every load.
- Many covers go back to the network on every visit, for two reasons:
  - Open Library covers that redirect through archive.org go back because the
    redirect itself can't be cached.
  - Google covers go back because they are kept for only a day.
- When the wall's data lands, the count line, the pinned row, the letter
  heading and the A–Z rail's gutter all appear at once, and every cover moves.

They asked for two things, in this order:
1. Cache more, covers included, and make real use of Cloudflare's caching.
2. Then cut the layout shift.

## Goals

1. A screen you come back to in the same tab draws at once, from what it showed
   last time, and refreshes behind it.
2. The app's scripts, styles and fonts load once and are never revalidated until
   a deploy changes them.
3. An Open Library cover a browser has seen once doesn't go back to the network.
   Covers are fetched through Cloudflare, so readers' browsers don't contact
   Open Library, archive.org or Google.
4. On the first-ever load of a wall, the covers don't move when the data lands.
   The first cover's position in the skeleton matches its position in the
   loaded wall.

## Non-goals

- Offline use, a service worker, or an installable-app cache.
- Live updates of other people's changes. A remembered screen may show their
  change one refresh late, as it does today with a reload.
- Remembering reads after the tab closes.
- Caching on the copy page (`CopyPage`), see "Which screens remember".
- Changing how covers look, their sizes, or the cover tile states.
- Moving covers into storage of our own (R2, D1). The edge cache holds them.
- Changing the reload on a back-forward cache restore (`App.tsx`, `pageshow`).
  With remembered reads, that reload draws at once anyway.

## Anti-goals

- A remembered screen that shows controls for a state that is gone, after your
  own write. Your writes always clear the memory.
- A refresh that moves the covers you are looking at. This includes moving the
  wall away from the place `useWallPlace` restored. (A new request bar or alert
  at the very top may push the wall down when you're at the top. That is
  deliberate, see "Wall places".)
- A cover route anyone can use to fetch arbitrary URLs, or one that serves
  anything but an image from our origin.
- A deploy that doesn't reach a browser because the HTML got cached.
- One person's library data drawn for another person, or left behind after
  sign-out.

## Approaches considered

The maintainer picked the approach in the brainstorm. These were the
alternatives:

- **Covers: a Worker proxy with the edge cache (chosen).** One route,
  `/covers/…`, fetches only from the two cover hosts (following Open Library's
  archive.org redirects), keeps the image in Cloudflare's cache, and gives
  browsers a long lifetime. Readers' browsers stop contacting Open Library and
  Google.
  - *Leave covers on third parties.* Not chosen: covers that redirect go back
    to the network every visit.
  - *Copy covers into R2 at pairing time.* Not chosen: it needs a backfill, a
    bucket and a write path, for images the edge cache already keeps.
  - *Workers Cache (`"cache": { "enabled": true }`).* Not chosen: it charges
    every request to the Worker, static assets included, and it caches the
    Worker's own responses, not the upstream fetch.
- **Return visits: remember each screen's last read (chosen),** and refresh
  behind it.
  - *A client-side router,* so screens stay mounted. Not chosen: it is a
    rewrite of navigation, for a problem a small memory solves.
  - *HTTP caching of `/api/*`.* Not chosen: those answers differ per person and
    are `no-store` on purpose.
- **Shift: reserve the space in the skeleton (chosen),** then measure and fix
  what's left.
  - *Hide the page until everything has loaded.* Not chosen: it trades a jump
    for a blank screen.

## What the code and the hosts do today

- **Every screen change is a full page load.**
  - Links are plain `<a href>`. `App` reads `location` once, and there is no
    client-side router.
  - So anything kept in JavaScript memory is gone on the next screen. The
    wall's scroll place survives only because it is in `sessionStorage`
    (`src/client/wall/memory.ts`).
  - **This changes one word of the approved plan.** The plan kept the last
    read "in memory". In-memory state can't survive a full page load, so the
    memory lives in `sessionStorage`, next to the wall place. **(call)**
- **Boot is two round trips in a row.** `App` calls `getMe`, and only when it
  answers do the screen's own reads start. Mine reads `myCollections`, then
  every shelf in parallel, plus `listRequests`. `/api/me` answers a signed-out
  visitor 200 `{ member: null }`, not 401.
- **Screens on `useLoaded`:** Mine (wall and requests), Shelf, Members (the list
  and a member's wall), People and Holding. CopyPage has its own loader.
- **Cover URLs.**
  - Covers are stored only if they are https on `covers.openlibrary.org` or
    `books.google.com` (`safeCoverUrl` in `src/shared/bookFacts.ts`).
  - Open Library ones come from `cover.medium` in the `/b/id/<n>-M.jpg` form.
  - Every cover `<img>` is made in one place, `CoverFor` in
    `src/client/screens/BookCard.tsx`.
  - The preview fixtures use `/b/id/` URLs, plus one deliberately broken one on
    `covers.invalid`.
- **How the cover hosts answer** (curl on 2026-11-28, with the booklookup
  User-Agent and no referrer, on the preview fixtures' public ids):
  - **Open Library `/b/id/<n>-M.jpg`:** some covers answer 200 directly, with
    `expires` a century out. Others answer **302 to `archive.org`**, which
    answers 302 to an `ia<n>.us.archive.org` host, which answers 200
    `image/jpeg` with `public, max-age=10800`. The archive.org 302 carries no
    cache headers, so the browser follows the chain on every visit. (The
    handoff said Open Library no longer redirects. That holds only for some
    covers.)
  - **Open Library `-L.jpg?default=false`:** redirects the same way. A missing
    one is a 404 with an empty body. A missing `-M.jpg` without
    `default=false` is 200 `image/gif`, 43 bytes (the 1×1 placeholder).
  - **Google `books/content?id=…&printsec=frontcover&img=1&zoom=1`:** a real
    cover is 200 `image/jpeg` with `private, max-age=86400`, fetched with no
    cookies and no redirect. An unknown id is 200 `image/png`, about 1.3 KB
    (the "image not available" picture), with `private, max-age=30`. Other
    paths under `/books` return HTML with `Set-Cookie`.
- **Static assets** get Cloudflare's default
  `Cache-Control: public, max-age=0, must-revalidate`, because there is no
  `_headers` file.
- **Fonts:** the build emits `fraunces-latin-wght-normal-<hash>.woff2` (37 KB)
  and `geist-latin-wght-normal-<hash>.woff2` (29 KB) in `dist/client/assets`,
  among other subsets. Nothing preloads them. Blocking the fonts entirely
  changed no vertical geometry on the wall at 375, 414 or 812px, so the swap is
  not what moves the covers.

## PR 1: caching

### Asset headers

- **Add `public/_headers`.**
  - Vite copies it to `dist/client`, and the Cloudflare Vite plugin applies it
    at build, preview and deploy
    ([docs](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)).
  - In `vite preview`, the hashed assets then carry exactly one
    `Cache-Control`, the immutable one, with or without a `! Cache-Control`
    line. Keep the line, which the docs recommend for replacing a value.
  - The file:

  ```
  /assets/*
    ! Cache-Control
    Cache-Control: public, max-age=31536000, immutable
  ```

- **Only `/assets/*` changes.** Every file there has a content hash in its name.
  The HTML, the manifest and the icons keep the default, so a deploy always
  lands.
- **The rule also reaches the single-page-app fallback (accepted risk, call).**
  - A request for a missing `/assets/…` file gets `index.html` with the
    immutable header. This was seen in `vite preview`, and Cloudflare's routing
    docs say the same holds in production when `run_worker_first` is an array.
  - The only way it happens is a tab open across a deploy that lazy-loads an
    old chunk or the scanner's wasm after it. That load fails today too.
  - What's new: that browser keeps the HTML under the old file name for a year.
    It only matters if a later deploy brings back exactly that file, which
    happens with a revert.
  - The fix would be `not_found_handling: "none"`, with the Worker serving the
    page for navigations. That costs a Worker request per page load and
    changes routing, which is too much for this risk.
  - **If a release is ever reverted,** change the reverted chunks so their
    hashes differ. Write this down in the README's release notes.
- **`_headers` doesn't apply to Worker responses**
  ([docs](https://developers.cloudflare.com/workers/static-assets/headers/)), so
  the cover route sets its own headers.

### Font preload

- A small Vite plugin in `vite.config.ts` adds two
  `<link rel="preload" as="font" type="font/woff2" crossorigin href="…">` tags
  to the built `index.html`.
  - It runs in `transformIndexHtml` and reads the bundle.
  - It adds one link each for the latin `wght` normal file of Fraunces and of
    Geist.
  - `crossorigin` is required, or the browser fetches each font twice.
- **The build fails if either file is missing from the bundle** (after a
  fontsource rename, say), so the preload can't silently go away. **(call)**
- It is build-only, since `vite dev` doesn't need it. **(call)**
- This is a loading-speed change, not a shift fix. The measurement above found
  that the swap doesn't move the covers.

### Cover proxy

**Route.** `GET /covers/<source>/<path>?<query>`. The client and the Worker
both accept only these shapes, and anything else stays direct **(call)**:

| key  | upstream host                    | path                                        | query |
|------|----------------------------------|---------------------------------------------|-------|
| `ol` | `covers.openlibrary.org`         | `/b/id/<digits>-<S\|M\|L>.jpg` or `/b/olid/OL<digits>M-<S\|M\|L>.jpg` | none, or exactly `default=false` |
| `gb` | `books.google.com`               | `/books/content`                            | `id` (letters, digits, `_`, `-`), and optionally `printsec=frontcover`, `img=1`, `zoom=<digit>`, `source=<letters/_>`. Nothing else. |

- **The upstream URL is rebuilt** from the fixed host, the path and a
  canonical query: allowed parameters only, in a fixed order. Nothing in the
  request can name another host, so it isn't an open proxy. The canonical form
  is also the edge cache key, so extra parameters can't make cache-bypassing
  copies. `?default=false` is kept.
- **`/b/isbn/` covers stay direct.** Open Library rate-limits that form per IP,
  and Workers share Cloudflare's outbound addresses. The app stores `/b/id/`.
  **(call)**
- **Add `/covers/*` to `assets.run_worker_first`** in `wrangler.jsonc`. Without
  it, the preview served `index.html` for a cover path.
- **The client rewrites, and the API doesn't change (call).**
  - `covers.ts` gains `coverSrc(url)`. It maps a stored URL of an allowed shape
    to its `/covers/…` path, and leaves any other URL as it is.
  - `CoverFor` applies it to each attempt after `largerCover`.
  - Stored data, API answers, Pair and the lookup's tests stay as they are. The
    preview's `covers.invalid` fixture still fails, as it should.
- **The direct URL stays as the last attempt (call).**
  - `CoverFor`'s attempts become, in order:
    1. the proxied larger cover (hero only)
    2. the proxied stored cover
    3. the stored cover, direct
  - Whether the hosts answer Cloudflare's own addresses can't be tested before
    release. If they refuse, covers fall back to what happens today instead of
    all showing "Cover didn't load".
  - The cost is one extra request for a cover that is truly missing.

**Handling, in order:**
1. **Methods.** Only GET and HEAD are answered; anything else gets 405. A HEAD
   uses the GET request as its cache key, because `cache.put` and `match`
   accept only GET.
2. **Cross-site.** When `Sec-Fetch-Site` is `cross-site` or `same-site`, answer
   403, as `/api/books/lookup` does. Our own `<img>` tags are same-origin. This
   stops other sites embedding the route; it doesn't stop scripts, which the
   shape rules and the edge cache limit instead. **(call)**
3. **Shape.** An unknown key, or a path or query outside the table, gets 404
   with no upstream fetch.
4. **Edge cache.** Look up the canonical URL in `caches.default`. A hit is
   returned as it is.
5. **Fetch.** On a miss, fetch upstream with the booklookup `User-Agent`, no
   cookies, no referrer, and a timeout of about 8 seconds for the whole chain
   (the builder may tune it).
   - For `ol`, always ask upstream with `default=false`, so a missing cover is a
     404 the host tells us, never a 1×1 image. **(call)**
   - **Redirects are followed by hand** (`redirect: "manual"`), at most three
     hops, and only to https URLs whose host is on the source's list:
     - `ol`: `covers.openlibrary.org`, `archive.org` or any `*.archive.org`.
     - `gb`: `books.google.com`.
     - A hop anywhere else is a 502.
     - These hops are followed only when the cover host sends them, so nothing
       in the request can point the Worker at archive.org directly. **(call)**
6. **Classify the final answer:**
   - **Image:** status 200, a `Content-Type` of `image/jpeg`, `image/png`,
     `image/gif` or `image/webp`, and a body under 2 MB.
     - `ol`: `Cache-Control: public, max-age=31536000, immutable`. Put it in the
       edge cache for the same time.
     - `gb`: `Cache-Control: public, max-age=86400`. Put it in the edge cache
       for a day. Google's terms bar keeping copies longer than its cache
       header allows, and Google sends a day, so the proxy keeps a day.
       **(call)**
   - **Missing:** a 404 from `ol`, or Google's placeholder (200 with an
     upstream `max-age` under an hour, as observed). Answer 404 with
     `Cache-Control: public, max-age=86400`, and keep it in the edge cache for
     a day. A cover that appears upstream later shows up within a day.
     **(call)**
     - Making Google's placeholder a 404 sends the client to the direct URL,
       which shows the same "image not available" picture as today.
     - It also means a Google that answered Cloudflare only with placeholders
       would show up as 404s in the logs, not as a quiet success.
   - **Anything else:** a 5xx, a timeout, a wrong content type, too large, or a
     bad redirect. Answer 502 with `no-store`, and don't cache it.
7. **Response headers.** A response from this route carries only
   `Content-Type`, `Content-Length`, `Cache-Control`,
   `X-Content-Type-Options: nosniff` and
   `Content-Security-Policy: default-src 'none'`. No upstream header passes
   through, `Set-Cookie` included.
8. **Logging.** Log one line per upstream fetch: the source key, the class
   (image, missing, error), the upstream status and the hop count. Never log
   the full URL's query.
- `cache.put` runs in `ctx.waitUntil`, so the reply doesn't wait on it. The
  builder confirms in a test, or on release day, that a 404 is stored. If it
  isn't, the missing-cover fetch just repeats, which is harmless.

**Access: no session needed (call).**
- The public label page (`/b/<code>`) shows a cover to signed-out visitors.
- A cover tells a stranger nothing the upstream wouldn't.
- The shape rules mean the route can only ever fetch a cover image, and the
  edge cache absorbs repeats.

**Being a good client (call).**
- Open Library asks sites to point `src` at `covers.openlibrary.org`, so that
  load goes through their cover service. The proxy still fetches from
  `covers.openlibrary.org`, through their redirects, and it cuts their traffic,
  because the edge and the browser keep each cover.
- If Open Library objects, removing `coverSrc` for `ol` puts covers back on
  direct URLs.

**Cost.**
- Each browser makes one Worker request per cover, the first time it sees it.
  For Google covers, that is once a day.
- A request uses one cache match, at most four upstream fetches and one put,
  well inside the 50 subrequests the free plan allows each request.
- About 250 covers of a few dozen KB is nothing to the edge cache. The edge
  cache is per data centre and may evict, and a miss just refetches.

**Module and tests.**
- The route lives in `src/worker/covers/`. It is built like
  `createBookLookup`: `createCoverProxy({ fetch, cache, timeoutMs })`.
- Tests stub both the upstream and the cache, following the stubs in
  `src/worker/booklookup/booklookup.test.ts`, and never reach the real hosts.
- The fixtures are shaped like the observed answers:
  - the two-hop archive.org chain
  - a direct 200
  - the empty 404
  - Google's real cover and its placeholder
- A table of hostile inputs asserts `new URL(upstream).host` for every case:
  - encoded slashes, `..`, `@`, backslashes and extra parameters
  - a redirect to another host
- `index.ts` wires the module with the global `fetch` and `caches.default`.
- A route test in `index.test.ts` covers what needs no upstream:
  - a bad key, path or query is 404
  - POST is 405
  - cross-site is 403
  - a cover path doesn't return the app's HTML
- Under `vite dev`, the route runs in the plugin's local workerd. The code must
  not depend on a cache hit there.

### Remembered reads

**Where.** In `sessionStorage`, one entry per read, with keys prefixed `read:`.
Each entry is an envelope `{ build, epoch, member, data }`:

- **`build`:** a build id that Vite injects with `define`. An entry from
  another build is ignored and removed, so a deploy mid-session never feeds
  old-shaped data to new code. **(call)**
- **`epoch`:** a number in `localStorage` (`read-epoch`), shared by every tab.
  It is bumped on sign-in start and on sign-out. An entry with another epoch is
  ignored, and every `read:` entry in the tab is cleared.
  - `sessionStorage` is per tab, but the session cookie isn't. Without the
    epoch, signing out in one tab and in as someone else would leave the first
    person's reads drawing in the other tab. **(call)**
  - If `localStorage` can't be read, nothing is remembered.
- **`member`:** the id of the member the read was made for. An entry is used
  only while that is the current member.

**The current member.**
- `App` holds it, and passes it to the screens as it does today.
- `useLoaded` gets it through a new `memory` option,
  `useLoaded(load, enabled, { key, member })`. Without the option, `useLoaded`
  behaves exactly as it does now.

**Hook behaviour with `memory`:**
- **First render:** if `enabled` and a usable entry exists, the state starts as
  `{ status: "ok", data }`. The read happens in the `useState` initialiser, so
  StrictMode's double effects don't matter.
- **The effect still runs `reload`,** as it does today.
- **When the refresh lands with the same data** (compare the JSON text), there
  is no `setState`. Nothing re-renders, and nothing moves. This is the common
  case.
- **When it lands with different data:** set it, and store it if it may be
  stored:
  - **Generation counter.** A read stores only if it is still the latest
    (`mine === latest`, as today) and no clear has happened since it started.
    The store keeps a clear counter, bumped by every clear, and the read checks
    it on landing. A read that lands after a write must not store old data.
  - **Partial walls.** A wall with `failed > 0` is shown but not stored.
  - **Failed writes.** If `setItem` fails (a full store or private mode), the
    key is removed, so an older entry can't survive in its place.
- **A 401:** clear every `read:` entry and go `lost`, as today.
- **A 404:** drop this key and go `gone`, as today.
- **Any other failure while remembered data is showing:** keep showing it. Don't
  replace the screen with "Something went wrong". The remembered data is at
  most this session old, and the next visit tries again. With nothing
  remembered, a failure is `failed`, as today. **(call)**
- `retry` and `lose` behave as today.

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
  Without it, a remembered wall still waits for `/api/me`, showing only the app
  name. `App` doesn't use `useLoaded`, so it reads and writes the same store
  through the same helper. **(call)**
  - `App` starts from the remembered member, if its epoch is current, and
    verifies it behind.
  - **If `/api/me` answers with no member, or a different one:** clear every
    `read:` entry, bump the epoch, and reload the page (`location.reload()`).
    The reload means nothing from the first member, a wall filter included,
    carries into the next render.
  - **If `/api/me` fails** (a network error or a 503) while a remembered member
    is showing, keep showing it, as the screens keep their data. With nothing
    remembered, it behaves as today: a 503 is the trouble page, and anything
    else is sign-in.
  - **What's left:** when a session ends by expiring, with no sign-out, the tab
    draws that same member's own last screen for one round trip, then drops to
    sign-in. It never draws another member's data, because signing in, from
    any tab, bumps the epoch.
- **CopyPage is left out.**
  - It is where actions happen (claim, return, lend, approve). A copy shown
    from memory could offer an action for a state someone else has just
    changed.
  - It is also usually reached from a wall that is already fresh.

**Clearing.** In `src/client/api.ts` and its callers:
- **Writes.** Every non-GET `call` clears all `read:` entries when it starts and
  again when it settles, success or failure. Each clear bumps the clear counter
  (see above).
- **Sign-out.** `logout` clears them and bumps the epoch, before the request.
  Other tabs drop their entries the next time they draw.
- **401s.** Any 401 from `call` clears them.
- **Sign-in.** Starting one clears them and bumps the epoch. Every link to
  `/auth/login` goes through one helper that does this.
- **Boot.** `/api/me` answering with no member, or another member, clears them
  (see above).
- **Other tabs' writes.** A write in another tab doesn't clear this one, so this
  tab shows the old state for one refresh. That is accepted.

**Size.** A wall of about 250 books is a few hundred KB of JSON, well under
`sessionStorage`'s quota.

**Wall places.** `useWallPlace` restores once, when `ready` first turns true.
With remembered data, that is the first render, against the same layout the
person left, which is what it was built for. The antagonist confirmed this
restores correctly, because the collection ids are known at init. The refresh
must not undo it:
- **If the data is unchanged,** nothing renders (see above).
- **If the data changed and the person is above the anchor** (usually at the
  top), whatever is new above the chips appears, and the covers move down. A
  new request or alert is news, so it stays in view. `useWallPlace` already
  follows this rule when it restores. It is rare, because the requests or the
  alerts must have changed since the last visit. **(call)**
- **If the data changed and the person is scrolled into the covers:**
  - **Where the browser does scroll anchoring** (`overflow-anchor`: Chrome,
    Firefox, and Safari from 27), leave it to the browser. In a Chrome probe, a
    row inserted above the viewport left the visible cover exactly where it
    was. Correcting by the chips row on top of that moved it 161px.
  - **Where `CSS.supports("overflow-anchor", "auto")` is false,** keep the
    first visible cover (by `copyId`) at its position on screen: measure it
    before the commit, then `scrollBy` the difference in a layout effect.
  - **Never anchor on the chips row** for this. Changes inside the grid are the
    common case.
  - The builder decides whether this lives in `useWallPlace` or in `CoverWall`.
- **Mine's `ready`** needs both reads. Both are remembered, so `ready` is true at
  once on a return visit, and it stays true through the refresh, because the
  state stays `ok`.
- **Testing:** per `.claude/agents/antagonist-techniques.md`, check `scrollY`
  deep in the wall, not only at the top.

## PR 2: layout shift

### What moves today

The antagonist's probe at 375px:
- The skeleton's first tile sits at y=85; in the loaded wall it lands at y=246.
- Tiles also narrow from 106 to 97px when the rail's gutter appears (119 to
  110px at 414, 143 to 138px at 812). That makes every row shorter.

What appears only once loaded:
- the count line
- the pinned row: chips, plus the find box where it shows
- the first letter heading (25px plus margins)
- the rail gutter (`.wall[data-rail]` in `wall.css`)

### Skeleton

- While `loading`, `CoverWall` reserves all four:
  - **Count line, pinned row and letter heading:** placeholders of the same
    height as the real ones (the pinned row is 60px, or 104px on an upright
    phone with the find box). Use the same CSS boxes as the real elements, so
    the heights can't drift apart.
  - **Rail gutter:** reserved on Mine's skeleton only. Mine has the rail with
    any real library. Other walls can't know before their data lands, and are
    usually short. **(call)**
- The placeholders are `aria-hidden`, and have no controls a person can reach.
- The anchor (`WALL_ANCHOR`) still appears only when the wall is ready.
- An empty or incomplete wall, which has no count line or rail, may still close
  the reserved space when its data lands. That is rare, and accepted.
  **(call)**
- With PR 1, a return visit doesn't show the skeleton at all. This fixes first
  visits and fresh tabs.

### Measure

- **Don't use CLS for this.** React replaces the skeleton's nodes rather than
  moving them, and the `layout-shift` API scores only nodes present in both
  frames.
  - The real transition, where the first tile moves 160px, scored 0.
  - A control, a 100px insert above the wall, scored 0.097, so the probe works.
  - CLS still catches other shifts. Record it, but don't judge PR 2 by it.
- **What to measure:**
  - the first tile's `getBoundingClientRect` (top and width) in the skeleton
  - the same in the loaded wall
  - the difference between the two
- **Tool:** a copy of `scripts/shoot.mjs` in the scratchpad, with
  `captureBeyondViewport: false` and an eval hook.
- **Where:** the dev preview (`/src/client/preview/preview.html?view=wall`).
  PR 2 adds a `&loadfor=<ms>` parameter that shows the skeleton for that long,
  then the wall. **(call)** The preview skips App's boot. That's fine, because
  the skeleton is the same either way.
- **When:** before any PR 2 change, then after.
  - Widths: 375 and 414 upright, and one landscape phone width.
  - Both colour schemes.
  - Record the numbers in the PR body. The goal is a difference of 0 for the
    top, and for the width on Mine.
- Fix any other shift it finds, within the wall screens.

### Fonts

The probe found the font swap moves nothing vertically on the wall, so PR 2
adds no metric-matched fallback fonts. If the measurement after the skeleton
change shows otherwise, add `@font-face` fallbacks over Georgia and system-ui
with `size-adjust` and the `*-override` descriptors, second in the font
stacks. Say which way it went in the PR. **(call)**

## Verification

- **PR 1, locally (`pnpm build`, then `vite preview`, then curl):**
  - A file under `/assets/` has exactly one `Cache-Control`, the immutable one.
    The HTML and the manifest are still revalidated.
  - `/covers/ol/b/id/<fixture id>-M.jpg` is an image with the long lifetime and
    no `Set-Cookie`. Use a fixture that redirects, such as `12645114`, which
    proves the chain is followed.
  - `/covers/xx/…`, `/covers/ol/../…`, `/covers/ol/b/isbn/…` and
    `/covers/gb/books?id=…` get 404, with no upstream fetch.
  - The built `index.html` has both preload links, and their files exist.
  - In the preview, a return visit to the wall renders with no skeleton, and
    keeps its scroll place deep down.
  - With the wall scrolled deep, the remembered data is changed so a refresh
    inserts covers above the viewport. The visible cover doesn't move.
- **After the maintainer releases PR 1:**
  - A read-only curl of the live site confirms the same headers.
  - A live `/covers/ol/b/id/<fixture id>-M.jpg` and one Google cover come back
    as images.
  - Workers Logs show the cover classes. Mostly "image" means the proxy works.
    Mostly "error", or "missing" for Google, means a host is refusing
    Cloudflare, and covers are showing only because of the direct fallback.
- **PR 2:** the before and after tile positions, and CLS, in the PR body.
- **The maintainer's phone checks:**
  - Going back to the wall from a book is instant, and stays where it was.
  - Covers show on a second visit with no flicker.
  - The first load doesn't jump.

## Left to the builder

- Exact names, the file layout inside `src/worker/covers/`, and how `coverSrc`
  parses.
- The upstream timeout, within reason.
- Where the anchor-keeping on refresh lives.
- How the build id is made (a hash or a timestamp both do).
- The exact placeholder markup in the skeleton, as long as it uses the real
  boxes.

## Off limits

- `storygraph_export.csv` and `.dev.vars`.
- Fetching real covers by the library's own ISBNs. Use the preview fixtures'
  ids or well-known public ISBNs.
- `wrangler deploy`, `--remote` writes, and tags without the maintainer's
  approval.
