# Caching and Layout Shift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Screens you come back to draw at once from what they showed last, the app's own files and the covers stop going back to the network, and a first-ever wall load no longer moves the covers when the data lands.

**Architecture:** PR 1 adds a `_headers` file and a font-preload Vite plugin, a `/covers/*` Worker route that fetches only cover-shaped URLs from Open Library and Google through `caches.default`, and a `sessionStorage` memory that `useLoaded` and `App`'s boot read draw from and every write clears. PR 2 makes `CoverWall`'s skeleton reserve the count line, the pinned row, the first letter heading and (on Mine) the rail gutter, measured by tile position in the dev preview.

**Tech Stack:** Cloudflare Workers + Hono, the Cloudflare Vite plugin, React 19, TypeScript, Vitest (workers pool and jsdom), headless Chrome over CDP for measurement.

**Spec:** `docs/superpowers/specs/2026-11-28-caching-and-shift-design.md`. It is approved and is the source of truth. Don't reopen anything it marks **(call)**.

## Global Constraints

- **Two PRs.**
  - PR 1 (Tasks 1–10) is built on the existing branch `caching-and-shift`, rebased on `main`, and opened with `gh pr create`.
  - PR 2 (Tasks 11–13) goes on a new branch, `layout-shift`, cut from `main` after PR 1 merges.
  - Agents don't merge or tag without the maintainer's approval (`AGENTS.md`).
- **Review per task.** After each task, run the ordinary task review **and** an antagonist pass (`.claude/agents/antagonist.md`). BLOCKING and SHOULD-FIX findings go back into the fix loop before the next task starts.
- **The `app` check** runs `pnpm wrangler types --check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`. All of them must pass at the end of every task.
- **Naming.** Committed text (code, docs, commits, PR bodies) says "the maintainer", never a name.
- **Off limits.**
  - Never print, commit or send `storygraph_export.csv` or `.dev.vars`.
  - Never fetch covers by the library's own ISBNs. Use the preview fixtures' ids (`12645114`, `110556`, `109033`, `10541361`, `103292`).
  - Tests never reach a real host. Stub the global `fetch` to throw, as `booklookup.test.ts` does.
  - No `wrangler deploy` and no `--remote` writes.
- **Cache-Control values, verbatim:**
  - `/assets/*`: `public, max-age=31536000, immutable`
  - an `ol` image: `public, max-age=31536000, immutable`
  - a `gb` image: `public, max-age=86400`
  - missing: 404 with `public, max-age=86400`
  - error: 502 with `no-store`
- **Cover responses carry only these headers:** `Content-Type`, `Content-Length`, `Cache-Control`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`.
- **The memory.**
  - Keys start with `read:`.
  - Each entry is an envelope `{ build, epoch, member, data }`.
  - The epoch lives in `localStorage` under `read-epoch`.
  - `CopyPage` never remembers.
- **What doesn't change:** the API, stored cover URLs, Pair, the lookup's tests, the `pageshow` reload in `App.tsx`, and cover sizes and tile states.

## Review Focus

1. **Storage that throws or holds junk:** private mode, a full quota, truncated JSON, an entry that isn't an envelope, or a `read-epoch` that isn't a number. The screen loads exactly as it does today, and the bad entry is removed. Tested in Task 6.
2. **A redirect `Location` that is relative, protocol-relative (`//evil.test/x`), `http:`, carries userinfo (`https://u@archive.org`), or names a look-alike host (`archive.org.evil.test`, `evilarchive.org`).** Resolve it against the current URL, then hold it to the source's host list. Every case is a 502, or a fetch only to an allowed host. Tested in Task 3.
3. **An upstream image with no `Content-Length` and a body over 2 MB, or a `Content-Length` that lies low.** The reply is 502, and reading stops at the limit; the body is never buffered whole. Tested in Task 3.
4. **A HEAD before any GET.** It fetches upstream, stores the GET-shaped entry, and answers with headers and no body. A GET after it is then a cache hit. Tested in Task 3.
5. **A signed-out visitor on a public label page (`/b/<code>`).** Covers go through the proxy with no cookie and load, and the route never answers 401. Tested in Task 4.

---

## PR 1: caching (branch `caching-and-shift`)

### Task 1: Asset headers and font preload

**Files:**
- Create: `public/_headers`
- Create: `vite/fontPreload.ts`, `vite/fontPreload.test.ts`
- Modify: `vite.config.ts`, `tsconfig.node.json` (add `"vite"` to `include`), `vitest.client.config.ts` (add `"vite/**/*.test.ts"` to `include`)
- Modify: `README.md`, under "Deploying", for the revert note

**Interfaces:**
- Produces:
  - `fontPreloadTags(fileNames: string[]): HtmlTagDescriptor[]`, from `vite`. It throws an `Error` naming the missing font when either file is absent.
  - `fontPreload(): Plugin`, with `apply: "build"`, whose `transformIndexHtml(html, ctx)` returns `fontPreloadTags(Object.keys(ctx.bundle ?? {}))`.

- [ ] **Step 1: Write `public/_headers`** with exactly the three lines in the spec under "Asset headers" (`/assets/*`, `! Cache-Control`, `Cache-Control: public, max-age=31536000, immutable`).

- [ ] **Step 2: Write the failing tests** in `vite/fontPreload.test.ts`. Start the file with `// @vitest-environment node`.

