import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  pictureUrl: text("picture_url"),
  createdAt: integer("created_at").notNull(),
  removedAt: integer("removed_at"),
});

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

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  expiresAt: integer("expires_at").notNull(),
});
