# Step 1: Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed app at `books.waffle.haus` where an allowlisted person can sign in with Google on their phone and see their name, and anyone else is refused.

**Architecture:** One TypeScript project: a React single-page app and a Cloudflare Worker API, built together by Cloudflare's Vite plugin, with D1 for data. All login behaviour sits in one deep module, `membership`, whose interface takes requests and returns responses; routes and screens are thin pass-throughs.

**Tech Stack:** pnpm, Node 26, React 19, Vite, `@cloudflare/vite-plugin`, Wrangler 4, Hono, D1, Drizzle (`drizzle-orm@rc`, `drizzle-kit@rc`), Vitest 4.1+ with `@cloudflare/vitest-plugin`, Testing Library, ESLint.

**Spec:** `docs/superpowers/specs/2026-11-16-little-library-design.md` (roadmap: `docs/ROADMAP.md`, step 1). This plan covers step 1 only. Each later roadmap step gets its own plan.

## Changes made during execution

The plan below is the original; the build differs in these ways.

- Session cookies are `__Host-`-prefixed on https (`__Host-lib_session`, `__Host-lib_login`), with the login cookie at `Path=/`. Plain names on http.
- Migrations are read from `drizzle/` directly by Wrangler; there is no `migrations/` copy and no copy script.
- `db:check` guards against schema drift and is part of `pnpm test`.
- Primary-key columns are NOT NULL.
- `Cache-Control: no-store` on `/api/*` and `/auth/*`.
- The redirect URI is built with `new URL`, and the token request refuses redirects.
- A fifth refusal reason, `unavailable`, covers a database outage during sign-in.
- The deploy job runs when an annotated `vX.Y.Z` tag on `main` is pushed, so `main` can be protected and a release is a deliberate act.

## Global Constraints

- Workers Free plan: 10 ms CPU per request. No password hashing, PDF, or image work in the Worker.
- Google login only. A member is keyed by provider plus the provider's user id, never by email.
- No OAuth library: Google's code flow is two HTTP calls and is written directly (the Arctic docs were unreachable when this plan was written, so its API could not be verified).
- The domain appears in exactly three places, so that changing it is a three-line job: the `SITE_URL` variable, the `routes` pattern in `wrangler.jsonc`, and the redirect URIs on the Google OAuth client. No source file contains a hostname.
- Emails (allowlist, admins) are secrets, never committed.
- `storygraph_export.csv` is never committed. `.gitignore` already covers it; do not weaken it.
- Source layout from the spec: `src/worker/`, `src/client/`, `src/shared/`. Module directories expose their interface from `index.ts`; nothing outside a module imports its other files.
- Worker and Wrangler configuration is `wrangler.jsonc`, `compatibility_date` `2026-11-16`.
- Times in the database are integer milliseconds since the epoch. Ids are `crypto.randomUUID()`.
- Not in this step: label-based entry, the admin "remove a member" screen, any ledger code, client-side routing.

## Review Focus

Inputs the spec implies and a person will hit. Each has a named test in the task that owns the code.

1. A `returnTo` that points off-site (`//evil.example`, `https://evil.example`, `/\evil.example`): the person lands on `/`, never off-site. (Task 2)
2. The callback opened without a matching login cookie, or with the wrong `state` (reloaded tab, two tabs, a stale link): refused with `failed`, no session, no error page. (Task 2)
3. Allowlist written sloppily (`" Nat@Example.com , ,james@example.com,"`) or empty: matching ignores case and spaces; an empty allowlist admits nobody. (Task 2)
4. Google answers the token call with an error, non-JSON, or an unverified email: refused, never a 500. (Tasks 2 and 3)
5. A garbage, expired, or removed member's session cookie: treated as signed out, never throws. (Task 2)

## File Structure

