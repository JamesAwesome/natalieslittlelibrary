import { LABEL_ALPHABET, LABEL_LENGTH, parseLabelLink } from "../../shared/labelCode";
import { toIsbn13 } from "../../shared/isbn";
import type { BookInfo, CopyView, HistoryEntry, LabelView, Member, Person, Rejection } from "../../shared/types";
import { availableActions } from "./rules";

export type AddInput = { code: string; book: { isbn: string } | { title: string; authors: string[] } };

export interface Ledger {
  mintLabels(member: Member, count: number): Promise<{ code: string; url: string }[] | Rejection>;
  add(owner: Member, input: AddInput): Promise<CopyView | Rejection>;
  view(code: string, viewer: Member | null): Promise<LabelView>;
}

export type LedgerDeps = {
  db: D1Database;
  siteUrl: string;
  lookup: (isbn: string) => Promise<BookInfo | null>;
  now?: () => number;
  randomBytes?: (n: number) => Uint8Array;
};

const MAX_MINT = 100;
const MAX_MINT_ROUNDS = 10;
const MAX_TITLE = 300;
const MAX_AUTHORS = 10;
const MAX_AUTHOR = 200;
// The largest multiple of the alphabet size that fits in a byte; bytes at or above it would bias the draw.
const BYTE_LIMIT = 248;

const BLANK = "(select 1 from labels where code = ? and copy_id is null)";

type CopyRow = {
  copy_id: string | null;
  isbn: string | null;
  title: string | null;
  authors: string | null;
  cover_url: string | null;
  owner_id: string | null;
  holder_member_id: string | null;
};
type PersonRow = { id: string; name: string; picture_url: string | null };

function person(r: PersonRow): Person {
  return { id: r.id, name: r.name, pictureUrl: r.picture_url };
}

