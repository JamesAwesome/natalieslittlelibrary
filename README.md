# Natalie's Little Library

A shared lending record for Natalie's books: scan the label inside a book on your phone, sign in with Google, and the record of who has it updates itself. It is a React app served by a Cloudflare Worker, with a D1 database.

Design: [docs/superpowers/specs/2026-11-16-little-library-design.md](docs/superpowers/specs/2026-11-16-little-library-design.md). Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md). This is step 1 (the skeleton); it is not deployed yet.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app locally at http://localhost:5173 |
| `pnpm test` | Check the schema is migrated, then run worker and client tests |
| `pnpm typecheck` | Type-check everything |
| `pnpm lint` | Lint everything |
| `pnpm build` | Build the app |
| `pnpm db:generate` | Turn changes in `src/worker/db/schema.ts` into a migration in `drizzle/` (commit it) |
| `pnpm types` | Regenerate `worker-configuration.d.ts` (commit it; CI checks it is current) |
| `pnpm run deploy` | Build and deploy to Cloudflare |

To change the schema: edit `src/worker/db/schema.ts`, run `pnpm db:generate`, commit `drizzle/`. `pnpm test` fails if you forget.

## Local development

Copy `.dev.vars.example` to `.dev.vars` and fill it in (it is gitignored). Without it every `/api` and `/auth` route returns 500 and the page just shows the signed-out state.

## One-time setup

Do these in order.

- [ ] **Cloudflare.** Run `pnpm wrangler login`, then `pnpm wrangler d1 create little-library`. Paste the returned id over `PLACEHOLDER` in `wrangler.jsonc`. The custom domain in `wrangler.jsonc` needs `waffle.haus` to be an active zone on the account and no existing CNAME on `books`.
- [ ] **Google.** In Google Cloud Console, create an OAuth client of type "Web application" with two redirect URIs: `https://books.waffle.haus/auth/callback` and `http://localhost:5173/auth/callback`. Copy the client id and secret into `.dev.vars`, along with `ALLOWLIST_EMAILS` and `ADMIN_EMAILS` (comma-separated).
- [ ] **Secrets.** Run `pnpm wrangler secret put` for each of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWLIST_EMAILS`, `ADMIN_EMAILS`. In GitHub, create an environment named `production` with yourself as required reviewer, and add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to it. CI deploys only from `main`, and only after you approve.
- [ ] **Verify locally.** Run `pnpm wrangler d1 migrations apply DB --local`, then `pnpm dev`. Sign in at http://localhost:5173 with an allowlisted account and see `Hi, <name>`. Sign out. Sign in with an account that is not on the list and see the invite-only message.
- [ ] **First deploy and phone check.** Run `pnpm wrangler d1 migrations apply DB --remote`, then `pnpm run deploy`. On a phone, open `https://books.waffle.haus`, sign in with an allowlisted account and see the greeting; try a non-allowlisted account and see the refusal. That is step 1's "done when".

## Things to know

1. Use `@gmail.com` or Google Workspace addresses in `ALLOWLIST_EMAILS` and `ADMIN_EMAILS`. Google only vouches for those; for other addresses its "verified" flag can be stale.
2. `SITE_URL` in `wrangler.jsonc` is the one setting that holds the domain. Changing the domain means changing it, the `routes` pattern in `wrangler.jsonc`, and the redirect URIs on the Google OAuth client.
3. Taking someone off the allowlist does not sign them out or remove them. There is no removal screen yet.
4. Natalie's `storygraph_export.csv` must never be committed. It is gitignored.
5. Session cookies are `__Host-lib_session` and `__Host-lib_login` on https, and plain `lib_session` and `lib_login` on http (local development).
