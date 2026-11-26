import { cleanBookFacts } from "../../shared/bookFacts";
import { toIsbn13 } from "../../shared/isbn";
import { parseLabelLink } from "../../shared/labelCode";
import type { BookInfo, Candidates, CopyView, ImportResult, ImportRow, Member, Rejection, ShelfItem } from "../../shared/types";
import { MAX_BATCH } from "../booklookup";
import { ACTIVE, DEFAULT_OF, ensureDefault } from "./collections";
import { CLEAR_REMOVED_ASKER, stateColumns, stateOf, type StateColumns } from "./copyState";
import { decide } from "./rules";
import { SHELF_SELECT, shelfItem, type ShelfRow } from "./shelves";

export const MAX_TITLE = 300;
export const MAX_AUTHORS = 10;
export const MAX_AUTHOR = 200;
const MAX_SIMILAR = 10;

// The label with this code exists and is not bound; bind the code once.
export const BLANK = "(select 1 from labels where code = ? and copy_id is null)";

export function cleanText(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  const length = Array.from(t).length;
  return length >= 1 && length <= max ? t : null;
}

// "Is it this one?" compares titles loosely: case, punctuation and anything after a colon do not matter.
function titleKey(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .split(":")[0]
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// The one answer to "the oldest unlabelled copy the owner has for this ISBN": a copy whose book has the ISBN, or whose
// import_isbn is it. Both `candidates` and `add`'s bind use this, so they always agree about which copy a scan means.
export async function oldestUnlabelledFor(db: D1Database, ownerId: string, isbn: string): Promise<ShelfItem | null> {
  const r = await db
    .prepare(
      `${SHELF_SELECT}
       where c.owner_id = ? and not exists (select 1 from labels where copy_id = c.id) and (b.isbn = ? or c.import_isbn = ?)
       order by c.created_at, c.id limit 1`,
    )
    .bind(ownerId, isbn, isbn)
    .first<ShelfRow>();
  return r === null ? null : shelfItem(r);
}

type Enrich = { isbn: string; facts: NonNullable<ReturnType<typeof cleanBookFacts>> };

type CleanRow = { title: string; authors: string[]; isbn: string | null };

// A re-import skips copies the importer has, and those they had and gave up (gave away, let someone keep, or released),
// so a book given away does not come back. Each is its own `from … where` (copy `c`, book `b`; bind the importer's id
// once) so each keeps its index: copies by owner, events by actor and type. An `or` of the two would scan every copy.
const OWNS = "copies c join books b on b.id = c.book_id where c.owner_id = ?";
const GAVE_UP = `events e join copies c on c.id = e.copy_id join books b on b.id = c.book_id
  where e.actor_id = ? and e.type in ('given', 'approved', 'released')`;

function cleanRows(rows: unknown): CleanRow[] | null {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_BATCH) return null;
  const out: CleanRow[] = [];
  for (const r of rows as unknown[]) {
    if (typeof r !== "object" || r === null) return null;
    const { title, authors, isbn } = r as Record<string, unknown>;
    const t = cleanText(title, MAX_TITLE);
    if (t === null || !Array.isArray(authors) || authors.length > MAX_AUTHORS) return null;
    const a = authors.map((x) => cleanText(x, MAX_AUTHOR));
    if (a.some((x) => x === null)) return null;
    let n: string | null = null;
    if (isbn !== null) {
      n = typeof isbn === "string" ? toIsbn13(isbn) : null;
      if (n === null) return null;
    }
    out.push({ title: t, authors: a as string[], isbn: n });
  }
  return out;
}

