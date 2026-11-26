import { cleanPersonName } from "../../shared/name";
import type { BookInfo, Member, Person, PersonSummary, Rejection, RequestItem, ShelfItem } from "../../shared/types";
import { ACTIVE } from "./collections";
import { personOf, SHELF_SELECT, shelfItem, type ShelfRow } from "./shelves";

type PersonRow = {
  id: string;
  name: string;
  linked_member_id: string | null;
  linked_name: string | null;
  linked_picture: string | null;
  linked_removed_at: number | null;
};

const PERSON_SELECT = `select p.id, p.name, p.linked_member_id, m.name as linked_name, m.picture_url as linked_picture,
    m.removed_at as linked_removed_at
  from people p left join members m on m.id = p.linked_member_id`;

export function createPeople(db: D1Database, now: () => number) {
  const byTitle = (a: ShelfItem, b: ShelfItem) => a.book.title.localeCompare(b.book.title) || a.copyId.localeCompare(b.copyId);

  // The member's own placeholders by name, each with every copy it holds, owned by anyone or no one.
  async function people(member: Member): Promise<PersonSummary[]> {
    const [persons, held] = await db.batch([
      db.prepare(`${PERSON_SELECT} where p.created_by = ? order by p.name_key, p.id`).bind(member.id),
      db.prepare(`${SHELF_SELECT} join people p on p.id = c.holder_person_id where p.created_by = ?`).bind(member.id),
    ]);
    const byPerson = new Map<string, ShelfItem[]>();
    for (const row of held.results as ShelfRow[]) {
      const list = byPerson.get(row.holder_person_id!) ?? [];
      list.push(shelfItem(row));
      byPerson.set(row.holder_person_id!, list);
    }
    return (persons.results as PersonRow[]).map((p) => {
      const linked: Person | null =
        p.linked_member_id !== null && p.linked_name !== null
          ? personOf(p.linked_member_id, p.linked_name, p.linked_picture, p.linked_removed_at)
          : null;
      return { id: p.id, name: p.name, linked, holding: (byPerson.get(p.id) ?? []).sort(byTitle) };
    });
  }

  async function summary(member: Member, personId: string): Promise<PersonSummary | Rejection> {
    const found = (await people(member)).find((p) => p.id === personId);
    return found ?? { rejected: "not-found" };
  }

  async function renamePerson(member: Member, personId: string, name: string): Promise<PersonSummary | Rejection> {
    const cleaned = cleanPersonName(name);
    if (cleaned === null) return { rejected: "invalid" };
    const own = await db.prepare("select id from people where id = ? and created_by = ?").bind(personId, member.id).first();
    if (!own) return { rejected: "not-found" };
    const [result] = await db.batch([
      db
        .prepare(
          `update people set name = ?, name_key = ? where id = ? and created_by = ?
             and not exists (select 1 from people where created_by = ? and name_key = ? and id <> ?) and ${ACTIVE}`,
        )
        .bind(cleaned.name, cleaned.key, personId, member.id, member.id, cleaned.key, personId, member.id),
    ]);
    if (result.meta.changes === 0) {
      // Nothing written: the actor was removed since the read, or the name is taken.
      const active = await db.prepare("select 1 as ok from members where id = ? and removed_at is null").bind(member.id).first();
      return active === null ? { rejected: "not-allowed" } : { rejected: "name-taken" };
    }
    return summary(member, personId);
  }

  // Moves every copy the placeholder holds to the member, then marks the placeholder linked; both statements carry the
  // same guard, so a refused link changes nothing. No event: history renders the member through the link.
  async function linkPerson(member: Member, personId: string, memberId: string): Promise<PersonSummary | Rejection> {
    if (typeof memberId !== "string") return { rejected: "invalid" };
    const exists = await db.prepare("select id from people where id = ?").bind(personId).first();
    if (!exists) return { rejected: "not-found" };
    if (memberId === member.id) return { rejected: "not-allowed" };
    const guard = `exists (select 1 from people where id = ? and created_by = ? and linked_member_id is null)
      and ${ACTIVE} and ${ACTIVE} and ? <> ?`;
    // The target member must be active, and so must the actor.
    const guardBinds = [personId, member.id, memberId, member.id, memberId, member.id];
    const [, linked] = await db.batch([
      db
        .prepare(
          `update copies set holder_member_id = ?, holder_person_id = null, requested_by = null, requested_at = null
             where holder_person_id = ? and ${guard}`,
        )
        .bind(memberId, personId, ...guardBinds),
      db
        .prepare(`update people set linked_member_id = ?, linked_at = ? where id = ? and ${guard}`)
        .bind(memberId, now(), personId, ...guardBinds),
    ]);
    if (linked.meta.changes === 0) return { rejected: "not-allowed" };
    return summary(member, personId);
  }

  // Open requests on copies the member owns, newest first. A removed asker's request counts as none.
  async function requests(member: Member): Promise<RequestItem[]> {
    const { results } = await db
      .prepare(
        `select c.id as copy_id, c.requested_at, b.isbn, b.title, b.authors, b.cover_url,
           a.id as asker_id, a.name as asker_name, a.picture_url as asker_picture
         from copies c
         join books b on b.id = c.book_id
         join members a on a.id = c.requested_by and a.removed_at is null
         where c.owner_id = ? and c.requested_by is not null
         order by c.requested_at desc, c.id`,
      )
      .bind(member.id)
      .all<{ copy_id: string; requested_at: number; isbn: string | null; title: string; authors: string; cover_url: string | null; asker_id: string; asker_name: string; asker_picture: string | null }>();
    return results.map((r) => {
      const book: BookInfo = { isbn: r.isbn, title: r.title, authors: JSON.parse(r.authors) as string[], coverUrl: r.cover_url };
      return { copyId: r.copy_id, book, by: personOf(r.asker_id, r.asker_name, r.asker_picture, null), at: r.requested_at };
    });
  }

  return { people, renamePerson, linkPerson, requests };
}