```
package.json, pnpm-lock.yaml, index.html, vite.config.ts
wrangler.jsonc              production Worker config
wrangler.test.jsonc         test-only Worker config (no assets block)
tsconfig.json, tsconfig.app.json, tsconfig.node.json, tsconfig.worker.json
eslint.config.js, drizzle.config.ts
vitest.worker.config.ts, vitest.client.config.ts
.dev.vars.example
migrations/                 flat .sql files, applied by wrangler and by tests
test/apply-migrations.ts    worker test setup
test/env.d.ts               types for the test environment
src/shared/types.ts         Member, RefusalReason
src/worker/index.ts         Hono routes only
src/worker/db/schema.ts     Drizzle tables
src/worker/membership/index.ts      the interface
src/worker/membership/membership.ts login, sessions, join policy
src/worker/membership/google.ts     the Google adapter
src/worker/membership/testing.ts    the fake adapter
src/client/main.tsx, App.tsx, api.ts, screens/Home.tsx, index.css
.github/workflows/ci.yml
README.md
```

---

### Task 1: Project, database, and a health check

**Files:**
- Create: `package.json`, `index.html`, `vite.config.ts`, `wrangler.jsonc`, `wrangler.test.jsonc`, the four `tsconfig*.json`, `eslint.config.js`, `drizzle.config.ts`, `vitest.worker.config.ts`, `test/apply-migrations.ts`, `test/env.d.ts`, `.dev.vars.example`
- Create: `src/worker/index.ts`, `src/worker/db/schema.ts`, `src/client/main.tsx`, `src/client/App.tsx`
- Create: `migrations/0000_*.sql` (generated)
- Test: `src/worker/index.test.ts`

**Interfaces:**
- Produces: D1 binding `DB`. Tables `members`, `identities`, `sessions`. Worker entry `src/worker/index.ts` exporting a Hono app as default. Scripts `dev`, `build`, `deploy`, `lint`, `typecheck`, `test`, `test:worker`, `test:client`, `db:generate`. `GET /api/health` returning `{ ok: true }`.

