import { cleanCollectionName } from "../../shared/collectionName";
import type { CollectionSummary, Member, Rejection } from "../../shared/types";

// The active-actor guard; bind the actor's id once.
export const ACTIVE = "exists (select 1 from members where id = ? and removed_at is null)";
// The owner's default collection's id; bind the owner's id once.
export const DEFAULT_OF = "(select id from collections where owner_id = ? and is_default = 1)";

export const DEFAULT_NAME = "Home library";

// Gives an active member a default collection if they have none. Run it first in any batch that gives them a copy, then
// select the persisted default; never use an id this call proposed. It works for a member who owns copies with a null
// collection_id and no collection row at all (what old code leaves).
export function ensureDefault(db: D1Database, ownerId: string, at: number): D1PreparedStatement {
  return db
    .prepare(
      `insert into collections (id, owner_id, name, name_key, is_default, created_at)
       select ?, ?, ?, ?, 1, ? where ${ACTIVE} and not exists (select 1 from collections where owner_id = ? and is_default = 1)
       on conflict do nothing`,
    )
    .bind(crypto.randomUUID(), ownerId, DEFAULT_NAME, DEFAULT_NAME.toLowerCase(), at, ownerId, ownerId);
}

type SummaryRow = { id: string; name: string; is_default: number; n: number; unlabelled: number };

// The member's collections, default first, then by name; counts include lent-out and unlabelled copies.
async function summariesOf(db: D1Database, ownerId: string): Promise<CollectionSummary[]> {
  const { results } = await db
    .prepare(
      `select k.id, k.name, k.is_default,
         (select count(*) from copies c where c.collection_id = k.id) as n,
         (select count(*) from copies c where c.collection_id = k.id
            and not exists (select 1 from labels l where l.copy_id = c.id)) as unlabelled
       from collections k where k.owner_id = ?`,
    )
    .bind(ownerId)
    .all<SummaryRow>();
  return results
    .map((r): CollectionSummary => ({ id: r.id, name: r.name, isDefault: r.is_default === 1, count: r.n, unlabelled: r.unlabelled }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

// Every write goes through db.batch, even a single statement, so the tests' gated and racing databases can interleave it.
export function createCollectionWrites(db: D1Database, now: () => number) {
  async function isActive(id: string): Promise<boolean> {
    return (await db.prepare("select 1 as ok from members where id = ? and removed_at is null").bind(id).first()) !== null;
  }

  async function summaryOne(ownerId: string, id: string): Promise<CollectionSummary | null> {
    return (await summariesOf(db, ownerId)).find((c) => c.id === id) ?? null;
  }

  // The collection and whether the owner has another one under the same key.
  async function reread(id: string, ownerId: string, key: string | null) {
    const row = await db
      .prepare(
        `select k.owner_id, k.is_default, k.name_key,
           exists (select 1 from collections o where o.owner_id = k.owner_id and o.id <> k.id and o.name_key = ?) as clash
         from collections k where k.id = ?`,
      )
      .bind(key, id)
      .first<{ owner_id: string; is_default: number; name_key: string; clash: number }>();
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
      return (await reread(id, member.id, clean.key)) === null ? { rejected: "not-found" } : { rejected: "name-taken" };
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
    return (await reread(id, member.id, null)) === null ? { rejected: "not-found" } : { rejected: "not-allowed" };
  }

  async function makeDefault(member: Member, id: string): Promise<CollectionSummary[] | Rejection> {
    if (typeof id !== "string") return (await isActive(member.id)) ? { rejected: "not-found" } : { rejected: "not-allowed" };
    // One batch is one transaction. The clear is guarded on the new default existing and being the actor's, so it cannot
    // leave the member with none; the set is guarded on there being none left.
    const [, set] = await db.batch([
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
    if (set.meta.changes === 1) return summariesOf(db, member.id);
    if (!(await isActive(member.id))) return { rejected: "not-allowed" };
    const now = await reread(id, member.id, null);
    if (now === null) return { rejected: "not-found" };
    // Already the default: nothing to change.
    return now.is_default === 1 ? summariesOf(db, member.id) : { rejected: "not-found" };
  }

  return { createCollection, renameCollection, deleteCollection, makeDefault };
}
