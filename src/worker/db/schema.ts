import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
