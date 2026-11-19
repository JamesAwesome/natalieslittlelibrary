import { LABEL_ALPHABET, LABEL_LENGTH, parseLabelLink } from "../../shared/labelCode";
import { cleanBookFacts } from "../../shared/bookFacts";
import { toIsbn13 } from "../../shared/isbn";
import type { ActionType, BookInfo, CopyView, HistoryEntry, LabelView, Member, Person, Rejection } from "../../shared/types";
import { availableActions, decide } from "./rules";

export type AddInput = { code: string; book: { isbn: string } | { title: string; authors: string[] } };

export type ActInput = { type: "claim"; code: string } | { type: "return"; copyId: string };

export interface Ledger {
  mintLabels(member: Member, count: number): Promise<{ code: string; url: string }[] | Rejection>;
  add(owner: Member, input: AddInput): Promise<CopyView | Rejection>;
  view(code: string, viewer: Member | null): Promise<LabelView>;
  act(viewer: Member, action: ActInput): Promise<CopyView | Rejection>;
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
type CopyRowWithCode = CopyRow & { code: string | null };
const COPY_SELECT = `select c.id as copy_id, b.isbn, b.title, b.authors, b.cover_url, c.owner_id, c.holder_member_id, l.code
  from copies c
  join books b on b.id = c.book_id
  left join labels l on l.copy_id = c.id`;
type PersonRow = { id: string; name: string; picture_url: string | null };

function person(r: PersonRow): Person {
  return { id: r.id, name: r.name, pictureUrl: r.picture_url };
}

function cleanText(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  const length = Array.from(t).length;
  return length >= 1 && length <= max ? t : null;
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
    return renderCopy(row, code, viewer);
  }

  async function renderCopy(row: CopyRow, code: string | null, viewer: Member | null): Promise<LabelView> {
    const book: BookInfo = {
      isbn: row.isbn,
      title: row.title!,
      authors: JSON.parse(row.authors!) as string[],
      coverUrl: row.cover_url,
    };
    if (viewer === null) {
      return { kind: "public", code: code!, book: { title: book.title, authors: book.authors, coverUrl: book.coverUrl } };
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
        copyId: row.copy_id!,
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
    if (typeof input !== "object" || input === null || typeof input.code !== "string") return { rejected: "invalid" };
    const code = parseLabelLink(input.code);
    const form = input.book as unknown as Record<string, unknown> | null;
    if (typeof form !== "object" || form === null) return { rejected: "invalid" };
    let isbn: string | null = null;
    let title = "";
    let authors: string[] = [];
    if ("isbn" in form) {
      isbn = typeof form.isbn === "string" ? toIsbn13(form.isbn) : null;
      if (isbn === null) return { rejected: "invalid" };
    } else if ("title" in form) {
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
        let facts: ReturnType<typeof cleanBookFacts> = null;
        try {
          facts = cleanBookFacts(await lookup(isbn));
        } catch {
          // A lookup that fails is the same as a book it cannot find.
        }
        if (!facts) return { rejected: "book-not-found" };
        newBook = { isbn, ...facts };
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

  async function act(viewer: Member, action: ActInput): Promise<CopyView | Rejection> {
    if (typeof action !== "object" || action === null) return { rejected: "invalid" };
    const type: unknown = action.type;
    if (type !== "claim" && type !== "return") return { rejected: "invalid" };

    let row: CopyRowWithCode | null;
    let code: string | null = null;
    if (type === "claim") {
      const raw = (action as { code?: unknown }).code;
      if (typeof raw !== "string") return { rejected: "invalid" };
      code = parseLabelLink(raw);
      if (code === null) return { rejected: "not-found" };
      row = await db
        .prepare(`${COPY_SELECT} where l.code = ?`)
        .bind(code)
        .first<CopyRowWithCode>();
    } else {
      const copyId = (action as { copyId?: unknown }).copyId;
      if (typeof copyId !== "string") return { rejected: "invalid" };
      row = await db
        .prepare(`${COPY_SELECT} where c.id = ?`)
        .bind(copyId)
        .first<CopyRowWithCode>();
    }
    if (!row || row.copy_id === null) return { rejected: "not-found" };

    const decision = decide({ ownerId: row.owner_id, holderMemberId: row.holder_member_id }, viewer, type as ActionType);
    if ("rejected" in decision) return decision;

    // Both statements carry the whole state the decision was made against (and, for a claim, the label still being
    // bound to this copy), so anything that changed in between leaves both of them touching no row.
    const at = now();
    const bound = type === "claim" ? " and exists (select 1 from labels where code = ? and copy_id = c.id)" : "";
    const boundUpdate = type === "claim" ? " and exists (select 1 from labels where code = ? and copy_id = copies.id)" : "";
    const insert = db
      .prepare(
        `insert into events (copy_id, at, actor_id, type)
         select c.id, ?, ?, ? from copies c where c.id = ? and c.owner_id is ? and c.holder_member_id is ?${bound}`,
      )
      .bind(at, viewer.id, decision.event, row.copy_id, row.owner_id, row.holder_member_id, ...(type === "claim" ? [code] : []));
    const update = db
      .prepare(`update copies set holder_member_id = ? where id = ? and owner_id is ? and holder_member_id is ?${boundUpdate}`)
      .bind(decision.holderMemberId, row.copy_id, row.owner_id, row.holder_member_id, ...(type === "claim" ? [code] : []));

    // Event first, label-or-state update last; the update's change count says whether the pair applied.
    const results = await db.batch([insert, update]);
    if (results[1].meta.changes === 0) return { rejected: "not-allowed" };

    const after = await db.prepare(`${COPY_SELECT} where c.id = ?`).bind(row.copy_id).first<CopyRowWithCode>();
    if (!after) throw new Error("a copy just changed has vanished");
    const v = await renderCopy(after, after.code, viewer);
    if (v.kind !== "copy") throw new Error("a copy view was expected");
    return v.copy;
  }

  return { mintLabels, add, view, act };
}
