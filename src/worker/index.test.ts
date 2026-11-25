import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { invariantViolations } from "../../test/invariant";
import { resetDatabase } from "../../test/reset";
import found from "./booklookup/fixtures/found.json";
import googleFound from "./booklookup/fixtures/google-found.json";
import app from "./index";
import { signInAs } from "./membership/testing";

test("health check answers", async () => {
  const res = await exports.default.fetch("https://books.test/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

// Literal expected shape, deliberately not derived from schema.ts.
// Columns are [name, type, notnull, pk position (0 = not in key)].
// Foreign keys are [from, table, to, on_update, on_delete], sorted by column (SQLite lists them in reverse declaration order).
// Indexes are every index SQLite reports, including the automatic ones behind PRIMARY KEY and UNIQUE constraints:
// [name, unique, origin (c = CREATE INDEX, u = UNIQUE constraint, pk = primary key), partial, ordered columns], sorted by name.
const expectedShape: Record<
  string,
  {
    columns: [string, string, number, number][];
    foreignKeys: [string, string, string, string, string][];
    indexes: [string, number, string, number, string[]][];
  }
> = {
  identities: {
    columns: [
      ["provider", "TEXT", 1, 1],
      ["subject", "TEXT", 1, 2],
      ["member_id", "TEXT", 1, 0],
    ],
    foreignKeys: [["member_id", "members", "id", "NO ACTION", "NO ACTION"]],
    indexes: [["sqlite_autoindex_identities_1", 1, "pk", 0, ["provider", "subject"]]],
  },
  members: {
    columns: [
      ["id", "TEXT", 1, 1],
      ["name", "TEXT", 1, 0],
      ["email", "TEXT", 1, 0],
      ["picture_url", "TEXT", 0, 0],
      ["created_at", "INTEGER", 1, 0],
      ["removed_at", "INTEGER", 0, 0],
    ],
    foreignKeys: [],
    indexes: [["sqlite_autoindex_members_1", 1, "pk", 0, ["id"]]],
  },
  sessions: {
    columns: [
      ["token_hash", "TEXT", 1, 1],
      ["member_id", "TEXT", 1, 0],
      ["expires_at", "INTEGER", 1, 0],
    ],
    foreignKeys: [["member_id", "members", "id", "NO ACTION", "NO ACTION"]],
    indexes: [["sqlite_autoindex_sessions_1", 1, "pk", 0, ["token_hash"]]],
  },
  books: {
    columns: [
      ["id", "TEXT", 1, 1],
      ["isbn", "TEXT", 0, 0],
      ["title", "TEXT", 1, 0],
      ["authors", "TEXT", 1, 0],
      ["cover_url", "TEXT", 0, 0],
      ["created_at", "INTEGER", 1, 0],
    ],
    foreignKeys: [],
    indexes: [
      ["books_isbn_unique", 1, "c", 0, ["isbn"]],
      ["sqlite_autoindex_books_1", 1, "pk", 0, ["id"]],
    ],
  },
  copies: {
    columns: [
      ["id", "TEXT", 1, 1],
      ["book_id", "TEXT", 1, 0],
      ["owner_id", "TEXT", 0, 0],
      ["holder_member_id", "TEXT", 0, 0],
      ["created_at", "INTEGER", 1, 0],
      ["collection_id", "TEXT", 0, 0],
      ["import_isbn", "TEXT", 0, 0],
    ],
    foreignKeys: [
      ["book_id", "books", "id", "NO ACTION", "NO ACTION"],
      ["collection_id", "collections", "id", "NO ACTION", "NO ACTION"],
      ["holder_member_id", "members", "id", "NO ACTION", "NO ACTION"],
      ["owner_id", "members", "id", "NO ACTION", "NO ACTION"],
    ],
    indexes: [
      ["copies_collection_id_idx", 0, "c", 0, ["collection_id"]],
      ["copies_holder_member_id_idx", 0, "c", 0, ["holder_member_id"]],
      ["copies_owner_id_idx", 0, "c", 0, ["owner_id"]],
      ["sqlite_autoindex_copies_1", 1, "pk", 0, ["id"]],
    ],
  },
  collections: {
    columns: [
      ["id", "TEXT", 1, 1],
      ["owner_id", "TEXT", 1, 0],
      ["name", "TEXT", 1, 0],
      ["name_key", "TEXT", 1, 0],
      ["is_default", "INTEGER", 1, 0],
      ["created_at", "INTEGER", 1, 0],
    ],
    foreignKeys: [["owner_id", "members", "id", "NO ACTION", "NO ACTION"]],
    indexes: [
      ["collections_one_default", 1, "c", 1, ["owner_id"]],
      ["collections_owner_name_key_unique", 1, "c", 0, ["owner_id", "name_key"]],
      ["sqlite_autoindex_collections_1", 1, "pk", 0, ["id"]],
    ],
  },
  labels: {
    columns: [
      ["code", "TEXT", 1, 1],
      ["minted_by", "TEXT", 1, 0],
      ["minted_at", "INTEGER", 1, 0],
      ["copy_id", "TEXT", 0, 0],
      ["bound_at", "INTEGER", 0, 0],
    ],
    foreignKeys: [
      ["copy_id", "copies", "id", "NO ACTION", "NO ACTION"],
      ["minted_by", "members", "id", "NO ACTION", "NO ACTION"],
    ],
    indexes: [
      ["labels_copy_id_idx", 0, "c", 0, ["copy_id"]],
      ["sqlite_autoindex_labels_1", 1, "pk", 0, ["code"]],
    ],
  },
  events: {
    // The one key not declared at table level: AUTOINCREMENT needs a column-level INTEGER PRIMARY KEY, which reports notnull 0.
    columns: [
      ["id", "INTEGER", 0, 1],
      ["copy_id", "TEXT", 1, 0],
      ["at", "INTEGER", 1, 0],
      ["actor_id", "TEXT", 1, 0],
      ["type", "TEXT", 1, 0],
    ],
    foreignKeys: [
      ["actor_id", "members", "id", "NO ACTION", "NO ACTION"],
      ["copy_id", "copies", "id", "NO ACTION", "NO ACTION"],
    ],
    indexes: [["events_copy_id_id_idx", 0, "c", 0, ["copy_id", "id"]]],
  },
  book_lookups: {
    columns: [
      ["isbn", "TEXT", 1, 1],
      ["title", "TEXT", 1, 0],
      ["authors", "TEXT", 1, 0],
      ["cover_url", "TEXT", 0, 0],
      ["source", "TEXT", 1, 0],
      ["fetched_at", "INTEGER", 1, 0],
    ],
    foreignKeys: [],
    indexes: [["sqlite_autoindex_book_lookups_1", 1, "pk", 0, ["isbn"]]],
  },
};

test("migrations created the tables", async () => {
  for (const [table, expected] of Object.entries(expectedShape)) {
    const columns = await env.DB.prepare(
      "select name, type, \"notnull\", pk from pragma_table_info(?) order by cid",
    )
      .bind(table)
      .all<{ name: string; type: string; notnull: number; pk: number }>();
    expect(
      columns.results.map((c) => [c.name, c.type, c.notnull, c.pk]),
      `${table} columns`,
    ).toEqual(expected.columns);

    const fks = await env.DB.prepare('select "from", "table", "to", on_update, on_delete from pragma_foreign_key_list(?) order by "from"')
      .bind(table)
      .all<{ from: string; table: string; to: string; on_update: string; on_delete: string }>();
    expect(
      fks.results.map((f) => [f.from, f.table, f.to, f.on_update, f.on_delete]),
      `${table} foreign keys`,
    ).toEqual(expected.foreignKeys);

    const list = await env.DB.prepare('select name, "unique", origin, partial from pragma_index_list(?) order by name')
      .bind(table)
      .all<{ name: string; unique: number; origin: string; partial: number }>();
    const indexes: [string, number, string, number, string[]][] = [];
    for (const i of list.results) {
      const cols = await env.DB.prepare("select name from pragma_index_info(?) order by seqno")
        .bind(i.name)
        .all<{ name: string }>();
      indexes.push([i.name, i.unique, i.origin, i.partial, cols.results.map((c) => c.name)]);
    }
    expect(indexes, `${table} indexes`    ).toEqual(expected.indexes);
  }
});

// drizzle-kit's db:check tracks indexes by name only, so a changed predicate or column list would pass it unseen.
// Pinning the SQL itself, whitespace collapsed, is what catches schema.ts and the migrations drifting apart there.
const expectedIndexSql: Record<string, string> = {
  books_isbn_unique: "CREATE UNIQUE INDEX `books_isbn_unique` ON `books` (`isbn`)",
  collections_one_default:
    'CREATE UNIQUE INDEX `collections_one_default` ON `collections` (`owner_id`) WHERE "collections"."is_default" = 1',
  collections_owner_name_key_unique:
    "CREATE UNIQUE INDEX `collections_owner_name_key_unique` ON `collections` (`owner_id`,`name_key`)",
  copies_collection_id_idx: "CREATE INDEX `copies_collection_id_idx` ON `copies` (`collection_id`)",
  copies_holder_member_id_idx: "CREATE INDEX `copies_holder_member_id_idx` ON `copies` (`holder_member_id`)",
  copies_owner_id_idx: "CREATE INDEX `copies_owner_id_idx` ON `copies` (`owner_id`)",
  events_copy_id_id_idx: "CREATE INDEX `events_copy_id_id_idx` ON `events` (`copy_id`,`id`)",
  labels_copy_id_idx: "CREATE INDEX `labels_copy_id_idx` ON `labels` (`copy_id`)",
};

test("every created index has exactly this SQL, predicate and uniqueness included", async () => {
  const { results } = await env.DB.prepare(
    "select name, sql from sqlite_master where type = 'index' and sql is not null order by name",
  ).all<{ name: string; sql: string }>();
  expect(Object.fromEntries(results.map((r) => [r.name, r.sql.replace(/\s+/g, " ").trim()]))).toEqual(expectedIndexSql);
});

test("the database holds exactly these tables", async () => {
  const { results } = await env.DB.prepare(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'd1_%' and name not like '_cf_%' order by name",
  ).all<{ name: string }>();
  expect(results.map((t) => t.name)).toEqual(Object.keys(expectedShape).sort());
});

test("events is created with AUTOINCREMENT, so ids are never reused", async () => {
  const row = await env.DB.prepare("select sql from sqlite_master where type = 'table' and name = 'events'").first<{
    sql: string;
  }>();
  expect(row!.sql).toContain("AUTOINCREMENT");
});

test("books: many NULL isbns coexist, a repeated isbn is refused", async () => {
  await resetDatabase(env.DB);
  const insert = (id: string, isbn: string | null) =>
    env.DB.prepare("insert into books (id, isbn, title, authors, created_at) values (?, ?, 'T', '[]', 1)").bind(id, isbn);
  await env.DB.batch([insert("n1", null), insert("n2", null), insert("i1", "9780000000002")]);
  await expect(insert("i2", "9780000000002").run()).rejects.toThrow(/UNIQUE/);
  await resetDatabase(env.DB);
});

const insertMember = (id: string) =>
  env.DB.prepare("insert into members (id, name, email, created_at) values (?, ?, ?, 1)").bind(id, id, `${id}@example.com`);
const insertCollection = (id: string, owner: string, nameKey: string, isDefault: number) =>
  env.DB.prepare(
    "insert into collections (id, owner_id, name, name_key, is_default, created_at) values (?, ?, ?, ?, ?, 1)",
  ).bind(id, owner, nameKey, nameKey, isDefault);

test("a second default for one owner is refused; defaults for two owners coexist", async () => {
  await resetDatabase(env.DB);
  await env.DB.batch([insertMember("m1"), insertMember("m2"), insertCollection("c1", "m1", "a", 1), insertCollection("c2", "m2", "a", 1), insertCollection("c3", "m1", "b", 0)]);
  await expect(insertCollection("c4", "m1", "c", 1).run()).rejects.toThrow(/UNIQUE/);
  await resetDatabase(env.DB);
});

test("names clash per owner by key, not across owners", async () => {
  await resetDatabase(env.DB);
  await env.DB.batch([insertMember("m1"), insertMember("m2"), insertCollection("c1", "m1", "beach", 0), insertCollection("c2", "m2", "beach", 0)]);
  await expect(insertCollection("c3", "m1", "beach", 0).run()).rejects.toThrow(/UNIQUE/);
  await resetDatabase(env.DB);
});

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

test("me and login are marked no-store", async () => {
  const me = await exports.default.fetch("https://books.test/api/me");
  expect(me.headers.get("cache-control")).toBe("no-store");
  const login = await exports.default.fetch("https://books.test/auth/login", { redirect: "manual" });
  expect(login.headers.get("cache-control")).toBe("no-store");
});

test("a callback without a login cookie is refused as failed, uncached", async () => {
  const res = await exports.default.fetch("https://books.test/auth/callback?code=x&state=y", { redirect: "manual" });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?refused=failed");
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("logout without a session answers 204, uncached", async () => {
  const res = await exports.default.fetch("https://books.test/auth/logout", { method: "POST" });
  expect(res.status).toBe(204);
  expect(res.headers.get("cache-control")).toBe("no-store");
});

// ---- routes ----

const SITE = "https://books.test";
const natalie = { provider: "google" as const, subject: "natalie", email: "natalie@example.com", name: "Natalie", pictureUrl: null, emailVerified: true };

// An env whose DB binding fails as `how` says: every use, or only batch.
function brokenEnv(how: "all" | "batch"): Env {
  const real = env.DB;
  const db = new Proxy(real, {
    get(target, prop) {
      if (how === "all" || prop === "batch") return () => { throw new Error("secret-detail: the database is on fire"); };
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { ...env, DB: db } as Env;
}
const call = (path: string, init: RequestInit = {}, e: Env = env) => app.request(`${SITE}${path}`, init, e);
const post = (path: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: "POST", headers: { cookie, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => resetDatabase(env.DB));
afterEach(async () => {
  expect(await invariantViolations(env.DB)).toEqual([]);
});

test.each([
  ["POST", "/api/labels"],
  ["GET", "/api/books/lookup?isbn=9780306406157"],
  ["POST", "/api/copies"],
  ["POST", "/api/labels/t7k2q9xzmb/claim"],
  ["POST", "/api/copies/x/return"],
])("%s %s signed out is 401", async (method, path) => {
  const res = await call(path, { method });
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ rejected: "signed-out" });
});

test("a body that is not JSON, or not an object, is 400", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  for (const path of ["/api/labels", "/api/copies"]) {
    for (const raw of ["not json", "[1]", "null", "7", ""]) {
      const res = await call(path, { method: "POST", headers: { cookie }, body: raw });
      expect(res.status, `${path} ${raw}`).toBe(400);
      expect(await res.json()).toEqual({ rejected: "invalid" });
    }
  }
});

test("when the database is down, a member route is 503, not 401", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const e = brokenEnv("all");
  const res = await call("/api/labels", { method: "POST", headers: { cookie }, body: JSON.stringify({ count: 1 }) }, e);
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ rejected: "unavailable" });
  const view = await call("/api/labels/t7k2q9xzmb", {}, e);
  expect(view.status).toBe(503);
});

test("when the database is down, /api/me is 503 and /api/health still answers", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const e = brokenEnv("all");
  const me = await call("/api/me", { headers: { cookie } }, e);
  expect(me.status).toBe(503);
  expect(await me.json()).toEqual({ rejected: "unavailable" });
  const health = await call("/api/health", { headers: { cookie } }, e);
  expect(health.status).toBe(200);
});

test("/api/me names the signed-in member", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const res = await call("/api/me", { headers: { cookie } });
  expect(await res.json()).toMatchObject({ member: { name: "Natalie", email: "natalie@example.com" } });
});

test("an unexpected error is 503 with no detail", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const res = await call("/api/labels", { method: "POST", headers: { cookie }, body: JSON.stringify({ count: 1 }) }, brokenEnv("batch"));
  expect(res.status).toBe(503);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ rejected: "unavailable" });
  expect(text).not.toContain("secret-detail");
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("every /api answer is no-store", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const answers = [
    await call("/api/health"),
    await call("/api/me"),
    await call("/api/labels/t7k2q9xzmb"),
    await call("/api/labels", { method: "POST" }),
    await post("/api/labels", cookie, { count: 1 }),
    await post("/api/labels", cookie, { count: 0 }),
    await post("/api/labels", cookie, undefined, { origin: "https://evil.example" }),
    await call("/api/books/lookup", { headers: { cookie } }),
    await call("/api/nothing-here"),
  ];
  for (const res of answers) expect(res.headers.get("cache-control")).toBe("no-store");
});

