import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Primary keys are declared at table level on notNull columns: a column-level
// `text PRIMARY KEY` accepts NULL in SQLite, and Drizzle omits NOT NULL there.
export const members = sqliteTable(
  "members",
  {
    id: text("id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    pictureUrl: text("picture_url"),
    createdAt: integer("created_at").notNull(),
    removedAt: integer("removed_at"),
  },
  (t) => [primaryKey({ columns: [t.id] })],
);

export const identities = sqliteTable(
  "identities",
  {
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
  },
  (t) => [primaryKey({ columns: [t.provider, t.subject] })],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").notNull(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tokenHash] })],
);

export const books = sqliteTable(
  "books",
  {
    id: text("id").notNull(),
    isbn: text("isbn"),
    title: text("title").notNull(),
    // JSON array of strings.
    authors: text("authors").notNull(),
    coverUrl: text("cover_url"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.id] }), uniqueIndex("books_isbn_unique").on(t.isbn)],
);

// A member's named place for their books. Written only by the ledger, which keeps the collections invariant.
export const collections = sqliteTable(
  "collections",
  {
    id: text("id").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => members.id),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    isDefault: integer("is_default").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    uniqueIndex("collections_owner_name_key_unique").on(t.ownerId, t.nameKey),
    uniqueIndex("collections_one_default").on(t.ownerId).where(sql`${t.isDefault} = 1`),
  ],
);

// A name a member keeps for someone who is not (yet) a member. Matched by name_key, unique per creator.
export const people = sqliteTable(
  "people",
  {
    id: text("id").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => members.id),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    linkedMemberId: text("linked_member_id").references(() => members.id),
    createdAt: integer("created_at").notNull(),
    linkedAt: integer("linked_at"),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    uniqueIndex("people_creator_name_key_unique").on(t.createdBy, t.nameKey),
    index("people_linked_member_id_idx").on(t.linkedMemberId),
  ],
);

// owner_id and holder_member_id are nullable for good: D1 cannot rebuild a table that has rows.
export const copies = sqliteTable(
  "copies",
  {
    id: text("id").notNull(),
    bookId: text("book_id")
      .notNull()
      .references(() => books.id),
    ownerId: text("owner_id").references(() => members.id),
    holderMemberId: text("holder_member_id").references(() => members.id),
    createdAt: integer("created_at").notNull(),
    // Null exactly when owner_id is null. Added after the table had rows, so nullable for good.
    collectionId: text("collection_id").references(() => collections.id),
    // The ISBN a member's StoryGraph file gave for a copy whose book has none on file.
    importIsbn: text("import_isbn"),
    // A placeholder holding the copy; at most one of this and holder_member_id is set.
    holderPersonId: text("holder_person_id").references(() => people.id),
    // An open request to keep the copy: both set or both null.
    requestedBy: text("requested_by").references(() => members.id),
    requestedAt: integer("requested_at"),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    index("copies_collection_id_idx").on(t.collectionId),
    index("copies_owner_id_idx").on(t.ownerId),
    index("copies_holder_member_id_idx").on(t.holderMemberId),
    index("copies_holder_person_id_idx").on(t.holderPersonId),
  ],
);

export const labels = sqliteTable(
  "labels",
  {
    code: text("code").notNull(),
    mintedBy: text("minted_by")
      .notNull()
      .references(() => members.id),
    mintedAt: integer("minted_at").notNull(),
    copyId: text("copy_id").references(() => copies.id),
    boundAt: integer("bound_at"),
    sheetId: text("sheet_id"),
    retiredAt: integer("retired_at"),
  },
  (t) => [
    primaryKey({ columns: [t.code] }),
    index("labels_copy_id_idx").on(t.copyId),
    uniqueIndex("labels_one_live_per_copy")
      .on(t.copyId)
      .where(sql`${t.retiredAt} is null and ${t.copyId} is not null`),
  ],
);

// The one key not declared at table level: AUTOINCREMENT needs a column-level INTEGER PRIMARY KEY.
// History is ordered by id.
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    copyId: text("copy_id")
      .notNull()
      .references(() => copies.id),
    at: integer("at").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => members.id),
    type: text("type").notNull(),
    // Who the event was done to or for: a member, or a placeholder.
    subjectMemberId: text("subject_member_id").references(() => members.id),
    subjectPersonId: text("subject_person_id").references(() => people.id),
  },
  // events_actor_id_type_idx: what a member gave up (given, approved, released), for the import's "had it" check.
  (t) => [index("events_copy_id_id_idx").on(t.copyId, t.id), index("events_actor_id_type_idx").on(t.actorId, t.type)],
);

export const bookLookups = sqliteTable(
  "book_lookups",
  {
    isbn: text("isbn").notNull(),
    title: text("title").notNull(),
    authors: text("authors").notNull(),
    coverUrl: text("cover_url"),
    source: text("source").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.isbn] })],
);
