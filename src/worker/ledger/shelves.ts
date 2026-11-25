import type { BookInfo, CollectionRef, CollectionSummary, Member, Person, Rejection, Shelf, ShelfItem } from "../../shared/types";

// The collection a copy is in. An owned copy with no collection_id (old code's rollout state) is in its owner's default.
// `copy` is the alias of a table (or subquery) with owner_id and collection_id.
export const effectiveCollection = (copy: string) =>
  `coalesce(${copy}.collection_id, (select d.id from collections d where d.owner_id = ${copy}.owner_id and d.is_default = 1))`;

// The one SELECT behind shelves, holding and candidates; add a `where` and an `order by`. It never selects labels.code:
// whether a copy is labelled is the only thing a list learns about its label.
export const SHELF_SELECT = `select c.id as copy_id, b.isbn, b.title, b.authors, b.cover_url,
    c.owner_id, o.name as owner_name, o.picture_url as owner_picture,
    c.holder_member_id, h.name as holder_name, h.picture_url as holder_picture,
    k.id as collection_id, k.name as collection_name,
    exists (select 1 from labels where copy_id = c.id) as labelled
  from copies c
  join books b on b.id = c.book_id
  left join members o on o.id = c.owner_id
  left join members h on h.id = c.holder_member_id
  left join collections k on k.id = ${effectiveCollection("c")}`;

export type ShelfRow = {
  copy_id: string;
  isbn: string | null;
  title: string;
  authors: string;
  cover_url: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_picture: string | null;
  holder_member_id: string | null;
  holder_name: string | null;
  holder_picture: string | null;
  collection_id: string | null;
  collection_name: string | null;
  labelled: number;
};

// The one serializer for shelves, holding and candidates. There is no code to leak: the row has none.
export function shelfItem(r: ShelfRow): ShelfItem {
  const book: BookInfo = { isbn: r.isbn, title: r.title, authors: JSON.parse(r.authors) as string[], coverUrl: r.cover_url };
  const collection: CollectionRef | null = r.collection_id !== null && r.collection_name !== null ? { id: r.collection_id, name: r.collection_name } : null;
  return {
    copyId: r.copy_id,
    book,
    labelled: r.labelled === 1,
    owner: r.owner_id !== null && r.owner_name !== null ? { id: r.owner_id, name: r.owner_name, pictureUrl: r.owner_picture } : null,
    // A copy with no holder row has no member to show; the name is empty rather than invented.
    holder:
      r.holder_member_id !== null && r.holder_name !== null
        ? { kind: "member", person: { id: r.holder_member_id, name: r.holder_name, pictureUrl: r.holder_picture } }
        : { kind: "named", name: "" },
    home: r.owner_id !== null && r.owner_id === r.holder_member_id,
    collection,
  };
}

const byTitle = (a: ShelfItem, b: ShelfItem) =>
  a.book.title.localeCompare(b.book.title, undefined, { sensitivity: "base" }) || (a.copyId < b.copyId ? -1 : 1);

type PersonRow = { id: string; name: string; picture_url: string | null };
const person = (r: PersonRow): Person => ({ id: r.id, name: r.name, pictureUrl: r.picture_url });

type SummaryRow = { id: string; name: string; is_default: number; n: number; unlabelled: number };

export function createShelfReads(db: D1Database) {
  // The owner's collections, default first, then by name; counts include lent-out and unlabelled copies. Read with the
  // member row in one batch, so the two agree. The one place the count SQL lives.
  async function collectionsOf(ownerId: string): Promise<{ owner: Person; collections: CollectionSummary[] } | Rejection> {
    if (typeof ownerId !== "string") return { rejected: "not-found" };
    const [m, ks] = await db.batch([
      db.prepare("select id, name, picture_url from members where id = ?").bind(ownerId),
      db
        .prepare(
          `select k.id, k.name, k.is_default,
             (select count(*) from copies c where ${effectiveCollection("c")} = k.id) as n,
             (select count(*) from copies c where ${effectiveCollection("c")} = k.id
                and not exists (select 1 from labels l where l.copy_id = c.id)) as unlabelled
           from collections k where k.owner_id = ?`,
        )
        .bind(ownerId),
    ]);
    const row = m.results[0] as PersonRow | undefined;
    if (!row) return { rejected: "not-found" };
    const collections = (ks.results as SummaryRow[])
      .map((r): CollectionSummary => ({ id: r.id, name: r.name, isDefault: r.is_default === 1, count: r.n, unlabelled: r.unlabelled }))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return { owner: person(row), collections };
  }

  // The collection, its owner and its copies in one batch, so the shelf agrees with itself; its counts come from its items.
  async function shelf(collectionId: string): Promise<Shelf | Rejection> {
    if (typeof collectionId !== "string") return { rejected: "not-found" };
    const [k, items] = await db.batch([
      db
        .prepare(
          `select k.id, k.name, k.is_default, m.id as owner_id, m.name as owner_name, m.picture_url as owner_picture
           from collections k join members m on m.id = k.owner_id where k.id = ?`,
        )
        .bind(collectionId),
      db.prepare(`${SHELF_SELECT} where k.id = ?`).bind(collectionId),
    ]);
    const row = k.results[0] as { id: string; name: string; is_default: number; owner_id: string; owner_name: string; owner_picture: string | null } | undefined;
    if (!row) return { rejected: "not-found" };
    const list = (items.results as ShelfRow[]).map(shelfItem).sort(byTitle);
    return {
      collection: { id: row.id, name: row.name, isDefault: row.is_default === 1, count: list.length, unlabelled: list.filter((i) => !i.labelled).length },
      owner: { id: row.owner_id, name: row.owner_name, pictureUrl: row.owner_picture },
      items: list,
    };
  }

  // What the member holds that someone else owns.
  async function holding(member: Member): Promise<ShelfItem[]> {
    const { results } = await db
      .prepare(`${SHELF_SELECT} where c.holder_member_id = ? and c.owner_id is not null and c.owner_id <> ?`)
      .bind(member.id, member.id)
      .all<ShelfRow>();
    return results.map(shelfItem).sort(byTitle);
  }

  return { collectionsOf, shelf, holding };
}
