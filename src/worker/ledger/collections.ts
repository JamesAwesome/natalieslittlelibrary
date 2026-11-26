import { cleanCollectionName } from "../../shared/collectionName";
import type { CollectionSummary, Member, Rejection } from "../../shared/types";
import { createShelfReads } from "./shelves";

// The active-actor guard; bind the actor's id once.
export const ACTIVE = "exists (select 1 from members where id = ? and removed_at is null)";
// The owner's default collection's id; bind the owner's id once.
export const DEFAULT_OF = "(select id from collections where owner_id = ? and is_default = 1)";

export const DEFAULT_NAME = "Home library";

// Gives an active member a default collection if they have none, then pins any of their owned copies that old code left
// with a null collection_id to that default (so a later change of default cannot silently move them). Spread the two
// statements first into any batch that gives the member a copy, then select the persisted default; never use an id this
// call proposed. It works for a member who owns such copies and has no collection row at all.
// The default is named "Home library", or the first of "Home library 2", "Home library 3", … the member has no
// collection called, picked inside the insert. Of n collections at most n names are taken, so one of the first n + 1 is free.
// `onlyIf`: a where-fragment both statements also need, so a batch its guard refuses leaves no default behind.
export function ensureDefault(db: D1Database, ownerId: string, at: number, onlyIf?: { sql: string; binds: unknown[] }): D1PreparedStatement[] {
  const extra = onlyIf ? { sql: ` and ${onlyIf.sql}`, binds: onlyIf.binds } : { sql: "", binds: [] };
  return [
    db
      .prepare(
        `with recursive n(i) as (
           select 1 union all select i + 1 from n where i <= (select count(*) from collections where owner_id = ?)
         ), names(i, name) as (
           select i, case when i = 1 then '${DEFAULT_NAME}' else '${DEFAULT_NAME} ' || i end from n
         )
         insert into collections (id, owner_id, name, name_key, is_default, created_at)
         select ?, ?, name, lower(name), 1, ? from names
         where not exists (select 1 from collections where owner_id = ? and name_key = lower(names.name))
           and ${ACTIVE} and not exists (select 1 from collections where owner_id = ? and is_default = 1)${extra.sql}
         order by i limit 1
         on conflict do nothing`,
      )
      .bind(ownerId, crypto.randomUUID(), ownerId, at, ownerId, ownerId, ownerId, ...extra.binds),
    pinNullCopies(db, ownerId, extra),
  ];
}

// Owned copies with no collection (old code) belong to the owner's current default; this makes it so.
function pinNullCopies(db: D1Database, ownerId: string, extra: { sql: string; binds: unknown[] } = { sql: "", binds: [] }): D1PreparedStatement {
  return db
    .prepare(
      `update copies set collection_id = ${DEFAULT_OF}
       where owner_id = ? and collection_id is null and ${ACTIVE} and exists ${DEFAULT_OF}${extra.sql}`,
    )
    .bind(ownerId, ownerId, ownerId, ownerId, ...extra.binds);
}

const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