function cleanText(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

export function createLedger(deps: LedgerDeps): Ledger {
  const { db, lookup } = deps;
  const now = deps.now ?? Date.now;
  const randomBytes = deps.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));

  function newCode(): string {
    let code = "";
    while (code.length < LABEL_LENGTH) {
      for (const b of randomBytes(16)) {
        if (b >= BYTE_LIMIT) continue;
        code += LABEL_ALPHABET[b % LABEL_ALPHABET.length];
        if (code.length === LABEL_LENGTH) break;
      }
    }
    return code;
  }

  async function mintLabels(member: Member, count: number) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_MINT) return { rejected: "invalid" } as const;
    const minted: string[] = [];
    let needed = count;
    for (let round = 0; needed > 0; round++) {
      if (round === MAX_MINT_ROUNDS) throw new Error("could not mint distinct label codes");
      const codes = Array.from({ length: needed }, newCode);
      const results = await db.batch(
        codes.map((code) =>
          db
            .prepare("insert into labels (code, minted_by, minted_at) values (?, ?, ?) on conflict(code) do nothing")
            .bind(code, member.id, now()),
        ),
      );
      codes.forEach((code, i) => {
        if (results[i].meta.changes === 1) minted.push(code);
      });
      needed = count - minted.length;
    }
    return minted.map((code) => ({ code, url: new URL("/b/" + code, deps.siteUrl).toString() }));
  }

  async function view(rawCode: string, viewer: Member | null): Promise<LabelView> {
    const code = parseLabelLink(rawCode);
    if (code === null) return { kind: "unknown" };
    const row = await db
      .prepare(
        `select c.id as copy_id, b.isbn, b.title, b.authors, b.cover_url, c.owner_id, c.holder_member_id
         from labels l
         left join copies c on c.id = l.copy_id
         left join books b on b.id = c.book_id
         where l.code = ?`,
      )
      .bind(code)
      .first<CopyRow>();
    if (!row) return { kind: "unknown" };
    if (row.copy_id === null) return { kind: "blank", code };

    const book: BookInfo = {
      isbn: row.isbn,
      title: row.title!,
      authors: JSON.parse(row.authors!) as string[],
      coverUrl: row.cover_url,
    };
    if (viewer === null) {
      return { kind: "public", code, book: { title: book.title, authors: book.authors, coverUrl: book.coverUrl } };
    }

    const [owner, holder, history] = await db.batch([
      db.prepare("select id, name, picture_url from members where id = ?").bind(row.owner_id),
      db.prepare("select id, name, picture_url from members where id = ?").bind(row.holder_member_id),
      db
        .prepare(
          `select e.at, e.type, m.id, m.name, m.picture_url
           from events e join members m on m.id = e.actor_id
           where e.copy_id = ? order by e.id desc`,
        )
        .bind(row.copy_id),
    ]);
    const ownerRow = (owner.results[0] as PersonRow | undefined) ?? null;
    const holderRow = (holder.results[0] as PersonRow | undefined) ?? null;
    const entries = (history.results as (PersonRow & { at: number; type: HistoryEntry["type"] })[]).map(
      (r): HistoryEntry => ({ at: r.at, type: r.type, actor: person(r) }),
    );
    return {
      kind: "copy",
      copy: {
        copyId: row.copy_id,
        code,
        book,
        owner: ownerRow && person(ownerRow),
        // A copy with no holder row has no member to show; the name is empty rather than invented.
        holder: holderRow ? { kind: "member", person: person(holderRow) } : { kind: "named", name: "" },
        home: row.owner_id !== null && row.owner_id === row.holder_member_id,
        history: entries,
        actions: availableActions({ ownerId: row.owner_id, holderMemberId: row.holder_member_id }, viewer),
      },
    };
  }

  async function add(owner: Member, input: AddInput): Promise<CopyView | Rejection> {
    const code = parseLabelLink(input.code);
    const form = input.book;
    let isbn: string | null = null;
    let title = "";
    let authors: string[] = [];
    if (form && "isbn" in form) {
      isbn = typeof form.isbn === "string" ? toIsbn13(form.isbn) : null;
      if (isbn === null) return { rejected: "invalid" };
    } else if (form && "title" in form) {
      const t = cleanText(form.title, MAX_TITLE);
      if (t === null || !Array.isArray(form.authors) || form.authors.length > MAX_AUTHORS) return { rejected: "invalid" };
      const cleaned = form.authors.map((a) => cleanText(a, MAX_AUTHOR));
      if (cleaned.some((a) => a === null)) return { rejected: "invalid" };
      title = t;
      authors = cleaned as string[];
    } else {
      return { rejected: "invalid" };
    }

    if (code === null) return { rejected: "label-unknown" };
    const label = await db.prepare("select copy_id from labels where code = ?").bind(code).first<{ copy_id: string | null }>();
    if (!label) return { rejected: "label-unknown" };
    if (label.copy_id !== null) return { rejected: "label-in-use" };

    let newBook: BookInfo | null = null; // set when a books row has to be written
    if (isbn !== null) {
      const existing = await db.prepare("select 1 as found from books where isbn = ?").bind(isbn).first();
      if (!existing) {
        const found = await lookup(isbn);
        if (!found) return { rejected: "book-not-found" };
        newBook = found;
      }
    } else {
      newBook = { isbn: null, title, authors, coverUrl: null };
    }

    const at = now();
    const copyId = crypto.randomUUID();
    const bookId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [];
    // Every write below runs only while the label is still blank; the label update is last, so it is the one that closes the door.
    if (newBook) {
      statements.push(
        db
          .prepare(
            `insert into books (id, isbn, title, authors, cover_url, created_at)
             select ?, ?, ?, ?, ?, ? where exists ${BLANK}
             on conflict(isbn) do nothing`,
          )
          .bind(
            bookId,
            isbn,
            newBook.title,
            JSON.stringify(newBook.authors),
            newBook.coverUrl,
            at,
            code,
          ),
      );
    }
    statements.push(
      isbn !== null
        ? db
            .prepare(
              `insert into copies (id, book_id, owner_id, holder_member_id, created_at)
               select ?, (select id from books where isbn = ?), ?, ?, ? where exists ${BLANK}`,
            )
            .bind(copyId, isbn, owner.id, owner.id, at, code)
        : db
            .prepare(
              `insert into copies (id, book_id, owner_id, holder_member_id, created_at)
               select ?, ?, ?, ?, ? where exists ${BLANK}`,
            )
            .bind(copyId, bookId, owner.id, owner.id, at, code),
    );
    for (const type of ["added", "labelled"]) {
      statements.push(
        db
          .prepare(`insert into events (copy_id, at, actor_id, type) select ?, ?, ?, ? where exists ${BLANK}`)
          .bind(copyId, at, owner.id, type, code),
      );
    }
    statements.push(
      db
        .prepare("update labels set copy_id = ?, bound_at = ? where code = ? and copy_id is null")
        .bind(copyId, at, code),
    );

    const results = await db.batch(statements);
    if (results[results.length - 1].meta.changes === 0) return { rejected: "label-in-use" };

    const v = await view(code, owner);
    if (v.kind !== "copy") throw new Error("a label just bound has no copy");
    return v.copy;
  }

  return { mintLabels, add, view };
}