test("a rejection becomes its status; a lookup that knows nothing is null", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  expect((await post("/api/labels", cookie, { count: 0 })).status).toBe(400);
  expect((await post("/api/labels/t7k2q9xzmb/claim", cookie)).status).toBe(404);
  expect((await post("/api/copies", cookie, { code: "t7k2q9xzmb", title: "T", authors: ["A"] })).status).toBe(404);
  expect((await call("/api/books/lookup", { headers: { cookie } })).status).toBe(400);

  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 404 }));
  try {
    const res = await call("/api/books/lookup?isbn=9780306406157", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ book: null });
  } finally {
    fetchSpy.mockRestore();
  }
});

test("a label in use is 409", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const minted = (await (await post("/api/labels", cookie, { count: 1 })).json()) as { labels: { code: string }[] };
  const code = minted.labels[0].code;
  const body = { code, title: "T", authors: ["A"] };
  expect((await post("/api/copies", cookie, body)).status).toBe(200);
  expect((await post("/api/copies", cookie, body)).status).toBe(409);
});

describe("same-site check", () => {
  test.each<[Record<string, string>, number]>([
    [{ origin: "https://evil.example" }, 403],
    [{ origin: "https://other.waffle.haus" }, 403], // a sibling site
    [{ origin: "null" }, 403],
    [{ origin: "https://other.books.test" }, 403],
    [{ origin: "https://books.test.evil.example" }, 403],
    [{ origin: "https://books.test:8443" }, 403],
    [{ origin: "http://books.test" }, 403],
    [{ "sec-fetch-site": "same-site" }, 403],
    [{ "sec-fetch-site": "cross-site" }, 403],
    [{ origin: "https://books.test", "sec-fetch-site": "same-origin" }, 200],
    [{}, 200], // not a browser
  ])("a claim with headers %j is %s, and a refused one records nothing", async (headers, status) => {
    const { cookie } = await signInAs(env.DB, natalie);
    const james = await signInAs(env.DB, { ...natalie, subject: "james", email: "james@example.com", name: "James" });
    const minted = (await (await post("/api/labels", cookie, { count: 1 })).json()) as { labels: { code: string }[] };
    const code = minted.labels[0].code;
    await post("/api/copies", cookie, { code, title: "T", authors: ["A"] });

    const res = await post(`/api/labels/${code}/claim`, james.cookie, undefined, headers);
    expect(res.status).toBe(status);
    if (status === 403) expect(await res.json()).toEqual({ rejected: "not-allowed" });

    const events = await env.DB.prepare("select type from events order by id").all<{ type: string }>();
    expect(events.results.map((e) => e.type)).toEqual(status === 200 ? ["added", "labelled", "claimed"] : ["added", "labelled"]);
  });

  test("the same check covers POST /auth/logout", async () => {
    const { cookie } = await signInAs(env.DB, natalie);
    const refused = await call("/auth/logout", { method: "POST", headers: { cookie, origin: "https://evil.example" } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ rejected: "not-allowed" });
    const still = await call("/api/me", { headers: { cookie } });
    expect(((await still.json()) as { member: unknown }).member).not.toBeNull();
    const done = await call("/auth/logout", { method: "POST", headers: { cookie } });
    expect(done.status).toBe(204);
  });

  test("a GET is never refused by the same-site check", async () => {
    for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[]) {
      const res = await call("/api/health", { headers });
      expect(res.status).toBe(200);
    }
  });
});