- [ ] **Step 1: Initial commit.** The repo has no commits. Commit `.gitignore` and `docs/` on `main` as `docs: design, roadmap, and step 1 plan`, after running `git status --short` and confirming `storygraph_export.csv` is not listed. Then create the GitHub repository and push: `gh repo create JamesAwesome/natalieslittlelibrary --private --source=. --remote=origin --push`. It starts private (James's call to make it public later, as his critter site is). Verify with `git ls-remote origin` that `main` is there and with `gh api repos/JamesAwesome/natalieslittlelibrary/contents` that no `.csv` file was pushed. Then create branch `step-1-skeleton`.

- [ ] **Step 2: Install.** `pnpm init`, set `"type": "module"` and `"private": true`, then:

```bash
pnpm add react react-dom hono drizzle-orm@rc
pnpm add -D vite @vitejs/plugin-react @cloudflare/vite-plugin wrangler typescript \
  @types/react @types/react-dom drizzle-kit@rc \
  "vitest@^4.1.0" @cloudflare/vitest-plugin eslint typescript-eslint
```

Create `pnpm-workspace.yaml` with `allowBuilds:` listing `esbuild: true` and `workerd: true`, so their install scripts run. If pnpm refuses a package for being too recently published, add that exact `name@version` under `minimumReleaseAgeExclude` (as James's other project does); do not turn the rule off.

- [ ] **Step 3: Configuration.** Values that are decisions:

`vite.config.ts`: plugins `[react(), cloudflare({ viteEnvironment: { name: "worker" } })]`, in that order.

`wrangler.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "little-library",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-11-16",
  "upload_source_maps": true,
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/auth/*"]
  },
  "vars": { "SITE_URL": "https://books.waffle.haus" },
  "secrets": { "required": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ALLOWLIST_EMAILS", "ADMIN_EMAILS"] },
  "d1_databases": [
    { "binding": "DB", "database_name": "little-library", "database_id": "PLACEHOLDER", "migrations_dir": "migrations" }
  ]
}
```

`wrangler.test.jsonc`: the same `name`, `main`, `compatibility_date`, and `d1_databases` (its `database_id` stays a dummy value forever; tests only use local D1), no `assets`, and `vars`: `SITE_URL` `https://books.test`, `GOOGLE_CLIENT_ID` `test-client`, `GOOGLE_CLIENT_SECRET` `test-secret`, `ALLOWLIST_EMAILS` `natalie@example.com`, `ADMIN_EMAILS` `natalie@example.com`.

`.dev.vars.example`: `SITE_URL=http://localhost:5173`, and empty `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWLIST_EMAILS`, `ADMIN_EMAILS`.

tsconfig: root has `"files": []` and references the other three. `tsconfig.app.json` includes `src/client` and `src/shared` with DOM libs and `"jsx": "react-jsx"`. `tsconfig.worker.json` extends `tsconfig.node.json`, sets `"types": ["vite/client"]`, and includes `src/worker`, `src/shared`, `test`, and `worker-configuration.d.ts` (the generated file supplies both `Env` and the Workers runtime types, so `@cloudflare/workers-types` is not installed). All three are `strict`.

`package.json` scripts: `dev` `vite dev`; `build` `vite build`; `deploy` `pnpm build && wrangler deploy`; `lint` `eslint .`; `typecheck` `tsc -b`; `test:worker` `vitest run --config vitest.worker.config.ts`; `test:client` `vitest run --config vitest.client.config.ts`; `test` runs both; `db:generate` `drizzle-kit generate`; `types` `wrangler types`.

- [ ] **Step 4: Schema.** In `src/worker/db/schema.ts`, with Drizzle's SQLite column builders:

| Table | Columns |
|---|---|
| `members` | `id` text primary key; `name` text not null; `email` text not null; `picture_url` text; `created_at` integer not null; `removed_at` integer |
| `identities` | `provider` text not null; `subject` text not null; `member_id` text not null references `members.id`; primary key (`provider`, `subject`) |
| `sessions` | `token_hash` text primary key; `member_id` text not null references `members.id`; `expires_at` integer not null |

`drizzle.config.ts`: `dialect: "sqlite"`, `schema: "./src/worker/db/schema.ts"`, `out: "./migrations"`. No `driver` or credentials; this config only generates SQL.

- [ ] **Step 5: Generate the migration and check its shape.** Run `pnpm db:generate`. Wrangler and the tests need flat files, `migrations/<name>.sql`. If drizzle-kit wrote one folder per migration instead, change `out` to `./drizzle` and make `db:generate` a small Node script (`scripts/db-generate.mjs`) that runs `drizzle-kit generate` and then copies each `drizzle/<name>/migration.sql` to `migrations/<name>.sql`. Verify: `pnpm wrangler d1 migrations apply DB --local` reports the migration applied.

- [ ] **Step 6: Test setup.** `vitest.worker.config.ts` uses `cloudflareTest` from `@cloudflare/vitest-plugin` with the async form: read `migrations/` with `readD1Migrations`, return `{ wrangler: { configPath: "./wrangler.test.jsonc" }, miniflare: { bindings: { TEST_MIGRATIONS: migrations } } }`; `test.setupFiles: ["./test/apply-migrations.ts"]`; `test.include: ["src/worker/**/*.test.ts"]`. `test/apply-migrations.ts` calls `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` with `env` from `cloudflare:workers` (confirm the import path of `applyD1Migrations` on Cloudflare's Vitest "Test APIs" page; it was not shown in the pages read for this plan). `test/env.d.ts` declares `ProvidedEnv extends Env` on module `cloudflare:workers` and adds `TEST_MIGRATIONS`. Generate `Env` with `pnpm types`, which writes `worker-configuration.d.ts`; the `secrets.required` list is what puts the four secrets on `Env`. Commit the generated file. Re-run `pnpm types` whenever `wrangler.jsonc` changes.

- [ ] **Step 7: Write the failing test.** `src/worker/index.test.ts`:

```ts
import { env, exports } from "cloudflare:workers";
import { expect, test } from "vitest";

test("health check answers", async () => {
  const res = await exports.default.fetch("https://books.test/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("migrations created the tables", async () => {
  const { results } = await env.DB.prepare(
    "select name from sqlite_master where type = 'table' and name in ('members','identities','sessions') order by name",
  ).all();
  expect(results.map((r) => r.name)).toEqual(["identities", "members", "sessions"]);
});
```

- [ ] **Step 8: Run it.** `pnpm test:worker`. Expected: FAIL, no Worker entry.

- [ ] **Step 9: Implement.** `src/worker/index.ts` exports a Hono app typed `Hono<{ Bindings: Env }>` with `GET /api/health`. `src/client/main.tsx` mounts `App`, which renders the heading `Natalie's Little Library`.

- [ ] **Step 10: Verify.** `pnpm test:worker` PASS (2 tests). `pnpm typecheck` and `pnpm lint` clean. `pnpm dev`, open `http://localhost:5173`: the heading shows, and `/api/health` returns `{"ok":true}`.

- [ ] **Step 11: Commit.** `feat: project skeleton with D1 and health check`

---

### Task 2: The membership module

Everything about who is signed in and who may join. Tested only through its interface, against local D1, with a fake identity provider.

**Files:**
- Create: `src/shared/types.ts`, `src/worker/membership/index.ts`, `src/worker/membership/membership.ts`, `src/worker/membership/testing.ts`
- Test: `src/worker/membership/membership.test.ts`

**Interfaces:**
- Consumes: `DB` binding and tables from Task 1.
- Produces, in `src/shared/types.ts`:

```ts
export type Member = { id: string; name: string; email: string; pictureUrl: string | null; isAdmin: boolean };
export type RefusalReason = "not-invited" | "removed" | "unverified" | "failed";
```

- Produces, from `src/worker/membership/index.ts`:

```ts
export type Identity = {
  provider: "google"; subject: string; email: string;
  emailVerified: boolean; name: string; pictureUrl: string | null;
};
export interface IdentityProvider {
  authorizationUrl(state: string, codeVerifier: string): Promise<URL>;
  exchange(code: string, codeVerifier: string): Promise<Identity>; // throws on any failure
}
export type MembershipConfig = { siteUrl: string; allowlist: string; admins: string }; // comma-separated emails
export interface Membership {
  currentMember(request: Request): Promise<Member | null>;
  beginLogin(returnTo: string | null): Promise<Response>;
  completeLogin(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
}
export function createMembership(deps: {
  db: D1Database; provider: IdentityProvider; config: MembershipConfig; now?: () => number;
}): Membership;
```

- Produces, from `src/worker/membership/testing.ts`: `fakeProvider(result: Identity | Error): IdentityProvider`, whose `authorizationUrl` returns `https://idp.test/auth?state=<state>`.

Behaviour the tests pin:

- `beginLogin` answers 302 to the provider's URL and sets cookie `lib_login` (HttpOnly, SameSite=Lax, Path=/auth, Max-Age=600) holding the state, the code verifier, and the cleaned `returnTo`.
- `returnTo` is kept only if it starts with `/`, does not start with `//` or `/auth`, and contains no backslash. Otherwise it becomes `/`.
- `completeLogin` checks the `state` query parameter against the cookie, exchanges the code, applies the join policy, and answers 302. On success: to `returnTo`, setting `lib_session` (HttpOnly, SameSite=Lax, Path=/, Max-Age=7776000) and clearing `lib_login`. On refusal: to `/?refused=<reason>`, with no session cookie.
- Both cookies carry `Secure` exactly when `siteUrl` starts with `https:`.
- Join policy, in order: email not verified → `unverified`. An identity row exists for (provider, subject) → that member, unless `removed_at` is set → `removed`; name, email, and picture are refreshed from Google. Otherwise the email is on the allowlist → a new member and identity. Otherwise → `not-invited`. Any thrown error, missing cookie, or state mismatch → `failed`.
- Allowlist and admin lists are split on commas, trimmed, lower-cased, and empty entries dropped. `isAdmin` is membership of the admin list.
- The session token is 32 random bytes, base64url. The database stores only its SHA-256 as hex. Sessions last 90 days from creation.
- `currentMember` returns null for no cookie, an unknown or malformed token, an expired session, or a removed member. It never throws.
- `logout` deletes the session row and answers 204, clearing `lib_session`.

- [ ] **Step 1: Write the failing tests.** `src/worker/membership/membership.test.ts`. Shared helpers, written once at the top:

```ts
const natalie: Identity = { provider: "google", subject: "g-1", email: "natalie@example.com",
  emailVerified: true, name: "Natalie", pictureUrl: null };
const config = { siteUrl: "https://books.test", allowlist: "natalie@example.com", admins: "natalie@example.com" };
// make(overrides) builds createMembership({ db: env.DB, provider, config, now }) 
// cookies(res) turns res.headers.getSetCookie() into a Cookie header value
// signIn(m, returnTo?) runs beginLogin then completeLogin with the right state and cookies
// asMember(m, res) calls m.currentMember with the cookies from res
```

Tests, one behaviour each, with these names and assertions:

```ts
test("an allowlisted person signs in and is recognised", async () => {
  const m = make();
  const res = await signIn(m);
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
  expect(await asMember(m, res)).toMatchObject({ name: "Natalie", email: "natalie@example.com", isAdmin: true });
});

test("signing in returns the person to the page they came from", async () => {
  const res = await signIn(make(), "/b/abc123");
  expect(res.headers.get("location")).toBe("/b/abc123");
});

test.each(["//evil.example", "https://evil.example", "/\\evil.example", "/auth/login", "evil"])(
  "returnTo %s is replaced with /", async (bad) => {
    const res = await signIn(make(), bad);
    expect(res.headers.get("location")).toBe("/");
  });

test("someone not on the allowlist is refused and gets no session", async () => {
  const m = make({ provider: fakeProvider({ ...natalie, subject: "g-2", email: "stranger@example.com" }) });
  const res = await signIn(m);
  expect(res.headers.get("location")).toBe("/?refused=not-invited");
  expect(res.headers.getSetCookie().some((c) => c.startsWith("lib_session=") && !c.includes("Max-Age=0"))).toBe(false);
  expect(await asMember(m, res)).toBeNull();
});

test("allowlist matching ignores case, spaces, and empty entries", async () => {
  const m = make({ config: { ...config, allowlist: " Natalie@Example.com , ,james@example.com," } });
  expect((await signIn(m)).headers.get("location")).toBe("/");
});

test("an empty allowlist admits nobody", async () => {
  const m = make({ config: { ...config, allowlist: "" } });
  expect((await signIn(m)).headers.get("location")).toBe("/?refused=not-invited");
});

test("an unverified email is refused", async () => {
  const m = make({ provider: fakeProvider({ ...natalie, emailVerified: false }) });
  expect((await signIn(m)).headers.get("location")).toBe("/?refused=unverified");
});

test("a provider failure is a refusal, not an error", async () => {
  const m = make({ provider: fakeProvider(new Error("token endpoint said no")) });
  expect((await signIn(m)).headers.get("location")).toBe("/?refused=failed");
});

test("a callback with the wrong state is refused", async () => {
  const m = make();
  const begin = await m.beginLogin(null);
  const res = await m.completeLogin(new Request("https://books.test/auth/callback?code=x&state=wrong",
    { headers: { cookie: cookies(begin) } }));
  expect(res.headers.get("location")).toBe("/?refused=failed");
});

test("a callback with no login cookie is refused", async () => {
  const res = await make().completeLogin(new Request("https://books.test/auth/callback?code=x&state=y"));
  expect(res.headers.get("location")).toBe("/?refused=failed");
});

test("a returning member is the same member, with details refreshed", async () => {
  const first = await asMember(make(), await signIn(make()));
  const m2 = make({ provider: fakeProvider({ ...natalie, name: "Nat", email: "new@example.com" }),
    config: { ...config, allowlist: "" } });
  const second = await asMember(m2, await signIn(m2));
  expect(second).toMatchObject({ id: first!.id, name: "Nat", email: "new@example.com" });
});

test("a removed member is refused and their old session stops working", async () => {
  const m = make();
  const res = await signIn(m);
  await env.DB.prepare("update members set removed_at = 1").run();
  expect(await asMember(m, res)).toBeNull();
  expect((await signIn(m)).headers.get("location")).toBe("/?refused=removed");
});

test("a session expires after 90 days", async () => {
  let t = 0;
  const m = make({ now: () => t });
  const res = await signIn(m);
  t = 90 * 86_400_000 - 1;
  expect(await asMember(m, res)).not.toBeNull();
  t = 90 * 86_400_000 + 1;
  expect(await asMember(m, res)).toBeNull();
});

test.each(["lib_session=", "lib_session=not-a-token", "lib_session=%%%", "other=1"])(
  "cookie %s is treated as signed out", async (cookie) => {
    expect(await make().currentMember(new Request("https://books.test/", { headers: { cookie } }))).toBeNull();
  });

test("logout ends the session", async () => {
  const m = make();
  const res = await signIn(m);
  const out = await m.logout(new Request("https://books.test/auth/logout", { method: "POST", headers: { cookie: cookies(res) } }));
  expect(out.status).toBe(204);
  expect(await asMember(m, res)).toBeNull();
});

test("the database never holds the raw session token", async () => {
  const res = await signIn(make());
  const token = /lib_session=([^;]+)/.exec(res.headers.getSetCookie().join(";"))![1];
  const row = await env.DB.prepare("select token_hash from sessions").first<{ token_hash: string }>();
  expect(row!.token_hash).not.toBe(token);
  expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
});

test("cookies are Secure on https and not on http", async () => {
  expect((await signIn(make())).headers.getSetCookie().join(";")).toContain("Secure");
  const local = make({ config: { ...config, siteUrl: "http://localhost:5173" } });
  expect((await signIn(local)).headers.getSetCookie().join(";")).not.toContain("Secure");
});
```

Each test must start from empty tables: add a `beforeEach` that deletes from `sessions`, `identities`, `members`, in that order, unless the Vitest plugin already isolates D1 per test (check by running two tests that each insert a member).

- [ ] **Step 2: Run them.** `pnpm test:worker`. Expected: FAIL, `createMembership` not defined.

- [ ] **Step 3: Implement** `createMembership` in `membership.ts`, `fakeProvider` in `testing.ts`, and re-export the interface from `index.ts`. Use Drizzle over `deps.db`; write the member, identity, and session rows for a first sign-in in one `db.batch`. Hashing is `crypto.subtle.digest("SHA-256", …)`.

- [ ] **Step 4: Run them.** `pnpm test:worker`. Expected: PASS.

- [ ] **Step 5: Commit.** `feat: membership module with allowlist and sessions`

---

### Task 3: Google adapter and routes

**Files:**
- Create: `src/worker/membership/google.ts`
- Modify: `src/worker/membership/index.ts` (export `googleProvider`), `src/worker/index.ts`
- Test: `src/worker/membership/google.test.ts`, `src/worker/index.test.ts`

**Interfaces:**
- Consumes: `IdentityProvider`, `Identity`, `createMembership`, `Member` from Task 2.
- Produces: `googleProvider(opts: { clientId: string; clientSecret: string; siteUrl: string; fetch?: typeof fetch }): IdentityProvider`.
- Produces routes: `GET /auth/login?returnTo=`, `GET /auth/callback`, `POST /auth/logout`, `GET /api/me` returning `{ member: Member | null }`.

Google's flow, fixed values:

- Authorization URL `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri` = `<siteUrl>/auth/callback`, `response_type=code`, `scope=openid email profile`, `state`, `code_challenge` (base64url SHA-256 of the verifier), `code_challenge_method=S256`.
- Token call: POST `https://oauth2.googleapis.com/token`, form-encoded `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`, `code_verifier`.
- The identity comes from the `id_token` in the response. Its payload is decoded without checking the signature, which Google permits for a token received directly from its token endpoint over TLS. `aud` must equal `clientId` and `iss` must be `https://accounts.google.com` or `accounts.google.com`; otherwise throw.
- Map `sub` → `subject`, `email`, `email_verified` → `emailVerified`, `name` (fall back to the part of the email before `@`), `picture` → `pictureUrl`.

- [ ] **Step 1: Write the failing tests.** `google.test.ts`, passing a stub `fetch` and building id tokens with a local `idToken(claims)` helper (base64url header, payload, and a dummy signature):

```ts
test("the authorization URL carries the client, callback, scope, and PKCE challenge", async () => {
  const url = await google().authorizationUrl("state-1", "verifier-1");
  expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    client_id: "test-client", redirect_uri: "https://books.test/auth/callback",
    response_type: "code", scope: "openid email profile", state: "state-1", code_challenge_method: "S256" });
  expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("a good token response becomes an identity", async () => {
  const p = google(respond(200, { id_token: idToken({ iss: "https://accounts.google.com", aud: "test-client",
    sub: "g-1", email: "natalie@example.com", email_verified: true, name: "Natalie", picture: "https://p.test/n.jpg" }) }));
  expect(await p.exchange("code-1", "verifier-1")).toEqual({ provider: "google", subject: "g-1",
    email: "natalie@example.com", emailVerified: true, name: "Natalie", pictureUrl: "https://p.test/n.jpg" });
});

test("the token call sends the code, verifier, and secret as a form post", async () => { /* assert method POST, URL, and the six form fields */ });
test("a missing name falls back to the email's local part", async () => { /* name: "natalie" */ });
test.each([
  ["an error status", respond(400, { error: "invalid_grant" })],
  ["a body that is not JSON", respondText(200, "<html>")],
  ["no id_token", respond(200, {})],
  ["a token for another client", respond(200, { id_token: idToken({ iss: "https://accounts.google.com", aud: "someone-else", sub: "g-1" }) })],
  ["a token from another issuer", respond(200, { id_token: idToken({ iss: "https://evil.example", aud: "test-client", sub: "g-1" }) })],
  ["a malformed token", respond(200, { id_token: "not.a.jwt" })],
])("exchange throws on %s", async (_name, fetchStub) => {
  await expect(google(fetchStub).exchange("c", "v")).rejects.toThrow();
});
```

Add to `src/worker/index.test.ts`:

```ts
test("me is null when signed out", async () => {
  const res = await exports.default.fetch("https://books.test/api/me");
  expect(await res.json()).toEqual({ member: null });
});

test("login redirects to Google with our client id", async () => {
  const res = await exports.default.fetch("https://books.test/auth/login?returnTo=/b/abc", { redirect: "manual" });
  expect(res.status).toBe(302);
  const to = new URL(res.headers.get("location")!);
  expect(to.hostname).toBe("accounts.google.com");
  expect(to.searchParams.get("client_id")).toBe("test-client");
});

test("logout by GET is not allowed", async () => {
  const res = await exports.default.fetch("https://books.test/auth/logout");
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run them.** `pnpm test:worker`. Expected: FAIL, `googleProvider` not defined and routes 404.

- [ ] **Step 3: Implement** `googleProvider` in `google.ts`. In `src/worker/index.ts`, build the membership once per request from `env` (`DB`, `SITE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWLIST_EMAILS`, `ADMIN_EMAILS`) and add the four routes; each route is one call to the module.

- [ ] **Step 4: Run them.** `pnpm test:worker`. Expected: PASS.

- [ ] **Step 5: Commit.** `feat: Google sign-in routes`

---

### Task 4: The one screen

**Files:**
- Create: `src/client/api.ts`, `src/client/screens/Home.tsx`, `src/client/index.css`, `vitest.client.config.ts`
- Modify: `src/client/App.tsx`
- Test: `src/client/screens/Home.test.tsx`

**Interfaces:**
- Consumes: `GET /api/me`, `POST /auth/logout`, `/auth/login?returnTo=`, and `Member`, `RefusalReason` from `src/shared/types.ts`.
- Produces: `getMe(): Promise<Member | null>` and `logout(): Promise<void>` in `api.ts`; `<Home member refused returnTo onLogout />` where `member: Member | null`, `refused: RefusalReason | null`, `returnTo: string` (the current path and query with `refused` removed), `onLogout: () => void`.

Exact copy:

| State | Text |
|---|---|
| heading, always | `Natalie's Little Library` |
| signed out | a link `Sign in with Google` to `/auth/login?returnTo=<returnTo, URL-encoded>` |
| signed in | `Hi, <name>` and a button `Sign out` |
| refused `not-invited` | `This library is invite-only right now. Ask Natalie to add you.` |
| refused `removed` | `This account no longer has access.` |
| refused `unverified` | `Google hasn't verified that email address yet.` |
| refused `failed`, or any unknown value | `Sign-in didn't finish. Please try again.` |

A refusal message shows above the sign-in link and has `role="alert"`.

- [ ] **Step 1: Install and configure.** `pnpm add -D jsdom @testing-library/react @testing-library/user-event`. `vitest.client.config.ts`: `environment: "jsdom"`, `include: ["src/client/**/*.test.tsx"]`, the React plugin.

- [ ] **Step 2: Write the failing tests.** `Home.test.tsx`:

```tsx
test("signed out shows the sign-in link back to this page", () => {
  render(<Home member={null} refused={null} onLogout={() => {}} returnTo="/b/abc" />);
  expect(screen.getByRole("link", { name: "Sign in with Google" }))
    .toHaveAttribute("href", "/auth/login?returnTo=%2Fb%2Fabc");
});

test("signed in greets the member by name and can sign out", async () => {
  const onLogout = vi.fn();
  render(<Home member={{ id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true }}
    refused={null} onLogout={onLogout} returnTo="/" />);
  expect(screen.getByText("Hi, Natalie")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(onLogout).toHaveBeenCalledOnce();
});

test.each([
  ["not-invited", "This library is invite-only right now. Ask Natalie to add you."],
  ["removed", "This account no longer has access."],
  ["unverified", "Google hasn't verified that email address yet."],
  ["failed", "Sign-in didn't finish. Please try again."],
  ["something-else", "Sign-in didn't finish. Please try again."],
])("refusal %s is explained", (reason, text) => {
  render(<Home member={null} refused={reason as RefusalReason} onLogout={() => {}} returnTo="/" />);
  expect(screen.getByRole("alert")).toHaveTextContent(text);
});
```

(`toBeInTheDocument` and `toHaveAttribute` need `@testing-library/jest-dom`; add it and a setup file.)

- [ ] **Step 3: Run them.** `pnpm test:client`. Expected: FAIL, `Home` not defined.

- [ ] **Step 4: Implement.** `App` loads `getMe()` once, reads `refused` from the query string, computes `returnTo`, and renders `Home`; after `logout()` it reloads. Styling is minimal and readable at phone width: one column, 16px side padding, system font. Colours are CSS custom properties on `:root`, no raw hex in TSX.

- [ ] **Step 5: Run them.** `pnpm test` (both suites), `pnpm typecheck`, `pnpm lint`. Expected: all pass.

- [ ] **Step 6: Commit.** `feat: sign-in screen`

---

### Task 5: CI, deploy, and the real sign-in

Steps marked **James** need his accounts and cannot be done by an agent.

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`
- Modify: `wrangler.jsonc`

- [ ] **Step 1: CI.** `.github/workflows/ci.yml`, on `pull_request` and pushes to `main`. Job `app`: `actions/checkout@v7`, `pnpm/action-setup@v6` with version `11.17.0`, `actions/setup-node@v6` with `node-version: 26` and `cache: pnpm`, then `pnpm install --frozen-lockfile`, `pnpm wrangler types --check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Job `deploy`: only on push to `main`, `needs: app`, `environment: production`, the same checkout, pnpm, Node, and install steps, then `pnpm wrangler d1 migrations apply DB --remote` (it accepts the binding name and skips its confirmation prompt when not interactive) and `pnpm run deploy`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from environment secrets.

- [ ] **Step 2: README.** What the project is in two sentences, links to the design and roadmap, the commands, and the one-time setup below written as a checklist.

- [ ] **Step 3: James: Cloudflare.** `pnpm wrangler login`, then `pnpm wrangler d1 create little-library`. Paste the returned id over `PLACEHOLDER` in `wrangler.jsonc`.

- [ ] **Step 4: Custom domain.** Add to `wrangler.jsonc`: `"routes": [{ "pattern": "books.waffle.haus", "custom_domain": true }]`. This needs `waffle.haus` to be an active zone on the account and no existing CNAME on `books`.

- [ ] **Step 5: James: Google.** In Google Cloud Console create an OAuth client of type "Web application" with redirect URIs `https://books.waffle.haus/auth/callback` and `http://localhost:5173/auth/callback`. Copy `.dev.vars.example` to `.dev.vars` and fill it in.

- [ ] **Step 6: James: secrets.** `pnpm wrangler secret put` for each of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWLIST_EMAILS`, `ADMIN_EMAILS`. In GitHub, create the `production` environment with James as required reviewer and add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

- [ ] **Step 7: Verify locally.** `pnpm wrangler d1 migrations apply DB --local`, `pnpm dev`, sign in at `http://localhost:5173` with an allowlisted account: `Hi, <name>` shows. Sign out. Sign in with an account that is not on the list: the invite-only message shows.

- [ ] **Step 8: Deploy and verify for real.** `pnpm wrangler d1 migrations apply DB --remote`, `pnpm run deploy`. On a phone, open `https://books.waffle.haus`, sign in with an allowlisted account, and see the greeting. Try a non-allowlisted account and see the refusal. This is the roadmap's "done when" for step 1.

- [ ] **Step 9: Commit and open a pull request.** `chore: CI and deploy`. Push `step-1-skeleton` and open a PR to `main`. Branch protection on `main` (require a PR and the `app` check, block force-push) is set once CI has run for the first time.
