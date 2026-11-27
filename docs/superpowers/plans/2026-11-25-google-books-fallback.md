# Google Books Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Open Library has no answer for an ISBN, ask Google Books before telling the person the book wasn't found.

**Architecture:** A second `BookSource` adapter in `src/worker/booklookup/sources.ts`, placed after Open Library in the lookup's ordered source list. `lookupSources(key)` in the booklookup module decides the list, so the worker only passes the optional secret. The shared cover rule widens to Google's cover host, so the ledger accepts those covers too.

**Tech Stack:** TypeScript, Hono Worker, D1, Vitest in workerd (`vitest.worker.config.ts`).

**Spec:** `docs/superpowers/specs/2026-11-25-google-books-fallback-design.md` (and the main spec's "Lookup sources" section in `docs/superpowers/specs/2026-11-16-little-library-design.md`).

## Global Constraints

- Only the ISBN and the key go to Google. Nothing about a member, and never the maintainer's email (also not in a User-Agent).
- Requests the shipped app makes send `User-Agent: NataliesLittleLibrary/1 (+https://github.com/JamesAwesome/natalieslittlelibrary)`; requests an agent makes by hand use a generic client name.
- The key is a secret: never committed, never in a fixture, a cached row, a cover URL, a log line, or a test name. Tests use the literal `test-key`.
- No key set means lookups behave exactly as today (Open Library only, no Google request).
- Each source keeps its own time limit (the existing `ask` in `booklookup.ts`); nothing new may hang.
- Tests never reach the network: the existing `fetch` stubs that throw stay in place.
- Agents do not run `wrangler secret put`, `--remote`, or deploy.

## Review Focus

1. Google's `q=isbn:` search can return a volume for a different book. Expected: a volume counts only if its `industryIdentifiers` include this ISBN-13 (or its ISBN-10). Pinned in Task 2.
2. Google sends thumbnails as `http://books.google.com/...&edge=curl`. Expected: stored as https, without the curl, and accepted by `safeCoverUrl`. Pinned in Tasks 1 and 2.
3. Over quota or a bad key (Google answers 429 or 403). Expected: a failure, so the lookup returns null and the person types the title. Pinned in Task 2.
4. The key leaking into stored data. Expected: no cached row or cover URL contains `test-key`. Pinned in Task 2.
5. A look-alike cover host (`books.google.com.evil.test`, `evilbooks.google.com`, `http:`, credentials, port). Expected: refused. Pinned in Task 1.

---

### Task 1: Accept Google's cover host

**Files:**
- Modify: `src/shared/bookFacts.ts` (`COVER_HOST`, `safeCoverUrl`)
- Test: `src/shared/bookFacts.test.ts`

**Interfaces:**
- Produces: `safeCoverUrl(raw: unknown): string | null` accepts https URLs on exactly `covers.openlibrary.org` or `books.google.com`, with no credentials and no port, returning the parsed `href`. The signature does not change.

- [ ] **Step 1: Write the failing tests** in `bookFacts.test.ts`:

```ts
test("a Google Books cover over https is kept", () => {
  const u = "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&source=gbs_api";
  expect(safeCoverUrl(u)).toBe(u);
});
test.each([
  "http://books.google.com/books/content?id=abc",
  "https://books.google.com.evil.test/books/content?id=abc",
  "https://evilbooks.google.com/books/content?id=abc",
  "https://user:pw@books.google.com/books/content?id=abc",
  "https://books.google.com:8443/books/content?id=abc",
  "https://google.com/books/content?id=abc",
])("%s is refused", (u) => expect(safeCoverUrl(u)).toBeNull());
```

The existing Open Library cover tests stay as they are.

- [ ] **Step 2: Run** `pnpm exec vitest run --config vitest.worker.config.ts src/shared/bookFacts.test.ts`. Expected: the first test fails, the refusals pass.
- [ ] **Step 3: Implement.** Replace `COVER_HOST` with a two-entry set of exact hostnames; update the comment above `safeCoverUrl`.
- [ ] **Step 4: Run** the same command, then `pnpm test`. Expected: all pass.
- [ ] **Step 5: Commit.** `feat: covers from books.google.com are accepted`

---

### Task 2: The Google Books source and its wiring

**Files:**
- Modify: `src/worker/booklookup/sources.ts` (add `googleBooks`), `src/worker/booklookup/booklookup.ts` (add `lookupSources`), `src/worker/booklookup/index.ts` (export both), `src/worker/index.ts` (`servicesFor`)
- Create: `src/worker/booklookup/fixtures/google-found.json`, `google-miss.json`, `google-other-isbn.json`
- Test: `src/worker/booklookup/sources.test.ts`, `src/worker/booklookup/booklookup.test.ts`
- Docs: `README.md` ("Things to know" and the setup notes), the main spec's "Lookup sources" paragraph

**Interfaces:**
- Consumes: `BookSource` (`sources.ts`), `safeCoverUrl` and `cleanBookFacts` (Task 1), `toIsbn13`.
- Produces: `googleBooks(apiKey: string): BookSource` with `name: "google-books"`; `lookupSources(apiKey: unknown): BookSource[]`, which returns `[openLibrary, googleBooks(apiKey)]` when `apiKey` is a non-empty string after trim, and `[openLibrary]` otherwise.

**Fixtures.** Try one keyless request by hand (generic User-Agent) for a Google Books response to `q=isbn:9798855427974`. If Google refuses, as it did on 2026-11-17, write the fixtures from the documented volume list format (https://developers.google.com/books/docs/v1/reference/volumes/list and the Volume resource), and say so in the report. `google-found.json` has `totalItems: 1` and one item whose `volumeInfo` has `title`, `subtitle`, two `authors`, `industryIdentifiers` with both ISBN_13 `9798855427974` and ISBN_10, and `imageLinks.thumbnail` as `http://books.google.com/books/content?id=…&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api`. `google-miss.json` is `{"kind":"books#volumes","totalItems":0}`. `google-other-isbn.json` is like `google-found.json`, but its only item's identifiers are a different ISBN.

- [ ] **Step 1: Write the failing tests.** In `sources.test.ts`:

```ts
test("asks Google Books by ISBN with the key, naming the app", async () => {
  const calls: Call[] = [];
  await googleBooks("test-key").find(FOUND_ISBN, serve(googleFound, calls), new AbortController().signal);
  const url = new URL(calls[0].url);
  expect(url.origin + url.pathname).toBe("https://www.googleapis.com/books/v1/volumes");
  expect(url.searchParams.get("q")).toBe(`isbn:${FOUND_ISBN}`);
  expect(url.searchParams.get("key")).toBe("test-key");
  expect(new Headers(calls[0].init?.headers).get("user-agent")).toBe("NataliesLittleLibrary/1 (+https://github.com/JamesAwesome/natalieslittlelibrary)");
});
test("passes the abort signal to the request", …);            // same shape as the Open Library test
test("a found volume gives its title (no subtitle), every author, and an https cover without the curl", async () => {
  const book = await googleBooks("test-key").find(FOUND_ISBN, serve(googleFound), signal());
  expect(book).toEqual({ isbn: FOUND_ISBN, title: googleFound.items[0].volumeInfo.title,
    authors: googleFound.items[0].volumeInfo.authors,
    coverUrl: expect.stringMatching(/^https:\/\/books\.google\.com\/books\/content\?/) });
  expect(book!.coverUrl).not.toContain("edge=curl");
  expect(book!.coverUrl).not.toContain("test-key");
});
test("totalItems 0 is not found", …);                          // google-miss.json → null
test("a volume for a different ISBN is not found", …);         // google-other-isbn.json → null
test("an ISBN-10 identifier that matches counts", …);          // fixture variant whose only identifier is the ISBN-10 of FOUND_ISBN
test.each([429, 403, 500])("a %i answer throws, so the lookup treats it as a failure", …);
test("a body of the wrong shape is not found", …);             // items not an array, volumeInfo missing, title not a string
test("no thumbnail gives a null cover", …);
```

In `booklookup.test.ts`:

```ts
test("lookupSources with no key, an empty key, or a blank key is Open Library only", () => {
  for (const k of [undefined, null, "", "   ", 42]) expect(lookupSources(k).map((s) => s.name)).toEqual(["openlibrary"]);
});
test("lookupSources with a key puts Google Books after Open Library", () => {
  expect(lookupSources("test-key").map((s) => s.name)).toEqual(["openlibrary", "google-books"]);
});
test("Open Library found: Google is never asked", …);         // fetch stub routes by host; assert zero googleapis calls
test("Open Library miss then Google found: Google's book is returned and cached with source google-books", …);
test("Open Library 500 or timeout then Google found", …);
test("both miss: null, nothing cached", …);
test("no cached row and no stored cover contain the key", …); // select * from book_lookups; JSON.stringify(rows) not containing "test-key"
```


- [ ] **Step 2: Run** `pnpm exec vitest run --config vitest.worker.config.ts src/worker/booklookup`. Expected: the new tests fail (no `googleBooks`, no `lookupSources`).
- [ ] **Step 3: Implement `googleBooks(apiKey)`** in `sources.ts`.
  - A non-2xx answer throws, which `ask` turns into a failure. A 200 with no matching volume returns null.
  - The volume is the first item whose `industryIdentifiers` contain the ISBN-13, or the ISBN-10 that `toIsbn13` maps to it.
  - The thumbnail is upgraded from `http:` to `https:`, and the `edge` parameter is removed with `URL.searchParams.delete`. The result goes through `cleanBookFacts`.
  - Build the request URL with `URLSearchParams`, so a key containing `&` cannot add parameters.
- [ ] **Step 4: Implement `lookupSources(apiKey: unknown)`** in `booklookup.ts`, and export both from `index.ts`. In `src/worker/index.ts`, `servicesFor` passes `sources: lookupSources((env as { GOOGLE_BOOKS_API_KEY?: unknown }).GOOGLE_BOOKS_API_KEY)`. The secret is optional, so do not add it to `secrets.required` in `wrangler.jsonc`, and do not hand-edit `worker-configuration.d.ts`.
- [ ] **Step 5: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm wrangler types --check`. Expected: all pass.
- [ ] **Step 6: Docs.**
  - README, "Things to know": lookups ask Open Library, then Google Books if `GOOGLE_BOOKS_API_KEY` is set. The key comes from the natalieslittlelibrary Cloud project with the Books API enabled, restricted to the Books API. It is set with `wrangler secret put GOOGLE_BOOKS_API_KEY` and in `.dev.vars` for local use, and lookups work without it.
  - Spec, "Lookup sources": record the change with a dated note.
- [ ] **Step 7: Commit.** `feat: Google Books answers when Open Library has no book`

After the merge, the maintainer creates the key and runs `wrangler secret put GOOGLE_BOOKS_API_KEY`. Agents don't.

---

### Task 3: Google Books becomes a suggestion that pre-fills the typing form (revision, 2026-11-25)

The design was revised after the antagonist pass found Google's API terms forbid keeping its content (see the design's Approaches). Tasks 1–2 are reworked here.

**Files:**
- Modify: `src/shared/bookFacts.ts` and its test (revert to `covers.openlibrary.org` only); `src/shared/types.ts` (add `Suggestion`); `src/worker/booklookup/booklookup.ts`, `index.ts`, `sources.ts` (the adapter becomes a suggestion source); `src/worker/index.ts` (wiring and route); `vitest.worker.config.ts` (`GOOGLE_BOOKS_API_KEY: ""`); `src/client/api.ts` (`lookupBook` return type); `src/client/screens/Pair.tsx` and its test; `README.md`; the main spec's "Lookup sources" note.

**Interfaces:**
- `Suggestion = { title: string; authors: string[]; link: string }` in `src/shared/types.ts`.
- booklookup: `createBookLookup(deps)` returns `{ lookup, suggest }`, where `suggest(isbn: string): Promise<Suggestion | null>`. `deps.suggestSource?: SuggestSource | null` comes from `suggestSourceFor(apiKey: unknown)`, which is `null` when the key is not a non-empty trimmed string. `lookupSources` is removed, and lookup's default sources are `[openLibrary]` again.
- Route: `GET /api/books/lookup` answers `{ book: BookInfo | null; suggestion: Suggestion | null }`.
- Client: `lookupBook(isbn)` resolves to `{ book, suggestion }`.

- [ ] **Step 1: Failing tests.**
  - bookFacts: the Google cover tests now expect null for `https://books.google.com/...`; the look-alike refusals stay.
  - booklookup:
    - `suggest` returns title, authors and an https `books.google.com` link from `google-found.json`.
    - It returns null for a miss, a different ISBN, a non-2xx, a timeout, a link on another host or http, and when there's no `suggestSource`.
    - `suggest` writes nothing (`book_lookups` stays empty), and `lookup` never calls Google even with a key.
    - No `suggest` result or table row contains `test-key`.
  - Routes:
    - With no key (the pinned `""`), a miss answers `{ book: null, suggestion: null }`.
    - With a key and a stubbed Google, a miss answers the suggestion.
    - A hit answers `suggestion: null` without calling Google.
  - Pair:
    - After a miss with a suggestion, **Type the title** shows the fields pre-filled (title, first author).
    - It shows a link whose text contains "Google Books", with `href` equal to `link`, `target="_blank"` and `rel` containing `noopener` and `noreferrer`.
    - Saving sends `{ code, title, authors: [author] }`.
    - With no suggestion, the form is empty as before.
    - An edited suggestion is sent as edited.
- [ ] **Step 2: Run** the focused suites (worker booklookup, shared, index; client Pair). Expected: the new tests fail.
- [ ] **Step 3: Implement.**
  - The Google adapter reads `canonicalVolumeLink`, else `infoLink`.
  - The link is kept only if it is https, has the hostname `books.google.com`, and has no credentials or port. A key must never appear in it.
  - The ISBN match and the `URLSearchParams` URL stay. The suggestion goes through the same title and author cleaning as book facts, with no cover.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm wrangler types --check`. Expected: all pass. This is a full pass, so check the machine-coordination note first.
- [ ] **Step 5: Docs.** As in the design's Docs bullet. `.dev.vars.example`, if present, gains `GOOGLE_BOOKS_API_KEY=` with an "optional" comment.
- [ ] **Step 6: Commit.** `feat: Google Books suggests a title when Open Library has none`

---

### Task 4: Back to automatic fill (revision 2, 2026-11-25)

Decided: this is a small private app, so Google's terms are not a concern, and automatic fill is back. It saves books with their ISBN and a cover, so later scans and the step-3 import match them. This brings back Tasks 1–2 behaviour and keeps every fix made since.

**Behaviour:**
- Lookup asks Open Library, then Google Books when a key is set (`lookupSources(apiKey)`). A Google answer is cached and saved like an Open Library answer, with `source = "google-books"`.
- `safeCoverUrl` accepts https `books.google.com` again, as in Task 1, with the look-alike refusals and the separate username-only and password-only tests.
- Google thumbnail: upgraded from http to https, `edge` removed, then cleaned.
- The suggestion feature is removed:
  - `suggest`, `suggestSourceFor`, `Suggestion`, the route's `suggestion` field, and Pair's pre-fill and attribution line.
  - The route answers `{ book }`, as before Task 3.
  - Pair's form returns to its pre-Task-3 behaviour.
  - Keep the Task 3 fix-round tests that a form opened after a rescan or start over is empty, where they still apply.
- Kept from Tasks 2–3: the ISBN-13/ISBN-10 match against `industryIdentifiers`, the `URLSearchParams` URL, a non-2xx throws, the shared `withLimit` helper, `GOOGLE_BOOKS_API_KEY: ""` pinned in `miniflare.bindings`, a route test with a key set (miss at Open Library, found at Google, cached as `google-books`), the fixtures without the impossible ISBN-10, and the setup and `.dev.vars.example` lines.
- New: cover `<img>` elements get `referrerPolicy="no-referrer"` (BookCard.tsx), so a cover request does not tell Google or Open Library which page it came from. Add a test.
- Docs:
  - The design doc gains a "Revision 2" section saying the terms risk was accepted by the maintainer for a private app, with the referrer mitigation.
  - README item 7: lookups ask Open Library, then Google Books when keyed; neither knows every book, so typing is normal; covers may come from either.
  - The main spec's "Lookup sources" note is updated.

- [ ] **Step 1: Failing tests** for the behaviour above, especially: Google cover accepted; route with key, miss then Google found and cached; the `no-referrer` attribute; no `suggestion` in the route answer.
- [ ] **Step 2: Run** the focused suites. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the focused suites, then the full pass (`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm wrangler types --check`), but only once the machine coordinator allows it.
- [ ] **Step 5: Commit.** `feat: Google Books fills in books Open Library lacks, covers included`