```ts
const bundle = ["assets/index-abc.js", "assets/fraunces-latin-wght-normal-Ab12.woff2", "assets/fraunces-latin-ext-wght-normal-Zz.woff2",
  "assets/geist-latin-wght-normal-Cd34.woff2", "assets/geist-cyrillic-wght-normal-Q.woff2"];

test("one preload per font, the latin wght normal file only, crossorigin, in the head", () => {
  expect(fontPreloadTags(bundle)).toEqual([
    { tag: "link", injectTo: "head", attrs: { rel: "preload", as: "font", type: "font/woff2", crossorigin: true, href: "/assets/fraunces-latin-wght-normal-Ab12.woff2" } },
    { tag: "link", injectTo: "head", attrs: { rel: "preload", as: "font", type: "font/woff2", crossorigin: true, href: "/assets/geist-latin-wght-normal-Cd34.woff2" } },
  ]);
});

test.each(["fraunces", "geist"])("the build fails when the %s file is missing", (font) => {
  expect(() => fontPreloadTags(bundle.filter((f) => !f.includes(`${font}-latin-wght`)))).toThrow(font);
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm vitest run --config vitest.client.config.ts vite/fontPreload.test.ts`
Expected: FAIL, because `vite/fontPreload.ts` doesn't exist yet.

- [ ] **Step 4: Implement `vite/fontPreload.ts`**, and add `fontPreload()` to `plugins` in `vite.config.ts`. Match file names with `/^assets\/<font>-latin-wght-normal-[\w-]+\.woff2$/`.

- [ ] **Step 5: Run the tests and see them pass.** Run the same command. Expected: PASS.

- [ ] **Step 6: Check the build and the headers**

```bash
pnpm build && grep -c 'rel="preload"' dist/client/index.html   # 2
for f in $(grep -o 'assets/[^"]*\.woff2' dist/client/index.html); do test -f dist/client/$f && echo ok; done   # ok twice
pnpm vite preview --port 4173 &   # stop it after the curls
curl -sI http://localhost:4173/assets/$(ls dist/client/assets | grep '\.js$' | head -1) | grep -ci '^cache-control'   # 1
curl -sI http://localhost:4173/assets/$(ls dist/client/assets | grep '\.js$' | head -1) | grep -i '^cache-control'    # public, max-age=31536000, immutable
curl -sI http://localhost:4173/ | grep -i '^cache-control'                       # public, max-age=0, must-revalidate
curl -sI http://localhost:4173/manifest.webmanifest | grep -i '^cache-control'   # public, max-age=0, must-revalidate
```

