# Natalie's Little Library

A shared lending record for Natalie's books: scan the label inside a book on your phone, sign in with Google, and the record of who has it updates itself. It is a React app served by a Cloudflare Worker, with a D1 database.

Design: [docs/superpowers/specs/2026-11-16-little-library-design.md](docs/superpowers/specs/2026-11-16-little-library-design.md). Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md). Step 1 (the skeleton) is live at https://books.waffle.haus as v0.1.0. Step 2 (the core loop) is built but not released.

## How it works

1. **Print.** On a computer, open Print labels, pick your sheet (or plain paper), run the alignment test on plain paper, then print the labels at 100% scale.
2. **Pair.** Stick a label in a book. Open Pair a book on a phone, scan the book's ISBN barcode (three matching reads, then confirm the title) or type the title, then scan the label.
3. **Scan.** Anyone who scans the label with their phone camera lands on the book's page.
4. **Claim.** Signed in, they tap "I have this book". Everyone sees who holds it.
5. **Return.** The owner taps "Mark as returned". The page keeps the history.

No new commands: `pnpm dev`, `pnpm test` and the rest are as below.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app locally at http://localhost:5173 |
| `pnpm test` | Check `src/worker/db/schema.ts` matches the committed migrations, then run the worker and client suites |
| `pnpm typecheck` | Type-check everything |
| `pnpm lint` | Lint everything |
| `pnpm build` | Build the app |
| `pnpm db:generate` | Turn changes in `src/worker/db/schema.ts` into a migration in `drizzle/` (commit it) |
| `pnpm types` | Regenerate `worker-configuration.d.ts` (commit it; CI checks it is current) |
| `pnpm run deploy` | Build and deploy to Cloudflare |

To change the schema: edit `src/worker/db/schema.ts`, run `pnpm db:generate`, commit `drizzle/`. `pnpm test` fails if you forget.

## Local development

Copy `.dev.vars.example` to `.dev.vars` and fill it in (it is gitignored). Without it `/api/me` and the `/auth` routes return 500 and the page just shows the signed-out state; `/api/health` still answers.

## How this was set up

All done for step 1; kept for rebuilding the project elsewhere. In order.