// ---- fix round 1 ----

const ISBN = "9798855427974";
const stubOpenLibrary = (body: unknown) => {
  const urls: string[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch);
  return { urls, restore: () => spy.mockRestore() };
};

test("lookup finds a book; add by ISBN saves it; add by ISBN that nobody knows is 404 book-not-found", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const minted = (await (await post("/api/labels", cookie, { count: 2 })).json()) as { labels: { code: string }[] };
  const stub = stubOpenLibrary(found);
  try {
    const res = await call(`/api/books/lookup?isbn=${ISBN}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { book: { title: string } }).book.title).toContain("Guy She Was Interested in");

    const added = await post("/api/copies", cookie, { code: minted.labels[0].code, isbn: ISBN });
    expect(added.status).toBe(200);
    expect(((await added.json()) as { book: { title: string } }).book.title).toContain("Guy She Was Interested in");
  } finally {
    stub.restore();
  }
  const miss = stubOpenLibrary({});
  try {
    // 9780306406157 is not cached by the lookups above.
    const res = await post("/api/copies", cookie, { code: minted.labels[1].code, isbn: "9780306406157" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ rejected: "book-not-found" });
  } finally {
    miss.restore();
  }
});

const withKey = { ...env, GOOGLE_BOOKS_API_KEY: "test-key" } as Env;
const lookupBody = async (e: Env) => {
  const { cookie } = await signInAs(env.DB, natalie);
  const res = await call(`/api/books/lookup?isbn=${ISBN}`, { headers: { cookie } }, e);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
};
// Answers Open Library with `open` and Google Books with `google`, recording the URLs.
const stubBoth = (open: unknown, google: unknown) => {
  const urls: string[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return new Response(JSON.stringify(url.includes("googleapis.com") ? google : open), { status: 200 });
  }) as typeof fetch);
  return { urls, restore: () => spy.mockRestore() };
};
const googleOnly = (urls: string[]) => urls.filter((u) => u.includes("googleapis.com"));

test("lookup miss with no key (the pinned empty one) never asks Google", async () => {
  const stub = stubBoth({}, googleFound);
  try {
    expect(await lookupBody(env)).toEqual({ book: null });
    expect(googleOnly(stub.urls)).toEqual([]);
  } finally {
    stub.restore();
  }
});

test("lookup miss with a key: Google's book is answered with its cover, saved as google-books, and the key stays out of it", async () => {
  const stub = stubBoth({}, googleFound);
  try {
    const body = await lookupBody(withKey);
    expect(Object.keys(body)).toEqual(["book"]);
    expect(body.book).toMatchObject({
      isbn: ISBN,
      title: googleFound.items[0].volumeInfo.title,
      coverUrl: expect.stringMatching(/^https:\/\/books\.google\.com\//),
    });
    expect(JSON.stringify(body)).not.toContain("test-key");
    const google = googleOnly(stub.urls);
    expect(google).toHaveLength(1);
    expect(new URL(google[0]).searchParams.get("key")).toBe("test-key");
    const stored = (await env.DB.prepare("select source, cover_url from book_lookups").all()).results;
    expect(stored).toEqual([{ source: "google-books", cover_url: expect.stringContaining("books.google.com") }]);
    expect(JSON.stringify(stored)).not.toContain("test-key");
  } finally {
    stub.restore();
  }
});

test("lookup hit with a key never asks Google", async () => {
  const stub = stubBoth(found, googleFound);
  try {
    const body = await lookupBody(withKey);
    expect((body.book as { title: string }).title).toContain("Guy She Was Interested in");
    expect(googleOnly(stub.urls)).toEqual([]);
  } finally {
    stub.restore();
  }
});

test.each([
  ["cross-site", 403],
  ["same-site", 403],
  ["same-origin", 200],
  ["none", 200],
  [null, 200],
])("lookup with Sec-Fetch-Site %s is %s, and a refusal makes no outbound request", async (site, status) => {
  const { cookie } = await signInAs(env.DB, natalie);
  const stub = stubOpenLibrary({});
  try {
    const headers: Record<string, string> = { cookie };
    if (site) headers["sec-fetch-site"] = site;
    const res = await call(`/api/books/lookup?isbn=${ISBN}`, { headers });
    expect(res.status).toBe(status);
    if (status === 403) {
      expect(await res.json()).toEqual({ rejected: "not-allowed" });
      expect(stub.urls).toEqual([]);
    } else {
      expect(stub.urls).toHaveLength(1);
    }
  } finally {
    stub.restore();
  }
});

test("an error on an encoded /api path is still 503 JSON", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const res = await call("/%61pi/labels", { method: "POST", headers: { cookie }, body: JSON.stringify({ count: 1 }) }, brokenEnv("batch"));
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ rejected: "unavailable" });
});

test("an unknown /api path is 404 JSON, no-store", async () => {
  for (const path of ["/api/nothing-here", "/api"]) {
    const res = await call(path);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ rejected: "not-found" });
  }
});

test("a JSON body over 16 KB is 400 invalid, whether declared or discovered while reading", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const big = JSON.stringify({ count: 1, pad: "x".repeat(16 * 1024) });
  const declared = await call("/api/labels", { method: "POST", headers: { cookie, "content-length": String(big.length) }, body: big });
  expect(declared.status).toBe(400);
  expect(await declared.json()).toEqual({ rejected: "invalid" });

  // No Content-Length: a stream, so only reading can tell.
  const chunk = new TextEncoder().encode("x".repeat(4096));
  const streamed = new ReadableStream({
    start(ctl) { for (let i = 0; i < 8; i++) ctl.enqueue(chunk); ctl.close(); },
  });
  const res = await app.request(`${SITE}/api/labels`, { method: "POST", headers: { cookie }, body: streamed, duplex: "half" } as RequestInit, env);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ rejected: "invalid" });
  const ok = await post("/api/labels", cookie, { count: 1 });
  expect(ok.status).toBe(200);
});

// ---- collections, shelves, holding, labelling, import ----

const sam = { ...natalie, subject: "sam", email: "sam@example.com", name: "Sam" };
const get = (path: string, cookie: string) => call(path, { headers: { cookie } });
const send = (method: string, path: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(path, { method, headers: { cookie, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

const EVERY_NEW_ROUTE: [string, string][] = [
  ["GET", "/api/collections/mine"],
  ["POST", "/api/collections"],
  ["PATCH", "/api/collections/x"],
  ["DELETE", "/api/collections/x"],
  ["POST", "/api/collections/x/default"],
  ["GET", "/api/collections/x"],
  ["GET", "/api/members"],
  ["GET", "/api/members/x/collections"],
  ["GET", "/api/holding"],
  ["GET", "/api/copies/candidates?isbn=9780306406157"],
  ["GET", "/api/copies/x"],
  ["POST", "/api/copies/x/move"],
  ["POST", "/api/copies/x/label"],
  ["POST", "/api/imports"],
];

test.each(EVERY_NEW_ROUTE)("%s %s signed out is 401", async (method, path) => {
  const res = await call(path, { method });
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ rejected: "signed-out" });
});

test.each(EVERY_NEW_ROUTE)("%s %s with a removed member's session is 401 and shows no collection names", async (method, path) => {
  const { cookie } = await signInAs(env.DB, natalie);
  await send("POST", "/api/collections", cookie, { name: "Beach house" });
  await env.DB.prepare("update members set removed_at = 1").run();
  const res = await send(method, path, cookie, method === "GET" ? undefined : {});
  expect(res.status).toBe(401);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ rejected: "signed-out" });
  expect(text).not.toContain("Beach");
});

test("a name clash is 409 name-taken", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  expect((await send("POST", "/api/collections", cookie, { name: "Beach house" })).status).toBe(200);
  const clash = await send("POST", "/api/collections", cookie, { name: " beach HOUSE " });
  expect(clash.status).toBe(409);
  expect(await clash.json()).toEqual({ rejected: "name-taken" });
  const other = (await (await send("POST", "/api/collections", cookie, { name: "Attic" })).json()) as { id: string };
  const rename = await send("PATCH", `/api/collections/${other.id}`, cookie, { name: "Beach house" });
  expect(rename.status).toBe(409);
});

test.each(["PATCH /api/collections/x", "DELETE /api/collections/x", "POST /api/imports"])(
  "%s from another site is 403 and changes nothing", async (route) => {
    const [method, path] = route.split(" ");
    const { cookie } = await signInAs(env.DB, natalie);
    const made = (await (await send("POST", "/api/collections", cookie, { name: "Beach house" })).json()) as { id: string };
    const target = path.replace("/x", `/${made.id}`);
    const body = method === "DELETE" ? undefined : method === "PATCH" ? { name: "Renamed" } : { collectionId: made.id, rows: [{ title: "T", authors: [], isbn: null }] };
    const res = await send(method, target, cookie, body, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ rejected: "not-allowed" });
    const mine = (await (await get("/api/collections/mine", cookie)).json()) as { collections: { name: string; count: number }[] };
    expect(mine.collections.map((k) => k.name)).toEqual(["Beach house"]);
    expect(mine.collections.reduce((n, k) => n + k.count, 0)).toBe(0);
  });

test("/api/collections/mine is not taken for an id, and both id formats are accepted", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const mine = await get("/api/collections/mine", cookie);
  expect(mine.status).toBe(200);
  const body = (await mine.json()) as { owner: { name: string }; collections: { id: string; isDefault: boolean }[] };
  expect(body.owner.name).toBe("Natalie");
  const created = (await (await send("POST", "/api/collections", cookie, { name: "Attic" })).json()) as { id: string };
  expect(created.id).toHaveLength(36);
  expect((await get(`/api/collections/${created.id}`, cookie)).status).toBe(200);
  const hex = "a".repeat(32);
  await env.DB.prepare("update collections set id = ? where id = ?").bind(hex, created.id).run();
  expect((await get(`/api/collections/${hex}`, cookie)).status).toBe(200);
  expect((await get("/api/collections/not-an-id", cookie)).status).toBe(404);
  expect((await get(`/api/collections/${"b".repeat(36)}`, cookie)).status).toBe(404);
});

test("collections can be renamed, made default, and deleted over HTTP", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const k = (await (await send("POST", "/api/collections", cookie, { name: "Attic" })).json()) as { id: string };
  const renamed = await send("PATCH", `/api/collections/${k.id}`, cookie, { name: "Cellar" });
  expect(await renamed.json()).toMatchObject({ id: k.id, name: "Cellar" });
  const second = (await (await send("POST", "/api/collections", cookie, { name: "Attic" })).json()) as { id: string };
  const def = (await (await send("POST", `/api/collections/${k.id}/default`, cookie)).json()) as { collections: { id: string; name: string; isDefault: boolean }[] };
  expect(def.collections.map((c) => [c.name, c.isDefault])).toEqual([["Cellar", true], ["Attic", false]]);
  const del = await send("DELETE", `/api/collections/${second.id}`, cookie);
  expect(await del.json()).toEqual({ deleted: true });
  expect((await send("PATCH", `/api/collections/${k.id}`, cookie, { name: 5 })).status).toBe(400);
  expect((await send("POST", "/api/collections", cookie, { })).status).toBe(400);
});

test("GET /api/members lists active members with no email and not removed ones", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  await signInAs(env.DB, sam);
  await signInAs(env.DB, { ...natalie, subject: "gone", email: "gone@example.com", name: "Gone" });
  await env.DB.prepare("update members set removed_at = 1 where name = 'Gone'").run();
  const res = await get("/api/members", cookie);
  const text = await res.text();
  expect(res.status).toBe(200);
  expect((JSON.parse(text) as { members: { name: string }[] }).members.map((m) => m.name)).toEqual(["Natalie", "Sam"]);
  expect(text).not.toContain("@");
  expect(text).not.toContain("Gone");
});

test("a member id that is not a member is 404", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  expect((await get("/api/members/nobody/collections", cookie)).status).toBe(404);
});

test("an import body over 16 KB is 400; 21 rows is 400; a missing or non-string collectionId is null or 400", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const row = { title: "T", authors: [], isbn: null };
  const over = await send("POST", "/api/imports", cookie, { collectionId: null, rows: [{ ...row, title: "x".repeat(16 * 1024) }] });
  expect(over.status).toBe(400);
  expect(await over.json()).toEqual({ rejected: "invalid" });
  const twentyOne = await send("POST", "/api/imports", cookie, { collectionId: null, rows: Array.from({ length: 21 }, (_, i) => ({ ...row, title: `T${i}` })) });
  expect(twentyOne.status).toBe(400);
  const ok = await send("POST", "/api/imports", cookie, { rows: [row] });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ added: 1, skipped: 0 });
  for (const collectionId of [5, true, {}, []]) {
    expect((await send("POST", "/api/imports", cookie, { collectionId, rows: [row] })).status).toBe(400);
  }
  expect((await send("POST", "/api/imports", cookie, { collectionId: "x".repeat(36), rows: [row] })).status).toBe(404);
});

test("an import chunk of 12000 bytes (20 rows, 32-char id) is accepted, and a body past 16 KB is not", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const k = (await (await send("POST", "/api/collections", cookie, { name: "Big" })).json()) as { id: string };
  await env.DB.prepare("update collections set id = ? where id = ?").bind("c".repeat(32), k.id).run();
  const collectionId = "c".repeat(32);
  const rowOf = (i: number, pad: number, authors: number) =>
    ({ title: `T${String(i).padStart(2, "0")}`, authors: Array.from({ length: authors }, () => "a".repeat(pad)), isbn: null });
  const sized = (pad: number, authors = 3) => JSON.stringify({ collectionId, rows: Array.from({ length: 20 }, (_, i) => rowOf(i, pad, authors)) });
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  let pad = 1;
  while (bytes(sized(pad + 1)) <= 12000) pad++;
  const body = sized(pad);
  expect(bytes(body)).toBeLessThanOrEqual(12000);
  expect(bytes(body)).toBeGreaterThan(11900);
  const fits = await call("/api/imports", { method: "POST", headers: { cookie }, body });
  expect(fits.status).toBe(200);
  expect(await fits.json()).toEqual({ added: 20, skipped: 0 });
  const tooBig = sized(200, 4); // valid rows, so only the body bound can refuse it
  expect(bytes(tooBig)).toBeGreaterThan(16 * 1024);
  expect((await call("/api/imports", { method: "POST", headers: { cookie }, body: tooBig })).status).toBe(400);
});

test("an import whose lookup is unavailable is 503 and writes nothing", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async () => new Response("down", { status: 503 })) as typeof fetch);
  try {
    const res = await send("POST", "/api/imports", cookie, { rows: [{ title: "Dune", authors: [], isbn: "9780441172719" }] });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ rejected: "unavailable" });
    expect((await env.DB.prepare("select count(*) as n from copies").first<{ n: number }>())!.n).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("no collections, shelf, holding, candidates, or copy-by-id answer contains a label code or an @", async () => {
  const nat = await signInAs(env.DB, natalie);
  const s = await signInAs(env.DB, sam);
  const { labels } = (await (await send("POST", "/api/labels", nat.cookie, { count: 2 })).json()) as { labels: { code: string }[] };
  const [code, spare] = labels.map((l) => l.code);
  const added = (await (await send("POST", "/api/copies", nat.cookie, { code, title: "The Hobbit", authors: ["Tolkien"] })).json()) as { copyId: string };
  await send("POST", "/api/imports", nat.cookie, { rows: [{ title: "Unlabelled", authors: ["U"], isbn: null }] });
  await send("POST", `/api/labels/${code}/claim`, s.cookie);
  const mine = (await (await get("/api/collections/mine", nat.cookie)).json()) as { collections: { id: string }[] };
  const paths = [
    "/api/collections/mine", `/api/collections/${mine.collections[0].id}`, "/api/holding", "/api/members",
    `/api/members/${nat.member.id}/collections`, `/api/copies/${added.copyId}`, "/api/copies/candidates?title=Unlabelled",
  ];
  for (const cookie of [nat.cookie, s.cookie]) {
    for (const path of paths) {
      const res = await get(path, cookie);
      expect(res.status, path).toBe(200);
      const text = await res.text();
      expect(text, path).not.toContain(code);
      expect(text, path).not.toContain(spare);
      expect(text, path).not.toContain("@");
    }
  }
});

test("candidates needs an isbn or a title, and a copy id that cannot exist is 404", async () => {
  const { cookie } = await signInAs(env.DB, natalie);
  expect((await get("/api/copies/candidates", cookie)).status).toBe(400);
  expect((await get("/api/copies/nope", cookie)).status).toBe(404);
  expect((await send("POST", "/api/copies/nope/move", cookie, { collectionId: "a".repeat(32) })).status).toBe(404);
});