- [ ] **Step 7: Add the revert note to the README.** Under "Deploying", add one paragraph: hashed files under `/assets/` are cached for a year, so a release that reverts code must change the reverted chunks so their hashes differ (see the spec's "Asset headers").

- [ ] **Step 8: Commit** with the message `feat: immutable assets and font preload`.

### Task 2: Cover shapes, shared by the Worker and the client

**Files:**
- Create: `src/shared/coverShape.ts`, `src/shared/coverShape.test.ts` (the worker config already runs `src/shared/**/*.test.ts`)

**Interfaces:**
- Produces:
  - `type CoverSource = "ol" | "gb"`
  - `coverRoute(stored: string): string | null`: a stored cover URL becomes its canonical `/covers/<source>/…` path, or `null` when the URL isn't one of the table's shapes.
  - `coverTarget(rawPathname: string, rawSearch: string): { source: CoverSource; route: string; upstream: string } | null`
    - It takes the raw request URL's `pathname` and `search`, still percent-encoded, never Hono's decoded path.
    - `route` is the canonical path and query, which becomes the edge cache key.
    - `upstream` is the URL to fetch. For `ol`, it always ends in `?default=false`.
- **The rules, from the spec's table.** Match the raw text with anchored regexes; never decode it first.
  - `ol`: the path is `/b/id/<digits>-<S|M|L>.jpg` or `/b/olid/OL<digits>M-<S|M|L>.jpg`, and the query is empty or exactly `default=false`.
  - `gb`: the path is `/books/content`. The query is `&`-separated `key=value` pairs:
    - `id` (`[A-Za-z0-9_-]+`) is required.
    - `printsec=frontcover`, `img=1`, `zoom=<digit>` and `source=[A-Za-z_]+` are optional.
    - Any other key, a repeated key or a `%` anywhere means `null`.
    - The canonical order is `id, printsec, img, zoom, source`.
  - `coverRoute` also needs `https:`, the exact host, no userinfo and no port. `/b/isbn/` is never a shape.

- [ ] **Step 1: Write the failing tests**

```ts
const OL = "https://covers.openlibrary.org/b/id/12645114-M.jpg";
const GB = "https://books.google.com/books/content?id=abc_D-1&printsec=frontcover&img=1&zoom=1&source=gbs_api";

test("stored covers map to their route; the stored Google form keeps its parameters in canonical order", () => {
  expect(coverRoute(OL)).toBe("/covers/ol/b/id/12645114-M.jpg");
  expect(coverRoute(`${OL.replace("-M", "-L")}?default=false`)).toBe("/covers/ol/b/id/12645114-L.jpg?default=false");
  expect(coverRoute("https://covers.openlibrary.org/b/olid/OL7353617M-M.jpg")).toBe("/covers/ol/b/olid/OL7353617M-M.jpg");
  expect(coverRoute(GB)).toBe("/covers/gb/books/content?id=abc_D-1&printsec=frontcover&img=1&zoom=1&source=gbs_api");
  expect(coverRoute("https://books.google.com/books/content?zoom=1&id=x")).toBe("/covers/gb/books/content?id=x&zoom=1");
});

test.each([
  "http://covers.openlibrary.org/b/id/1-M.jpg", "https://covers.openlibrary.org/b/isbn/9780141439518-M.jpg",
  "https://covers.openlibrary.org/b/id/1-M.jpg?default=true", "https://covers.openlibrary.org:444/b/id/1-M.jpg",
  "https://u@covers.openlibrary.org/b/id/1-M.jpg", "https://books.google.com/books?id=x", "https://books.google.com/books/content?id=x&x=1",
  "https://books.google.com/books/content?id=x&id=y", "https://books.google.com/books/content?printsec=frontcover",
  "https://covers.invalid/b/id/1-M.jpg", "not a url",
])("%s stays direct", (url) => expect(coverRoute(url)).toBeNull());

test("the upstream is rebuilt on the fixed host; ol always asks with default=false", () => {
  expect(coverTarget("/covers/ol/b/id/1-M.jpg", "")).toEqual({ source: "ol", route: "/covers/ol/b/id/1-M.jpg", upstream: "https://covers.openlibrary.org/b/id/1-M.jpg?default=false" });
  expect(coverTarget("/covers/gb/books/content", "?img=1&id=x")).toEqual({ source: "gb", route: "/covers/gb/books/content?id=x&img=1", upstream: "https://books.google.com/books/content?id=x&img=1" });
});

test.each([
  ["/covers/xx/b/id/1-M.jpg", ""], ["/covers/ol/b/id/../1-M.jpg", ""], ["/covers/ol/b/id/1-M.jpg%2F..%2F", ""],
  ["/covers/ol/b/id%2F1-M.jpg", ""], ["/covers/ol/b/isbn/9780141439518-M.jpg", ""], ["/covers/ol//evil.test/b/id/1-M.jpg", ""],
  ["/covers/ol/b/id/1-M.jpg", "?default=false&x=1"], ["/covers/ol/b/id/1-M.jpg\\", ""], ["/covers/gb/books", "?id=x"],
  ["/covers/gb/books/content", "?id=x@evil.test"], ["/covers/gb/books/content", "?id=x%26host%3Devil"], ["/covers/gb/books/content", ""],
])("hostile %s%s is refused", (path, search) => expect(coverTarget(path, search)).toBeNull());

test("every accepted target fetches only its own host", () => {
  for (const [p, s] of [["/covers/ol/b/id/9-S.jpg", "?default=false"], ["/covers/gb/books/content", "?id=a&zoom=5"]] as const) {
    const t = coverTarget(p, s)!;
    expect(new URL(t.upstream).host).toBe(t.source === "ol" ? "covers.openlibrary.org" : "books.google.com");
  }
});

test("a stored URL's route is itself an accepted target, with the same route back", () => {
  for (const url of [OL, GB]) {
    const route = new URL(coverRoute(url)!, "https://x.test");
    expect(coverTarget(route.pathname, route.search)?.route).toBe(coverRoute(url));
  }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run --config vitest.worker.config.ts src/shared/coverShape.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `src/shared/coverShape.ts`.** It has no imports. It is pure string work on anchored regexes, and builds a `URL` only in `coverRoute`, to read the stored URL's parts.

- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat: cover shapes shared by the proxy and the client`.

### Task 3: The cover proxy module

**Files:**
- Create: `src/worker/covers/index.ts` (it re-exports) and `src/worker/covers/proxy.ts`
- Create: `src/worker/covers/proxy.test.ts`
- Create: `src/worker/covers/fixtures.ts`, with tiny byte bodies and the headers observed in the spec's "How the cover hosts answer"

**Interfaces:**
- Consumes: `coverTarget` from Task 2.
- Produces:

```ts
export type CoverCache = { match(key: Request): Promise<Response | undefined>; put(key: Request, res: Response): Promise<void> };
export type CoverProxyDeps = { fetch: typeof fetch; cache: CoverCache; timeoutMs?: number /* default 8000 */; log?: (line: string) => void /* default console.log */ };
export function createCoverProxy(deps: CoverProxyDeps): { handle(request: Request, waitUntil: (p: Promise<unknown>) => void): Promise<Response> };
export const COVER_USER_AGENT: string; // the booklookup one; move USER_AGENT out of booklookup/sources.ts into one exported constant both import
```

- **Order of handling:** method, then cross-site, then shape, then cache, then fetch. This is the spec's "Handling, in order", steps 1–8.
  - Anything but GET or HEAD is 405.
  - `Sec-Fetch-Site` of `cross-site` or `same-site` is 403.
  - `coverTarget(new URL(request.url).pathname, new URL(request.url).search)` returning null is 404.
  - The cache key is `new Request(new URL(target.route, request.url), { method: "GET" })`, on our own origin, for HEAD too.
- **Upstream fetches** use `redirect: "manual"`, `headers: { "User-Agent": COVER_USER_AGENT }`, no cookie, no referrer, and `signal: AbortSignal.timeout(timeoutMs)`, one signal for the whole chain.
- **Redirects.** Follow at most 3 hops, resolving each `Location` with `new URL(location, current)`.
  - Every hop must be `https:`, have no userinfo, and have a host on the source's list:
    - `ol`: `covers.openlibrary.org`, `archive.org` or `*.archive.org`
    - `gb`: `books.google.com`
  - Any other hop is a 502.
- **Body cap.** Read the body through a reader that counts bytes, and cancel past 2 MB (`2 * 1024 * 1024`). `Content-Length` is only an early reject.
- **"Missing" for Google** is a 200 whose upstream `Cache-Control` `max-age` is under 3600.
- **The stored response is the response returned.** `cache.put` gets a clone, inside `waitUntil`, on image and missing only.
- **A HEAD** returns the same status and headers with a `null` body.
- **Logging.** Log one line per upstream fetch chain: `JSON.stringify({ cover: source, class: "image" | "missing" | "error", status, hops })`. Never log the URL.

- [ ] **Step 1: Write the failing tests.** Use a scripted upstream, `upstream(routes: Record<string, () => Response>)`, which records each URL and init and throws for an unlisted URL. Also use an in-memory `CoverCache` and a `waitUntil` that collects promises; `await Promise.all(...)` them before asserting on the cache. Stub the global `fetch` to throw, as in `booklookup.test.ts`. The tests:
  - **`the archive.org chain is followed to the image, which is kept a year and stored`**
    - The 302 from `covers.openlibrary.org/b/id/12645114-M.jpg?default=false` goes to `archive.org/download/…`, which 302s to `ia800100.us.archive.org/…`, which answers 200 `image/jpeg` with `public, max-age=10800`.
    - Expect 200 and `cache-control: public, max-age=31536000, immutable`.
    - Expect the header names to be exactly the five allowed (sorted), plus nothing from upstream. The upstream answer carries `set-cookie` and `x-upstream`.
    - Expect three fetch calls, every one with `redirect: "manual"`, the user agent, and no `cookie` or `referer` header.
    - Expect one `put` whose key URL is `https://books.test/covers/ol/b/id/12645114-M.jpg`.
    - Expect a log line `{"cover":"ol","class":"image","status":200,"hops":2}`.
  - **`a direct 200 is served the same way`**, with zero hops.
  - **`ol asks upstream with default=false even when the request had none`**, asserting on the recorded URL.
  - **`a missing ol cover (empty 404) is a 404 kept a day, and stored`**
  - **`Google's real cover is kept a day; its placeholder (200 image/png, private, max-age=30) is a 404 kept a day`**
  - **`a cache hit is returned as is, with no upstream fetch`**
  - **`HEAD before any GET fetches, stores the GET-keyed entry, and answers headers with no body; the GET after is a hit`** (Review Focus 4)
  - **`a 5xx, a timeout, text/html, a body over 2 MB, more than three hops, and a bad redirect are 502 no-store and not stored`**
    - A table test.
    - The timeout row uses `timeoutMs: 5` and an upstream that never resolves until its signal aborts.
    - The 2 MB rows are a stream with no `content-length` that yields 512 KB chunks forever, and one with `content-length: 10` that sends 3 MB. Assert the stream was cancelled after at most 5 chunks. (Review Focus 3.)
  - **`redirects are resolved, then held to the host list`** (Review Focus 2)
    - These `Location` values each give 502, with no fetch to any host but the first: `//evil.test/x`, `http://archive.org/x`, `https://u@archive.org/x`, `https://archive.org.evil.test/x`, `https://evilarchive.org/x`, `https://books.google.com/x` (from `ol`), and `https://archive.org/x` (from `gb`).
    - `/download/x` (relative) resolves to `https://covers.openlibrary.org/download/x` and is followed.
  - **`POST is 405; cross-site and same-site are 403; a bad shape is 404; none of them fetch`**

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run --config vitest.worker.config.ts src/worker/covers/proxy.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `createCoverProxy` in `src/worker/covers/proxy.ts`.** Export `COVER_USER_AGENT` from a module both it and `booklookup/sources.ts` import, so the lookup's User-Agent tests stay green unchanged.

- [ ] **Step 4: Run the proxy tests and `pnpm test:worker`.** Expected: PASS, with the booklookup tests unchanged.

- [ ] **Step 5: Commit** with the message `feat: cover proxy with the edge cache`.

### Task 4: Wire the route

**Files:**
- Modify: `src/worker/index.ts`
  - Register `app.all("/covers/*", …)`, so HEAD and POST reach the module. Hono answers HEAD from a GET route.
  - Register it before the `servicesFor` middleware, or exempt `/covers/*` from it, so no services are built for a cover.
  - The handler is `(c) => createCoverProxy({ fetch: (i, init) => fetch(i, init), cache: caches.default }).handle(c.req.raw, (p) => c.executionCtx.waitUntil(p))`.
    - Both `fetch` and `caches.default` are resolved at request time, never captured at module load, so a test's `vi.stubGlobal("fetch", …)` reaches the route.
- Modify: `wrangler.jsonc`: `"run_worker_first": ["/api/*", "/auth/*", "/covers/*"]`
- Test: `src/worker/index.test.ts`

**Interfaces:**
- Consumes: `createCoverProxy` from Task 3.
- Produces: the live route.

- [ ] **Step 1: Write the failing tests** in `index.test.ts`, through `exports.default.fetch`, none of which need an upstream:
  - **`/covers/xx/…, /covers/ol/../…, /covers/ol/b/isbn/…, /covers/gb/books?id=… are 404`**, asserting the body isn't HTML (`content-type` doesn't start with `text/html`).
  - **`POST /covers/ol/b/id/1-M.jpg is 405`**
  - **`a cross-site cover request is 403`**
  - **`a signed-out cover request is never 401`** (Review Focus 5). Use a request with no cookie, a scripted upstream through `vi.stubGlobal("fetch", …)` returning a direct 200 `image/jpeg`, and assert 200. Unstub afterwards.
    - This test writes to the real `caches.default`, so use a cover id no other test uses (`/b/id/999000001-M.jpg`).

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run --config vitest.worker.config.ts src/worker/index.test.ts`. Expected: the new tests FAIL, with a 404 text from `app.notFound`.

- [ ] **Step 3: Wire the route and the `wrangler.jsonc` entry.**

- [ ] **Step 4: Run `pnpm test:worker`** and expect PASS. Then check the real chain once, by hand:

```bash
pnpm build && pnpm vite preview --port 4173 &
curl -sI http://localhost:4173/covers/ol/b/id/12645114-M.jpg | grep -iE '^(HTTP|content-type|cache-control|set-cookie)'
#   200, image/jpeg, public, max-age=31536000, immutable, and no set-cookie
for p in /covers/xx/b/id/1-M.jpg /covers/ol/../b/id/1-M.jpg /covers/ol/b/isbn/9780141439518-M.jpg '/covers/gb/books?id=x'; do curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:4173$p"; done   # 404 four times
```

  Record in the PR body whether `vite preview` showed a 404 stored by `cache.put`. A second request for a missing cover logs no upstream line. The spec allows it not to.

- [ ] **Step 5: Commit** with the message `feat: serve covers through /covers/*`.

### Task 5: Covers go through the proxy, with the direct URL last

**Files:**
- Modify: `src/client/covers.ts`, `src/client/covers.test.ts`
- Modify: `src/client/screens/BookCard.tsx` (`CoverFor`), `src/client/screens/BookCard.test.tsx`

**Interfaces:**
- Consumes: `coverRoute` from Task 2.
- Produces: `coverSrc(url: string): string`, which is `coverRoute(url) ?? url`.
- **`CoverFor`'s attempts,** in order, with duplicates removed:
  - for the hero: `coverSrc(largerCover(url))`, then `coverSrc(url)`, then `url`
  - for any other size: `coverSrc(url)`, then `url`
- The `failures` counter, the `naturalWidth <= 1` rule and the `key` reset stay as they are.

- [ ] **Step 1: Write the failing tests**
  - In `covers.test.ts`:
    - **`coverSrc proxies an allowed shape and leaves anything else alone`**, with an `ol` `/b/id/`, a Google URL, `/b/isbn/`, and `https://covers.invalid/x.jpg`.
  - In `BookCard.test.tsx`, update the existing src expectations to the proxied forms:
    - **`a hero cover tries the proxied larger image, the proxied stored one, then the stored one direct, then the failed tile`**: three `fireEvent.error`s, with the srcs in that order.
    - **`wall, row and card covers try the proxied stored URL, then the direct one`**
    - **`a cover URL of no allowed shape is tried once, as is`**: the `covers.invalid` fixture fails straight to the tile.
    - **`a blank (1x1) proxied answer moves on to the next attempt`**

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run --config vitest.client.config.ts src/client/covers.test.ts src/client/screens/BookCard.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement `coverSrc` and the attempts list.**

- [ ] **Step 4: Run `pnpm test:client`.** Expected: PASS. Other screens' tests that assert a cover `src` are updated to the proxied form, and nothing else in them changes.

- [ ] **Step 5: Commit** with the message `feat: covers load through /covers/, the direct URL last`.

### Task 6: The read memory

**Files:**
- Create: `src/client/readMemory.ts`, `src/client/readMemory.test.ts`
- Create: `src/client/buildId.d.ts` (`declare const __BUILD_ID__: string;`)
- Modify: `vite.config.ts` (`define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) }`) and `vitest.client.config.ts` (`define: { __BUILD_ID__: JSON.stringify("test") }`)
- Modify: `src/client/test-setup.ts`: in `afterEach`, `sessionStorage.clear()` and `localStorage.clear()`, so remembered reads never leak between tests

**Interfaces:**
- Produces, all exported from `src/client/readMemory.ts`:

```ts
/** The data, if `key` holds a usable entry: this build, the current epoch, and (when `member` is given) that member. */
export function recall<T>(key: string, member?: string): T | undefined;
/** Stores the envelope, unless a clear has happened since `since` (a clearCount() taken when the read began). A failed setItem removes the key. */
export function remember(key: string, member: string, data: unknown, since: number): void;
export function clearCount(): number;
/** Removes every `read:` entry in this tab and bumps the clear counter. */
export function forgetAll(): void;
export function forget(key: string): void;
/** forgetAll(), then writes read-epoch + 1 to localStorage. For sign-in start, sign-out and a boot that finds another member. */
export function newEpoch(): void;
```

- **Rules:**
  - A missing `read-epoch` counts as `0`.
  - If `localStorage` throws, `recall` returns `undefined` and `remember` does nothing.
  - A wrong `build` removes that key.
  - A wrong `epoch` calls `forgetAll()`.
  - A `member` mismatch returns `undefined` and leaves the entry alone.
  - Malformed JSON, or an object that isn't an envelope, removes the key.
  - The clear counter lives in module memory. It only has to order reads and writes within one page load.
  - `read:me` stores the member's own id as `member`, and `App` calls `recall("read:me")` with no member.

- [ ] **Step 1: Write the failing tests**
  - **`remember then recall round-trips for the same member, and not for another`**
  - **`an entry from another build is ignored and removed`**: write the envelope by hand with `build: "old"`.
  - **`another tab's new epoch drops every read: entry in this one, and leaves other keys (wall:/) alone`**
  - **`newEpoch bumps read-epoch and clears`**
  - **`a read that began before a clear does not store`**: `const since = clearCount(); forgetAll(); remember("read:x", "m", 1, since); expect(recall("read:x", "m")).toBeUndefined()`
  - **`a failed setItem removes the older entry`**: stub `Storage.prototype.setItem` to throw for the second write.
  - **`junk is ignored and removed`**, as a table: `"{"`, `"null"`, `"[]"`, `'{"build":"test"}'`, `'{"build":"test","epoch":"x","member":"m","data":1}'`. Also a non-numeric `read-epoch` counts as `0`. (Review Focus 1.)
  - **`storage that throws on every call: recall is undefined, remember and forgetAll don't throw`** (Review Focus 1)

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run --config vitest.client.config.ts src/client/readMemory.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/client/readMemory.ts`.**

- [ ] **Step 4: Run `pnpm test:client` and `pnpm typecheck`.** Expected: PASS. The storage clear in `test-setup.ts` changes no existing test.

- [ ] **Step 5: Commit** with the message `feat: a read memory in sessionStorage`.

### Task 7: `useLoaded` remembers, and writes clear

**Files:**
- Modify: `src/client/screens/useLoaded.ts`
- Create: `src/client/screens/useLoaded.test.tsx`
- Modify: `src/client/api.ts`, `src/client/api.test.ts`

**Interfaces:**
- Consumes: `recall`, `remember`, `clearCount`, `forget`, `forgetAll` and `newEpoch` from Task 6.
- Produces:

```ts
export type Memory<T> = { key: string; member: string; keep?: (data: T) => boolean };
export function useLoaded<T>(load: () => Promise<T>, enabled: boolean, memory?: Memory<T> | null);
// returns { state, reload, lose, retry } as today
```

- **Behaviour with `memory`** follows the spec's "Hook behaviour with `memory`":
  - The initial state comes from `recall(key, member)` inside the `useState` initialiser, only when `enabled`.
  - Keep the JSON text of what is showing in a ref. A landing with the same text calls no `setState`.
  - A landing with new text sets the state, and stores when `mine === latest`, `keep?.(data) !== false`, and `remember(…, since)`, where `since = clearCount()` was taken at the read's start.
  - A 401 calls `forgetAll()`; a 404 calls `forget(key)`.
  - Any other failure keeps showing the data only while the data on screen came from memory, with no landing since. Otherwise the state is `failed`, as today.
- **Without `memory`,** the hook behaves exactly as it does today.
- **`api.ts`:**
  - A non-GET `call` runs `forgetAll()` before its `fetch`, and again in a `finally`.
  - Any 401 from `call`, GET included, runs `forgetAll()`.
  - `logout` runs `newEpoch()` before its `fetch`.

- [ ] **Step 1: Write the failing hook tests** in `useLoaded.test.tsx`. Use a tiny probe component that renders `state.status` and `JSON.stringify(state.data)`, plus a render counter.
  - **`with nothing remembered it loads as today, then remembers`**
  - **`with a remembered entry the first render is ok with that data, and the refresh still runs`**
  - **`a refresh with the same data does not re-render`** (the render counter is unchanged after the promise settles)
  - **`a refresh with different data shows it and stores it`**
  - **`a read that lands after a write's clear shows its data but doesn't store it`**: start the load, call `forgetAll()`, resolve, then expect `recall` to be undefined.
  - **`keep() false is shown, not stored`**: `keep: (w) => w.failed === 0` with `failed: 1`.
  - **`a 401 forgets everything and is lost; a 404 forgets the key and is gone`**
  - **`a network failure while remembered data shows keeps it; with nothing remembered it is failed`**
  - **`after a landing, a failed reload is failed as today`**
  - **`an entry for another member is not used`**
  - **`without memory nothing is read or written`** (spy on `Storage.prototype.getItem`)

- [ ] **Step 2: Write the failing api tests** in `api.test.ts`:
  - **`a write clears remembered reads when it starts and when it settles, even when it fails`**: seed a `read:` entry, and re-seed it from inside the stubbed `fetch`. Both are gone after a `createCollection` that rejects.
  - **`a GET does not clear; a GET 401 does`**
  - **`logout bumps the epoch before its request`**: read `localStorage["read-epoch"]` inside the stubbed `fetch`.

- [ ] **Step 3: Run them and see them fail.** Run: `pnpm vitest run --config vitest.client.config.ts src/client/screens/useLoaded.test.tsx src/client/api.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 4: Implement both.**