- [x] **Cloudflare.** Run `pnpm wrangler login`, then `pnpm wrangler d1 create little-library`. Put the returned id in the `DB` binding's `database_id` in `wrangler.jsonc` and commit it (done: the database exists and its id is committed). If `d1 create` offers to add a binding itself, say no: it adds a second binding instead of filling `DB`; keep one `DB` binding. The custom domain in `wrangler.jsonc` needs `waffle.haus` to be an active zone on the account and no existing CNAME on `books`.
- [x] **Google.** In Google Cloud Console, create an OAuth client of type "Web application" with two redirect URIs: `https://books.waffle.haus/auth/callback` and `http://localhost:5173/auth/callback`. Copy the client id and secret into `.dev.vars`, along with `ALLOWLIST_EMAILS` and `ADMIN_EMAILS` (comma-separated).
- [x] **Secrets.** Run `pnpm wrangler secret put` for each of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWLIST_EMAILS`, `ADMIN_EMAILS`. The first one offers to create the Worker; that is expected, answer yes.
- [ ] **Optional: Google Books key.** See Things to know, item 11.
- [x] **GitHub deploy credentials.** Make a Cloudflare API token with these permissions: account-level Workers Scripts Edit and D1 Edit, and zone access limited to the `waffle.haus` zone only (not all zones). Do not start from the "Edit Cloudflare Workers" template: it has no D1 permission, so the migration step would fail. What worked for the custom domain: Account Workers Scripts Edit, Account D1 Edit, and Zone Workers Routes Edit on `waffle.haus` only. DNS Edit was not needed. In GitHub, create an environment named `production` and add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to it. Environment secrets need a public repository on GitHub's Free and Pro plans; this repo is public, so they are available. A deploy is still a deliberate tag rather than a merge (see Deploying).
- [x] **Verify locally.** Run `pnpm wrangler d1 migrations apply DB --local`, then `pnpm dev`. Sign in at http://localhost:5173 with an allowlisted account and see `Hi, <name>`. Sign out. Sign in with an account that is not on the list and see the invite-only message.
- [x] **First deploy and phone check.** The first deploy was run locally from a terminal, not CI, because a non-interactive deploy takes over an existing DNS record for `books.waffle.haus`, or that hostname from another Worker, without asking, whereas a terminal deploy prompts. The commands were `pnpm wrangler d1 migrations apply DB --remote`, then `pnpm run deploy`. v0.1.0 has since been released by CI. The phone check is done: sign-in on a phone, and the invite-only refusal for an unlisted account, were both confirmed on `books.waffle.haus`.

## Deploying

Merging to `main` does not deploy. A release is a deliberate tag. On an up-to-date `main`:

```
git tag -a vX.Y.Z -m "What this release is"
git push origin vX.Y.Z
```

Replace `vX.Y.Z` with the next version, higher than every existing tag (v0.1.0 exists; step 2 is v0.2.0).

CI runs the checks, then the `deploy` job refuses a lightweight tag or a tag whose commit is not on `main`, applies migrations, and deploys. The first deploy was done locally from a terminal (see the last setup step) because of the DNS takeover described there; later ones go through CI.

Tags are the release record: never move or reuse one. A bad release is fixed by a new tag. CI refuses any tag that is not the highest version, so re-running an old release's workflow does not redeploy it; to roll back, tag the older commit with a new, higher version.

These checks live in the workflow file of the tagged commit, so they stop mistakes, not a person with write access who edits the workflow; GitHub-enforced limits (protected branches, deployment rules, environment secrets) need a public repository or a paid plan.

This repository is public, and three repository settings keep it safe. They are not in the code, so recreate them if the repository is ever moved or rebuilt:

- **A ruleset named "protect main"** on the default branch: changes arrive by pull request, the `app` check must pass on an up-to-date branch, and force-pushes and deletion are blocked, with no bypass for admins.
- **Pull requests from collaborators only** (Settings → General → Pull Requests). Outside pull requests are not accepted.
- **Actions → "Require approval for all external contributors"**, so no outside code runs in CI without a person approving it first.

Do not loosen these while the deploy job holds a Cloudflare token. On GitHub Free, rulesets are only available for public repositories.

Migrations are applied before the new code goes out, and nothing rolls back if the deploy then fails. So every migration must work with the code that is already deployed: add things first, remove them in a later release. If a migration goes wrong, D1 Time Travel is the way back ([docs](https://developers.cloudflare.com/d1/reference/time-travel/); the free plan keeps 7 days).

CI pins the pnpm version (`11.17.0`) in the workflow; keep it in step with `package.json`.

## Things to know

1. Use `@gmail.com` or Google Workspace addresses in `ALLOWLIST_EMAILS` and `ADMIN_EMAILS`. Google only vouches for those; for other addresses its "verified" flag can be stale.
2. `SITE_URL` in `wrangler.jsonc` is the one setting that holds the domain. Changing the domain means changing it, the `routes` pattern in `wrangler.jsonc`, and the redirect URIs on the Google OAuth client.
3. Taking someone off the allowlist does not sign them out or remove them. There is no removal screen yet.
4. Natalie's `storygraph_export.csv` must never be committed. It is gitignored.
5. `pnpm wrangler types --check` only notices that `wrangler.jsonc` changed without regenerating; it does not notice hand edits to `worker-configuration.d.ts`. Never edit that file by hand; run `pnpm types`.
6. Session cookies are `__Host-lib_session` and `__Host-lib_login` on https, and plain `lib_session` and `lib_login` on http (local development).
7. Book titles and covers come from Open Library, then from Google Books when `GOOGLE_BOOKS_API_KEY` is set. Neither knows every book, so typing a title is normal. Covers may come from either. Pairing works even when both are down.
8. Labels are printed from a computer at 100% scale (turn off "fit to page"), with the alignment test first. Printers shift, and the test shows by how much.
9. An iPhone home-screen web app may be treated as an in-app browser by Google sign-in. If sign-in is refused there, open the site in Safari instead.
10. 1-inch round labels (Avery 6450) carry no printed code text, so they can only be scanned, not typed.
11. `GOOGLE_BOOKS_API_KEY` is optional. The key comes from the natalieslittlelibrary Cloud project with the Books API enabled, restricted to the Books API. Set it with `wrangler secret put GOOGLE_BOOKS_API_KEY`, and in `.dev.vars` for local use. Without it lookups use Open Library alone. Tests pin it empty, so a real key never changes them.