// Every write goes through db.batch, even a single statement, so the tests' gated and racing databases can interleave it.
export function createCollectionWrites(db: D1Database, now: () => number) {
  async function isActive(id: string): Promise<boolean> {
    return (await db.prepare("select 1 as ok from members where id = ? and removed_at is null").bind(id).first()) !== null;
  }

  const { collectionsOf } = createShelfReads(db);
  async function summariesOf(ownerId: string): Promise<CollectionSummary[]> {
    const r = await collectionsOf(ownerId);
    return "rejected" in r ? [] : r.collections;
  }

  async function summaryOne(ownerId: string, id: string): Promise<CollectionSummary | null> {
    return (await summariesOf(ownerId)).find((c) => c.id === id) ?? null;
  }

  // The collection, if it is the owner's.
  async function reread(id: string, ownerId: string) {
    const row = await db
      .prepare("select owner_id, is_default from collections where id = ?")
      .bind(id)
      .first<{ owner_id: string; is_default: number }>();
    return row && row.owner_id === ownerId ? row : null;
  }

  async function createCollection(member: Member, rawName: string): Promise<CollectionSummary | Rejection> {
    const clean = cleanCollectionName(rawName);
    if (clean === null) return { rejected: "invalid" };
    const id = crypto.randomUUID();
    let changes: number;
    try {
      const [r] = await db.batch([
        db
          .prepare(
            `insert into collections (id, owner_id, name, name_key, is_default, created_at)
             select ?, ?, ?, ?, case when exists (select 1 from collections where owner_id = ? and is_default = 1) then 0 else 1 end, ?
             where ${ACTIVE} and not exists (select 1 from collections where owner_id = ? and name_key = ?)
             on conflict do nothing`,
          )
          .bind(id, member.id, clean.name, clean.key, member.id, now(), member.id, member.id, clean.key),
      ]);
      changes = r.meta.changes;
    } catch (e) {
      if (isUnique(e)) return { rejected: "name-taken" };
      throw e;
    }
    if (changes === 0) return (await isActive(member.id)) ? { rejected: "name-taken" } : { rejected: "not-allowed" };
    const made = await summaryOne(member.id, id);
    if (!made) throw new Error("a collection just made has vanished");
    return made;
  }

  async function renameCollection(member: Member, id: string, rawName: string): Promise<CollectionSummary | Rejection> {
    const clean = cleanCollectionName(rawName);
    if (clean === null) return { rejected: "invalid" };
    if (typeof id !== "string") return (await isActive(member.id)) ? { rejected: "not-found" } : { rejected: "not-allowed" };
    let changes: number;
    try {
      const [r] = await db.batch([
        db
          .prepare(
            `update collections set name = ?, name_key = ?
             where id = ? and owner_id = ? and ${ACTIVE}
               and not exists (select 1 from collections o where o.owner_id = ? and o.name_key = ? and o.id <> ?)`,
          )
          .bind(clean.name, clean.key, id, member.id, member.id, member.id, clean.key, id),
      ]);
      changes = r.meta.changes;
    } catch (e) {
      if (isUnique(e)) return { rejected: "name-taken" };
      throw e;
    }
    if (changes === 0) {
      // Removed actor first, then missing or not theirs, then a clash.
      if (!(await isActive(member.id))) return { rejected: "not-allowed" };
      return (await reread(id, member.id)) === null ? { rejected: "not-found" } : { rejected: "name-taken" };
    }
    const renamed = await summaryOne(member.id, id);
    if (!renamed) throw new Error("a collection just renamed has vanished");
    return renamed;
  }

  async function deleteCollection(member: Member, id: string): Promise<{ deleted: true } | Rejection> {
    if (typeof id !== "string") return (await isActive(member.id)) ? { rejected: "not-found" } : { rejected: "not-allowed" };
    const [r] = await db.batch([
      db
        .prepare(
          `delete from collections
           where id = ? and owner_id = ? and is_default = 0 and ${ACTIVE}
             and not exists (select 1 from copies where collection_id = ?)`,
        )
        .bind(id, member.id, member.id, id),
    ]);
    if (r.meta.changes === 1) return { deleted: true };
    if (!(await isActive(member.id))) return { rejected: "not-allowed" };
    return (await reread(id, member.id)) === null ? { rejected: "not-found" } : { rejected: "not-allowed" };
  }

  async function makeDefault(member: Member, id: string): Promise<CollectionSummary[] | Rejection> {
    if (typeof id !== "string") return (await isActive(member.id)) ? { rejected: "not-found" } : { rejected: "not-allowed" };
    // One batch is one transaction. The clear is guarded on the new default existing and being the actor's, so it cannot
    // leave the member with none; the set is guarded on there being none left.
    const [, , set] = await db.batch([
      pinNullCopies(db, member.id),
      db
        .prepare(
          `update collections set is_default = 0
           where owner_id = ? and is_default = 1 and id <> ? and ${ACTIVE}
             and exists (select 1 from collections where id = ? and owner_id = ?)`,
        )
        .bind(member.id, id, member.id, id, member.id),
      db
        .prepare(
          `update collections set is_default = 1
           where id = ? and owner_id = ? and ${ACTIVE}
             and not exists (select 1 from collections where owner_id = ? and is_default = 1)`,
        )
        .bind(id, member.id, member.id, member.id),
    ]);
    if (set.meta.changes === 1) return summariesOf(member.id);
    if (!(await isActive(member.id))) return { rejected: "not-allowed" };
    const now = await reread(id, member.id);
    if (now === null) return { rejected: "not-found" };
    // Already the default: nothing to change.
    return now.is_default === 1 ? summariesOf(member.id) : { rejected: "not-found" };
  }

  return { createCollection, renameCollection, deleteCollection, makeDefault };
}