- [ ] **Step 5: Run `pnpm test:client`.** Expected: PASS, with every screen test unchanged (no screen passes `memory` yet).

- [ ] **Step 6: Commit** with the message `feat: useLoaded draws remembered reads; writes clear them`.

### Task 8: The screens and the boot remember

**Files:**
- Modify: `src/client/screens/Mine.tsx`, `Shelf.tsx`, `Members.tsx` (the list and `FriendWall`), `People.tsx`, `Holding.tsx`
- Modify: `src/client/App.tsx`, `src/client/screens/SignIn.tsx`
- Test: `src/client/App.test.tsx`, `src/client/screens/Mine.test.tsx`, `src/client/screens/Shelf.test.tsx`

**Interfaces:**
- Consumes: `Memory` from Task 7. Also `recall`, `remember`, `clearCount` and `newEpoch` from Task 6.
- **Keys, from the spec's table:**
  - Mine's wall: `read:mine:wall`, with `keep: (w) => w.failed === 0`
  - Mine's requests: `read:mine:requests`
  - Shelf: `` `read:shelf:${id}` ``
  - the Members list: `read:members`
  - a member's wall: `` `read:member:${id}` ``, with `keep: (w) => w.failed === 0`
  - People: `read:people`
  - Holding: `read:holding`