export function createUnlabelled(
  db: D1Database,
  now: () => number,
  lookup: (isbn: string) => Promise<BookInfo | null>,
  lookupMany: (isbns: string[]) => Promise<Map<string, BookInfo>>,
  // The copy as the owner sees it with the request's own label in hand.
  render: (copyId: string, viewer: Member, code: string) => Promise<CopyView | null>,
) {
  async function isActive(id: string): Promise<boolean> {
    return (await db.prepare("select 1 as ok from members where id = ? and removed_at is null").bind(id).first()) !== null;
  }

  async function collectionIsTheirs(id: string, ownerId: string): Promise<boolean> {
    const k = await db.prepare("select owner_id from collections where id = ?").bind(id).first<{ owner_id: string }>();
    return k !== null && k.owner_id === ownerId;
  }

  async function importCopies(owner: Member, input: { collectionId: string | null; rows: ImportRow[] }): Promise<ImportResult | Rejection> {
    if (typeof input !== "object" || input === null) return { rejected: "invalid" };
    const rows = cleanRows(input.rows);
    const collectionId = input.collectionId ?? null;
    if (rows === null || (collectionId !== null && typeof collectionId !== "string")) return { rejected: "invalid" };
    if (collectionId !== null && !(await collectionIsTheirs(collectionId, owner.id))) return { rejected: "not-found" };

    // One read for which ISBNs already have a books row; the rest go to the lookup in one request.
    const isbns = [...new Set(rows.flatMap((r) => (r.isbn === null ? [] : [r.isbn])))];
    const have = new Set<string>();
    if (isbns.length > 0) {
      const { results } = await db
        .prepare(`select isbn from books where isbn in (${isbns.map(() => "?").join(", ")})`)
        .bind(...isbns)
        .all<{ isbn: string }>();
      for (const r of results) have.add(r.isbn);
    }
    // ISBNs the importer already holds or gave up (by the book's ISBN or by import_isbn) are skipped by the write, so they
    // are not asked about.
    const held = new Set<string>();
    if (isbns.length > 0) {
      const wanted = "(select isbn from wanted)";
      const match = `(b.isbn in ${wanted} or c.import_isbn in ${wanted})`;
      const { results } = await db
        .prepare(
          `with wanted(isbn) as (values ${isbns.map(() => "(?)").join(", ")})
           select b.isbn as book_isbn, c.import_isbn from ${OWNS} and ${match}
           union all
           select b.isbn as book_isbn, c.import_isbn from ${GAVE_UP} and ${match}`,
        )
        .bind(...isbns, owner.id, owner.id)
        .all<{ book_isbn: string | null; import_isbn: string | null }>();
      for (const r of results) {
        if (r.book_isbn !== null) held.add(r.book_isbn);
        if (r.import_isbn !== null) held.add(r.import_isbn);
      }
    }
    const unknown = isbns.filter((i) => !have.has(i) && !held.has(i));
    let looked = new Map<string, BookInfo>();
    if (unknown.length > 0) {
      try {
        looked = await lookupMany(unknown);
      } catch {
        // A source that failed is not a miss: nothing is written, so the client retries the chunk.
        return { rejected: "unavailable" };
      }
    }

    const at = now();
    const dest =
      collectionId === null
        ? { sql: `exists ${DEFAULT_OF}`, binds: [owner.id], column: DEFAULT_OF }
        : { sql: "exists (select 1 from collections where id = ? and owner_id = ?)", binds: [collectionId, owner.id], column: "?" };

    // Statements for a chunk of n rows: n * 3 (book, copy, event), plus the two of ensureDefault when there is no chosen
    // collection; at most 3 * 20 + 2 = 62, and a D1 batch is one query toward the 50 per invocation. Bound parameters:
    // a book insert takes at most 6 + 1 + 2 + 10 = 19, a copy insert 7 + 1 + 2 + 10 + 1 = 21 (a named destination adds one
    // more to each), an event 4; the widest is 22, well under 100.
    const statements: D1PreparedStatement[] = [];
    if (collectionId === null) statements.push(...ensureDefault(db, owner.id, at));
    const copyAt: number[] = [];
    for (const row of rows) {
      const authorsJson = JSON.stringify(row.authors);
      // Skip a row the importer already has or gave up: by ISBN where the row has one, and by exact title and authors on a
      // book with no ISBN (one paired earlier by typing); by exact title and authors alone where the row has no ISBN.
      const match =
        row.isbn !== null
          ? { sql: "(b.isbn = ? or c.import_isbn = ? or (b.isbn is null and b.title = ? and b.authors = ?))", binds: [row.isbn, row.isbn, row.title, authorsJson] }
          : { sql: "b.title = ? and b.authors = ?", binds: [row.title, authorsJson] };
      const owned = {
        sql: `not exists (select 1 from ${OWNS} and ${match.sql}) and not exists (select 1 from ${GAVE_UP} and ${match.sql})`,
        binds: [owner.id, ...match.binds, owner.id, ...match.binds],
      };
      const guard = `${ACTIVE} and ${dest.sql} and ${owned.sql}`;
      const guardBinds = [owner.id, ...dest.binds, ...owned.binds];

      // Facts for an ISBN come only from the books table or the lookup, cleaned again here (a second writer re-checks the
      // cover rule). A miss keeps the person's title on a book with no ISBN, and the ISBN on the copy alone.
      let isbnBook = row.isbn !== null && have.has(row.isbn);
      const facts = row.isbn !== null && !isbnBook ? cleanBookFacts(looked.get(row.isbn)) : null;
      const bookId = crypto.randomUUID();
      if (row.isbn !== null && facts) {
        isbnBook = true;
        statements.push(
          db
            .prepare(
              `insert into books (id, isbn, title, authors, cover_url, created_at)
               select ?, ?, ?, ?, ?, ? where ${guard}
               on conflict(isbn) do nothing`,
            )
            .bind(bookId, row.isbn, facts.title, JSON.stringify(facts.authors), facts.coverUrl, at, ...guardBinds),
        );
      } else if (!isbnBook) {
        statements.push(
          db
            .prepare(
              `insert into books (id, isbn, title, authors, cover_url, created_at)
               select ?, null, ?, ?, null, ? where ${guard}`,
            )
            .bind(bookId, row.title, authorsJson, at, ...guardBinds),
        );
      }
      const copyId = crypto.randomUUID();
      const book = isbnBook
        ? { ref: "(select id from books where isbn = ?)", exists: "isbn = ?", bind: row.isbn }
        : { ref: "?", exists: "id = ?", bind: bookId };
      copyAt.push(statements.length);
      statements.push(
        db
          .prepare(
            `insert into copies (id, book_id, owner_id, holder_member_id, collection_id, created_at, import_isbn)
             select ?, ${book.ref}, ?, ?, ${dest.column}, ?, ?
             where ${guard} and exists (select 1 from books where ${book.exists})`,
          )
          .bind(copyId, book.bind, owner.id, owner.id, collectionId === null ? owner.id : collectionId, at, row.isbn, ...guardBinds, book.bind),
      );
      statements.push(
        db
          .prepare("insert into events (copy_id, at, actor_id, type) select ?, ?, ?, 'added' where exists (select 1 from copies where id = ?)")
          .bind(copyId, at, owner.id, copyId),
      );
    }

    const results = await db.batch(statements);
    const added = copyAt.reduce((n, i) => n + results[i].meta.changes, 0);
    if (added === 0) {
      if (!(await isActive(owner.id))) return { rejected: "not-allowed" };
      if (collectionId !== null && !(await collectionIsTheirs(collectionId, owner.id))) return { rejected: "not-found" };
    }
    return { added, skipped: rows.length - added };
  }

  // Binds the label to the owner's copy. Both statements carry the whole state the decision was made against: the label
  // still blank, the copy the actor's, the actor active and the copy still without a label, so two labels racing for one
  // copy cannot both bind. null means it bound; otherwise the one rule says why not.
  async function bind(owner: Member, copyId: string, code: string, enrich: Enrich | null = null): Promise<Rejection | null> {
    const guard = `exists (select 1 from copies where id = ? and owner_id = ?) and ${ACTIVE} and not exists (select 1 from labels where copy_id = ?)`;
    const guardBinds = [copyId, owner.id, owner.id, copyId];
    const at = now();
    const statements = [
      db
        .prepare(`insert into events (copy_id, at, actor_id, type) select ?, ?, ?, 'labelled' where exists ${BLANK} and ${guard}`)
        .bind(copyId, at, owner.id, code, ...guardBinds),
      db
        .prepare(`update labels set copy_id = ?, bound_at = ? where code = ? and copy_id is null and ${guard}`)
        .bind(copyId, at, code, ...guardBinds),
    ];
    let labelAt = 1; // the label update's place in the batch; its change count says whether everything bound
    // A removed asker's request goes with the label, once the label is bound to the copy.
    statements.push(
      db
        .prepare(`update copies set ${CLEAR_REMOVED_ASKER} where id = ? and exists (select 1 from labels where code = ? and copy_id = ?)`)
        .bind(copyId, code, copyId),
    );
    if (enrich) {
      // The copy's title-only book is swapped for the ISBN's book in the same batch, only once the label is bound to it.
      const old = await db.prepare("select book_id from copies where id = ?").bind(copyId).first<{ book_id: string }>();
      if (old) {
        labelAt = 2;
        statements.unshift(
          db
            .prepare(
              `insert into books (id, isbn, title, authors, cover_url, created_at)
               select ?, ?, ?, ?, ?, ? where exists ${BLANK} and ${guard}
               on conflict(isbn) do nothing`,
            )
            .bind(crypto.randomUUID(), enrich.isbn, enrich.facts.title, JSON.stringify(enrich.facts.authors), enrich.facts.coverUrl, at, code, ...guardBinds),
        );
        statements.push(
          db
            .prepare(
              `update copies set book_id = (select id from books where isbn = ?)
               where id = ? and book_id = ? and exists (select 1 from books where isbn = ?)
                 and exists (select 1 from labels where code = ? and copy_id = ?)`,
            )
            .bind(enrich.isbn, copyId, old.book_id, enrich.isbn, code, copyId),
          db
            .prepare("delete from books where id = ? and isbn is null and not exists (select 1 from copies where book_id = ?)")
            .bind(old.book_id, old.book_id),
        );
      }
    }
    const results = await db.batch(statements);
    if (results[labelAt].meta.changes === 1) return null;
    const label = await db.prepare("select copy_id from labels where code = ?").bind(code).first<{ copy_id: string | null }>();
    return label?.copy_id != null ? { rejected: "label-in-use" } : { rejected: "not-allowed" };
  }

  // A copy imported without facts (its book has no ISBN, the copy has an import_isbn) gets them when the lookup can find
  // the book; a miss or a failed lookup leaves it title-only. The one place labelling and scanning both ask.
  async function enrichment(bookIsbn: string | null, importIsbn: string | null): Promise<Enrich | null> {
    if (bookIsbn !== null || importIsbn === null) return null;
    try {
      const facts = cleanBookFacts(await lookup(importIsbn));
      return facts ? { isbn: importIsbn, facts } : null;
    } catch {
      return null;
    }
  }

  async function bound(owner: Member, copyId: string, code: string): Promise<CopyView> {
    const v = await render(copyId, owner, code);
    if (v === null) throw new Error("a copy just labelled has vanished");
    return v;
  }

  async function labelCopy(owner: Member, copyId: string, rawCode: string): Promise<CopyView | Rejection> {
    if (typeof copyId !== "string" || typeof rawCode !== "string") return { rejected: "invalid" };
    const code = parseLabelLink(rawCode);
    if (code === null) return { rejected: "label-unknown" };
    const label = await db.prepare("select copy_id from labels where code = ?").bind(code).first<{ copy_id: string | null }>();
    if (!label) return { rejected: "label-unknown" };
    if (label.copy_id !== null) return { rejected: "label-in-use" };
    const copy = await db
      .prepare(
        `select ${stateColumns("copies")}, import_isbn, (select isbn from books where id = copies.book_id) as book_isbn,
           exists (select 1 from labels where copy_id = copies.id) as labelled from copies where id = ?`,
      )
      .bind(copyId)
      .first<StateColumns & { import_isbn: string | null; book_isbn: string | null; labelled: number }>();
    if (!copy) return { rejected: "not-found" };
    const decision = decide(stateOf(copy, copy.labelled === 1), owner, { type: "label" });
    if ("rejected" in decision) return decision;
    const refused = await bind(owner, copyId, code, await enrichment(copy.book_isbn, copy.import_isbn));
    return refused ?? (await bound(owner, copyId, code));
  }

  // `add`'s first step: if the adder has an unlabelled copy for this ISBN, the label goes on it. null when there is none.
  async function bindToUnlabelled(owner: Member, code: string, isbn: string): Promise<CopyView | Rejection | null> {
    const copy = await oldestUnlabelledFor(db, owner.id, isbn);
    if (copy === null) return null;
    const enrich = await enrichment(copy.book.isbn, isbn);
    const refused = await bind(owner, copy.copyId, code, enrich);
    return refused ?? (await bound(owner, copy.copyId, code));
  }

  async function candidates(owner: Member, query: { isbn?: string; title?: string }): Promise<Candidates | Rejection> {
    if (typeof query !== "object" || query === null) return { rejected: "invalid" };
    const { isbn: rawIsbn, title: rawTitle } = query;
    if (rawIsbn === undefined && rawTitle === undefined) return { rejected: "invalid" };
    let isbn: string | null = null;
    if (rawIsbn !== undefined) {
      isbn = typeof rawIsbn === "string" ? toIsbn13(rawIsbn) : null;
      if (isbn === null) return { rejected: "invalid" };
    }
    let key: string | null = null;
    if (rawTitle !== undefined) {
      const title = cleanText(rawTitle, MAX_TITLE);
      if (title === null) return { rejected: "invalid" };
      key = titleKey(title);
    }
    const sameIsbn = isbn === null ? null : await oldestUnlabelledFor(db, owner.id, isbn);
    let similar: ShelfItem[] = [];
    if (key !== null && key !== "") {
      // Titles only, to match on; the rows themselves are read for the few that match.
      const { results } = await db
        .prepare(
          `select c.id, b.title from copies c join books b on b.id = c.book_id
           where c.owner_id = ? and not exists (select 1 from labels where copy_id = c.id)
           order by c.created_at, c.id`,
        )
        .bind(owner.id)
        .all<{ id: string; title: string }>();
      const ids = results.filter((r) => r.id !== sameIsbn?.copyId && titleKey(r.title) === key).slice(0, MAX_SIMILAR).map((r) => r.id);
      if (ids.length > 0) {
        const { results: rows } = await db
          .prepare(`${SHELF_SELECT} where c.id in (${ids.map(() => "?").join(", ")})`)
          .bind(...ids)
          .all<ShelfRow>();
        const byId = new Map(rows.map((r) => [r.copy_id, shelfItem(r)]));
        similar = ids.flatMap((id) => byId.get(id) ?? []);
      }
    }
    return { sameIsbn, similar };
  }

  return { importCopies, labelCopy, candidates, bindToUnlabelled };
}
