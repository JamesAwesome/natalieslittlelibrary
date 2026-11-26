import type { BookInfo, CollectionRef, CollectionSummary, Holder, Member, Person, Rejection, Shelf, ShelfItem } from "../../shared/types";

// True when copy `c` is in collection `k`. An owned copy with no collection_id (old code's rollout state) is in its
// owner's default. Written as an equality on collection_id or'd with the null case, so copies_collection_id_idx serves it.
export const inCollection = (c: string, k: string) =>
  `(${c}.collection_id = ${k}.id or (${c}.collection_id is null and ${c}.owner_id = ${k}.owner_id and ${k}.is_default = 1))`;

// The one SELECT behind shelves, holding and candidates; add a `where` and an `order by`. It never selects labels.code:
// whether a copy is labelled is the only thing a list learns about its label.
export const SHELF_SELECT = `select c.id as copy_id, b.isbn, b.title, b.authors, b.cover_url,
    c.owner_id, o.name as owner_name, o.picture_url as owner_picture, o.removed_at as owner_removed_at,
    c.holder_member_id, h.name as holder_name, h.picture_url as holder_picture, h.removed_at as holder_removed_at,
    c.holder_person_id, hp.name as holder_person_name,
    k.id as collection_id, k.name as collection_name,
    exists (select 1 from labels where copy_id = c.id) as labelled
  from copies c
  join books b on b.id = c.book_id
  left join members o on o.id = c.owner_id
  left join members h on h.id = c.holder_member_id
  left join people hp on hp.id = c.holder_person_id
  left join collections k on ${inCollection("c", "k")}`;

// A member as shown: a removed member (removed_at set) carries `removed: true`, and no other key says otherwise.
export function personOf(id: string, name: string, pictureUrl: string | null, removedAt: number | null): Person {
  return removedAt === null ? { id, name, pictureUrl } : { id, name, pictureUrl, removed: true };
}

// The columns every copy row carries for its holder, whether it came from SHELF_SELECT or the copy view's query.
export type HolderColumns = {
  holder_member_id: string | null;
  holder_name: string | null;
  holder_picture: string | null;
  holder_removed_at: number | null;
  holder_person_id: string | null;
  holder_person_name: string | null;
};

// The one holder rule: a member, else a placeholder, else nobody. Neither is shown as null, never as an empty name.
export function holderOf(r: HolderColumns): Holder | null {
  if (r.holder_member_id !== null && r.holder_name !== null) {
    return { kind: "member", person: personOf(r.holder_member_id, r.holder_name, r.holder_picture, r.holder_removed_at) };
  }
  if (r.holder_person_id !== null && r.holder_person_name !== null) {
    return { kind: "person", id: r.holder_person_id, name: r.holder_person_name };
  }
  return null;
}

export type ShelfRow = {
  copy_id: string;
  isbn: string | null;
  title: string;
  authors: string;
  cover_url: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_picture: string | null;
  owner_removed_at: number | null;
  collection_id: string | null;
  collection_name: string | null;
  labelled: number;
} & HolderColumns;

// The one serializer for shelves, holding and candidates. There is no code to leak: the row has none.
export function shelfItem(r: ShelfRow): ShelfItem {
  const book: BookInfo = { isbn: r.isbn, title: r.title, authors: JSON.parse(r.authors) as string[], coverUrl: r.cover_url };
  const collection: CollectionRef | null = r.collection_id !== null && r.collection_name !== null ? { id: r.collection_id, name: r.collection_name } : null;
  return {
    copyId: r.copy_id,
    book,
    labelled: r.labelled === 1,
    owner: r.owner_id !== null && r.owner_name !== null ? personOf(r.owner_id, r.owner_name, r.owner_picture, r.owner_removed_at) : null,
    holder: holderOf(r),
    home: r.owner_id !== null && r.owner_id === r.holder_member_id,
    collection,
  };
}

// One collator for every sort: building one per comparison costs milliseconds on a long shelf.
const COLLATOR = new Intl.Collator(undefined, { sensitivity: "base" });

const byTitle = (a: ShelfItem, b: ShelfItem) =>
  COLLATOR.compare(a.book.title, b.book.title) || (a.copyId < b.copyId ? -1 : 1);

type PersonRow = { id: string; name: string; picture_url: string | null; removed_at: number | null };
const person = (r: PersonRow): Person => personOf(r.id, r.name, r.picture_url, r.removed_at);

type SummaryRow = { id: string; name: string; is_default: number; n: number; unlabelled: number };

export function createShelfReads(db: D1Database) {
  // The owner's collections, default first, then by name; counts include lent-out and unlabelled copies. Read with the
  // member row in one batch, so the two agree. The one place the count SQL lives.
  async function collectionsOf(ownerId: string): Promise<{ owner: Person; collections: CollectionSummary[] } | Rejection> {
    if (typeof ownerId !== "string") return { rejected: "not-found" };
    const [m, ks] = await db.batch([
      db.prepare("select id, name, picture_url, removed_at from members where id = ?").bind(ownerId),
      db
        .prepare(
          `select k.id, k.name, k.is_default,
             (select count(*) from copies c where ${inCollection("c", "k")}) as n,
             (select count(*) from copies c where ${inCollection("c", "k")}
                and not exists (select 1 from labels l where l.copy_id = c.id)) as unlabelled
           from collections k where k.owner_id = ?`,
        )
        .bind(ownerId),
    ]);
    const row = m.results[0] as PersonRow | undefined;
    if (!row) return { rejected: "not-found" };
    const collections = (ks.results as SummaryRow[])
      .map((r): CollectionSummary => ({ id: r.id, name: r.name, isDefault: r.is_default === 1, count: r.n, unlabelled: r.unlabelled }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || COLLATOR.compare(a.name, b.name));
    return { owner: person(row), collections };
  }

  // The collection, its owner and its copies in one batch, so the shelf agrees with itself; its counts come from its items.
  async function shelf(collectionId: string): Promise<Shelf | Rejection> {
    if (typeof collectionId !== "string") return { rejected: "not-found" };
    const [k, items] = await db.batch([
      db
        .prepare(
          `select k.id, k.name, k.is_default, m.id as owner_id, m.name as owner_name, m.picture_url as owner_picture, m.removed_at as owner_removed_at
           from collections k join members m on m.id = k.owner_id where k.id = ?`,
        )
        .bind(collectionId),
      db.prepare(`${SHELF_SELECT} where k.id = ?`).bind(collectionId),
    ]);
    const row = k.results[0] as { id: string; name: string; is_default: number; owner_id: string; owner_name: string; owner_picture: string | null; owner_removed_at: number | null } | undefined;
    if (!row) return { rejected: "not-found" };
    const list = (items.results as ShelfRow[]).map(shelfItem).sort(byTitle);
    return {
      collection: { id: row.id, name: row.name, isDefault: row.is_default === 1, count: list.length, unlabelled: list.filter((i) => !i.labelled).length },
      owner: personOf(row.owner_id, row.owner_name, row.owner_picture, row.owner_removed_at),
      items: list,
    };
  }

  // What the member holds that someone else owns, or no one does.
  async function holding(member: Member): Promise<ShelfItem[]> {
    const { results } = await db
      .prepare(`${SHELF_SELECT} where c.holder_member_id = ? and (c.owner_id is null or c.owner_id <> ?)`)
      .bind(member.id, member.id)
      .all<ShelfRow>();
    return results.map(shelfItem).sort(byTitle);
  }

  return { collectionsOf, shelf, holding };
}