- **Each screen** passes `member && { key, member: member.id }`. `CopyPage` is untouched.
- **`App`:**
  - The member state starts from `recall<Member>("read:me")` (call it `remembered`).
  - On `getMe` resolving:
    - If `remembered` is set and the answer is `null` or has another id: `newEpoch()`, then `location.reload()`, and return.
    - Otherwise, if the answer is a member: `remember("read:me", m.id, m, since)`. Call `setMember(m)` only if its JSON differs from what is showing.
    - Otherwise (`null`, nothing remembered): `setMember(null)` as today. **No epoch bump and no reload, so there is no reload loop.**
  - On `getMe` rejecting with `remembered` set: keep it. With nothing remembered, behave as today.
- **`SignIn`:** the link gets `onClick={() => newEpoch()}`. It is the only link to `/auth/login` (grep to confirm).

- [ ] **Step 1: Write the failing tests**
  - In `App.test.tsx`:
    - **`a remembered member draws the screen before /api/me answers`**: `getMe` never resolves, and Mine's heading "My books" shows.
    - **`/api/me answering another member clears, bumps the epoch and reloads`**: stub `location.reload`.
    - **`/api/me answering signed out after a remembered member reloads`**
    - **`signed out with nothing remembered neither reloads nor bumps the epoch`**
    - **`a 503 with a remembered member keeps the screen; with nothing remembered it is the trouble page`**
    - **`the sign-in link bumps the epoch when followed`**
  - In `Mine.test.tsx`:
    - **`a return visit draws the remembered wall with no skeleton`**: seed `read:mine:wall` and `read:mine:requests` with `remember(…)`, make the API calls never resolve, and expect the covers and no `.wall-skeleton`.
    - **`a partial wall is not remembered`**
  - In `Shelf.test.tsx`:
    - **`a 404 on a remembered shelf is gone and forgets it`**

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run --config vitest.client.config.ts src/client/App.test.tsx src/client/screens/Mine.test.tsx src/client/screens/Shelf.test.tsx`. Expected: the new tests FAIL.

- [ ] **Step 3: Wire the screens, `App` and `SignIn`.**

- [ ] **Step 4: Run `pnpm test:client`.** Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat: screens and the boot read draw from memory`.

