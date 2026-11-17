# Natalie's Little Library

A shared lending record for Natalie's books: scan the label inside a book on your phone, sign in with Google, and the record of who has it updates itself. It is a React app served by a Cloudflare Worker, with a D1 database.

Design: [docs/superpowers/specs/2026-11-16-little-library-design.md](docs/superpowers/specs/2026-11-16-little-library-design.md). Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md). This is step 1 (the skeleton); it is not deployed yet.

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

## One-time setup

Do these in order.

- [ ] **Cloudflare.** Run `pnpm wrangler login`, then `pnpm wrangler d1 create little-library`. Paste the returned id over `PLACEHOLDER` in `wrangler.jsonc` and commit it: until it is committed, the CI deploy fails at the migration step. The custom domain in `wrangler.jsonc` needs `waffle.haus` to be an active zone on the account and no existing CNAME on `books`.
- [ ] **Google.** In Google Cloud Console, create an OAuth client of type "Web application" with two redirect URIs: `https://books.waffle.haus/auth/callback` and `http://localhost:5173/auth/callback`. Copy the client id and secret into `.dev.vars`, along with `ALLOWLIST_EMAILS` and `ADMIN_EMAILS` (comma-separated).
- [ ] **Secrets.** Run `pnpm wrangler secret put` for each of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWLIST_EMAILS`, `ADMIN_EMAILS`. The first one offers to create the Worker; that is expected, answer yes.
- [ ] **GitHub deploy credentials.** Make a Cloudflare API token with these permissions: account-level Workers Scripts Edit and D1 Edit, and zone access limited to the `waffle.haus` zone only (not all zones). Do not start from the "Edit Cloudflare Workers" template: it has no D1 permission, so the migration step would fail. The custom-domain route needs access to that zone; this list comes from Cloudflare's docs, and the exact zone permission for attaching a custom domain was not confirmed, so the first deploy is the test. In GitHub, create an environment named `production` and add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to it. Required reviewers and environment secrets need a public repository on GitHub's Free and Pro plans; this repo is private, so if environment secrets are not available, add the two as repository secrets instead. There is no approval gate on a private repo, which is why a deploy is a deliberate tag rather than a merge (see Deploying).
- [ ] **Verify locally.** Run `pnpm wrangler d1 migrations apply DB --local`, then `pnpm dev`. Sign in at http://localhost:5173 with an allowlisted account and see `Hi, <name>`. Sign out. Sign in with an account that is not on the list and see the invite-only message.
- [ ] **First deploy and phone check.** Do the first deploy locally from a terminal, not CI: a non-interactive deploy takes over an existing DNS record for `books.waffle.haus`, or that hostname from another Worker, without asking, whereas a terminal deploy prompts. Run `pnpm wrangler d1 migrations apply DB --remote`, then `pnpm run deploy`. On a phone, open `https://books.waffle.haus`, sign in with an allowlisted account and see the greeting; try a non-allowlisted account and see the refusal. That is step 1's "done when".

## Deploying

Merging to `main` does not deploy. A release is a deliberate tag. On an up-to-date `main`:

```
git tag -a v0.1.0 -m "First deploy"
git push origin v0.1.0
```

CI runs the checks, then the `deploy` job refuses a lightweight tag or a tag whose commit is not on `main`, applies migrations, and deploys. The very first deploy is still done locally from a terminal (see the last setup step), because of the DNS takeover described there.

Tags are the release record: never move or reuse one. A bad release is fixed by a new tag. CI refuses any tag that is not the highest version, so re-running an old release's workflow does not redeploy it; to roll back, tag the older commit with a new, higher version.

These checks live in the workflow file of the tagged commit, so they stop mistakes, not a person with write access who edits the workflow; GitHub-enforced limits (protected branches, deployment rules, environment secrets) need a public repository or a paid plan.

Protecting `main` (require a pull request and the `app` check, block force-pushes) is a repository setting, not something the workflow does. On GitHub Free it is only available for public repositories.

Migrations are applied before the new code goes out, and nothing rolls back if the deploy then fails. So every migration must work with the code that is already deployed: add things first, remove them in a later release. If a migration goes wrong, D1 Time Travel is the way back ([docs](https://developers.cloudflare.com/d1/reference/time-travel/); the free plan keeps 7 days).

CI pins the pnpm version (`11.17.0`) in the workflow; keep it in step with `package.json`.

## Things to know

1. Use `@gmail.com` or Google Workspace addresses in `ALLOWLIST_EMAILS` and `ADMIN_EMAILS`. Google only vouches for those; for other addresses its "verified" flag can be stale.
2. `SITE_URL` in `wrangler.jsonc` is the one setting that holds the domain. Changing the domain means changing it, the `routes` pattern in `wrangler.jsonc`, and the redirect URIs on the Google OAuth client.
3. Taking someone off the allowlist does not sign them out or remove them. There is no removal screen yet.
4. Natalie's `storygraph_export.csv` must never be committed. It is gitignored.
5. `pnpm wrangler types --check` only notices that `wrangler.jsonc` changed without regenerating; it does not notice hand edits to `worker-configuration.d.ts`. Never edit that file by hand; run `pnpm types`.
6. Session cookies are `__Host-lib_session` and `__Host-lib_login` on https, and plain `lib_session` and `lib_login` on http (local development).