### Task 9: The wall keeps its covers still through a refresh

**Files:**
- Create: `src/client/wall/keepInView.ts`, `src/client/wall/keepInView.test.tsx`
- Modify: `src/client/wall/CoverWall.tsx`: call the hook, and add `data-copy-id={item.copyId}` to `.wall-tile`
- Modify: `src/client/preview/preview.tsx`: add `&remember` and `&grow` to the wall view (dev only)

**Interfaces:**
- Produces: `useKeepInView(filter: WallFilter, loading: boolean): void`, called in `CoverWall`.
  - It does nothing where `CSS.supports("overflow-anchor", "auto")` is true. The browser's own anchoring does the job there, and a correction on top moved a cover 161px in the probe.
  - It does nothing while the page sits above the wall's anchor (`window.scrollY <= anchorTop()`).
  - Otherwise, after every commit and on every scroll, it records three things:
    - the first `.wall-tile[data-copy-id]` whose rect bottom is below the pinned row (`--wall-chips-h`, or just `> 0`, the builder's call)
    - that tile's `top`
    - `window.scrollY`
  - In a `useLayoutEffect` with no deps, it corrects only when all of these hold:
    - `filter` is the same object as at the last commit
    - `window.scrollY` still equals the recorded value (a scroll whose event hasn't arrived yet is never fought)
    - the same `copyId` is found again
  - The correction is `window.scrollBy(0, newTop - oldTop)`, when the difference is non-zero.
  - A filter change never scrolls, because the find box and the chips have their own rules. The tile is never the chips row.
- **The preview.**
  - `&remember` loads the wall through `useLoaded` with `{ key: "read:preview:wall", member: "preview" }`. The loader resolves after 600ms. It also uses `useWallPlace(wallKey(), ready, ids)`.
  - `&grow` makes the loader's answer prepend 12 fixture copies titled "Aa…" with new copy ids, so they sort into the first group, above anything scrolled into view.

- [ ] **Step 1: Write the failing tests** (jsdom).
  - Stub `globalThis.CSS = { supports: () => false }` per test.
  - Stub `getBoundingClientRect` by `data-copy-id`, and stub the anchor's rect.
  - Spy on `window.scrollBy`.
  - The tests:
    - **`deep in the wall, new covers above the visible one scroll by the difference`**: rerender with items whose stubbed tops are 300px lower, and expect `scrollBy(0, 300)`.
    - **`a taller top block above the chips, with the same items, is also kept`**
    - **`where overflow-anchor is supported, nothing scrolls`**
    - **`above the anchor (at the top), nothing scrolls`**
    - **`a filter change never scrolls`**
    - **`a scroll whose event hasn't fired yet is not fought`**: change `window.scrollY` with no scroll event, rerender with the same filter and moved tiles, and expect no `scrollBy`.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run --config vitest.client.config.ts src/client/wall/keepInView.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement the hook, the tile attribute and the preview flags.**

- [ ] **Step 4: Run `pnpm test:client`.** Expected: PASS.

- [ ] **Step 5: Check it in a browser with the dev preview.** Run `pnpm dev`. Copy `scripts/shoot.mjs` to the scratchpad as a probe with `captureBeyondViewport: false` and an eval hook (as the design-review probe `anch.mjs` did), then:
  1. Open `/src/client/preview/preview.html?view=wall&remember`. Wait for the wall, then scroll to `y = 2000`.
  2. Navigate to the same URL with `&grow`. Record whether `.wall-skeleton` was ever present (expect never), `scrollY`, and the first visible tile's `copyId` and `top`, before and after the refresh lands.
  3. Expected: no skeleton, and the same `copyId` at the same `top`, give or take 1px, in Chrome.
  4. Repeat with `CSS.supports` forced false by an init script, to exercise the hook. Expected: the same.

  Put the numbers in the PR body.

- [ ] **Step 6: Commit** with the message `feat: a refresh never moves the covers in view`.

### Task 10: PR 1's check and pull request

**Files:** none new.

- [ ] **Step 1: Run the `app` check locally:** `pnpm wrangler types --check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Expected: all pass.
- [ ] **Step 2: Repeat the local checks** in the spec's "Verification → PR 1, locally": the asset headers, the cover route's image and 404s, the preload links, and the Task 9 numbers.
- [ ] **Step 3: Rebase on `main`, push, and run `gh pr create`.**
  - **The body:**
    - what changed
    - the local checks with their output
    - the Task 4 note on whether `cache.put` stores a 404
    - the Task 9 numbers
    - the post-release checklist from the spec's "Verification → After the maintainer releases PR 1", including what Workers Logs' cover classes mean
    - the maintainer's phone checks
  - End the body with the attribution lines.
- [ ] **Step 4: Stop.** Write a handoff for PR 2 at `docs/superpowers/handoffs/`, update the `caching-and-shift` memory, and alert the maintainer. Merging waits for the maintainer's approval.

---

## PR 2: layout shift (branch `layout-shift`, from `main` after PR 1 merges)

### Task 11: `&loadfor`, the probe, and the baseline

**Files:**
- Modify: `src/client/preview/preview.tsx`: `&loadfor=<ms>` shows the skeleton for that long, then the wall (`useState(true)` plus a `setTimeout` in an effect; `&loading` still means forever).
- Scratchpad only: `measure.mjs`, a copy of `scripts/shoot.mjs` with `captureBeyondViewport: false` and an eval hook.

**Interfaces:**
- Produces: a probe command `node <scratchpad>/measure.mjs <url> --widths 375,414,812 --schemes light,dark`. It prints one JSON line per width and scheme:
  - `{ width, scheme, skeleton: { top, width }, loaded: { top, width }, dTop, dWidth, cls }`
  - `skeleton` is the rect of the first `.wall-skeleton-tile`, read at `loadfor / 2`.
  - `loaded` is the rect of the first `.wall-group .wall-tile`, read after the swap.
  - `cls` is the sum from a buffered `layout-shift` `PerformanceObserver`, installed by `Page.addScriptToEvaluateOnNewDocument`.
- Use 812 as the landscape width (812×375).
- **Control:** the same probe on a page with a 100px insert above the wall scores about 0.097. That proves the observer works. Run it once, and note it.

- [ ] **Step 1: Add `&loadfor` and a preview test.** In `src/client/preview/` (or by hand, if the preview has no tests), check that the skeleton shows and then gives way to the wall.
- [ ] **Step 2: Build the probe and run the control.** Expected: CLS of about 0.1 for the insert.
- [ ] **Step 3: Record the baseline** for `kind=mine` and `kind=friend`, at all widths and in both schemes, before any skeleton change. Expected, roughly as in the spec: at 375, the skeleton's first tile is at y=85 and the loaded one at y=246, with widths 106 → 97. Save the JSON lines for the PR body.
- [ ] **Step 4: Commit** with the message `chore: preview loadfor for skeleton measurement`.

### Task 12: The skeleton reserves the wall's chrome

**Files:**
- Modify: `src/client/wall/CoverWall.tsx`, `src/client/styles/wall.css` (only if the real boxes need a hook for the placeholders)
- Test: `src/client/wall/CoverWall.test.tsx`

**Interfaces:**
- **While `loading`,** `CoverWall` renders `aria-hidden="true"` placeholders, using the real classes so the heights can't drift:
  - `<p className="wall-count">` holding a no-break space
  - `<div className="wall-chips">`, empty
  - `<section className="wall-group">` holding `<div className="wall-letter">` (with a no-break space) and the existing `.wall-grid.wall-skeleton`
- **The `.wall` attributes while loading:**
  - `data-chips` and `data-find` for `kind` `mine` and `friend`. Those are the walls with chips, and a non-empty one has the find box, so `--wall-chips-h` resolves to 60px, or 104px upright.
  - `data-rail` for `mine` only.
  - Neither for `holding`, `my-collection` or `friend-collection`.
- **The anchor** (`WALL_ANCHOR`) still renders only when not loading.
- **The skeleton's top margin.** `.wall-skeleton`'s own `margin-top` may need to go, now that the real boxes above it give the spacing. Measure, don't guess.

- [ ] **Step 1: Write the failing tests**
  - **`the loading wall reserves the count line, the pinned row and a letter heading, all hidden, with nothing focusable`**: check `container.querySelector(".wall-count")`, `.wall-chips` and `.wall-letter` exist inside `[aria-hidden="true"]` or are themselves hidden. `container.querySelectorAll("button, a, input")` has length 0, and there is no `[data-wall-anchor]`.
  - **`Mine's skeleton reserves the rail gutter and the find row; a friend's reserves the find row only; Holding reserves neither`**: check the `data-rail`, `data-chips` and `data-find` attributes per kind.

- [ ] **Step 2: Run them and see them fail.** Run: `pnpm vitest run --config vitest.client.config.ts src/client/wall/CoverWall.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement the placeholders.**

- [ ] **Step 4: Run `pnpm test:client`.** Expected: PASS.

- [ ] **Step 5: Re-run the Task 11 probe.**
  - Expected on `kind=mine`: `dTop === 0` and `dWidth === 0` at every width and in both schemes.
  - Expected on `kind=friend`: `dTop === 0`; `dWidth` may differ (no rail is reserved, by the spec's call).
  - Also screenshot the skeleton at 320, 375 and 414 with `scripts/shoot.mjs`, and check there is no sideways scroll.
  - Fix any other shift the probe finds, within the wall screens.

- [ ] **Step 6: Commit** with the message `fix: the wall skeleton reserves what the loaded wall shows`.

### Task 13: Fonts decision, the technique, and PR 2

**Files:**
- Modify: `.claude/agents/antagonist-techniques.md`. Add a "Caching and shift (2026-11-28)" section, with the entry: **"The skeleton swap doesn't shift."** CLS scores only nodes present in both frames, and React replaces the skeleton's nodes, so a 160px move scored 0. Measure the first content box's rect across the swap, with a 100px-insert control to prove the observer works.
- Modify, only if the probe shows a font shift: `src/client/styles/tokens.css` or `base.css`. Add `@font-face` fallbacks over Georgia and system-ui, with `size-adjust` and the `*-override` descriptors, second in the stacks (spec, "Fonts").

- [ ] **Step 1: Decide on the fonts.** Re-run the probe with `Network.setBlockedURLs` set to `["*.woff2*"]`, against the run without. Expected: there is no vertical difference, so no fallback fonts. If there is a difference, add the fallbacks, re-run, and expect 0.
- [ ] **Step 2: Add the technique entry.**
- [ ] **Step 3: Run the `app` check,** then push and run `gh pr create`.
  - **The body:** the before and after JSON lines for each kind, width and scheme, CLS included; the control's score; and which way the fonts went and why.
  - End the body with the attribution lines.
- [ ] **Step 4: Stop** and alert the maintainer. Merging and the release are the maintainer's call.
