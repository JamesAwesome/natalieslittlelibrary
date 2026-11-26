import { LABEL_ALPHABET, LABEL_LENGTH, parseLabelLink } from "../../shared/labelCode";
import { cleanBookFacts } from "../../shared/bookFacts";
import { toIsbn13 } from "../../shared/isbn";
import type { BookInfo, Candidates, CollectionSummary, CopyView, Holder, ImportResult, ImportRow, Shelf, ShelfItem, HistoryEntry, LabelView, Member, Person, Rejection, SheetSummary } from "../../shared/types";
import { ACTIVE, createCollectionWrites, DEFAULT_OF, ensureDefault } from "./collections";
import { availableActions, decide } from "./rules";
import { createRelabel } from "./relabel";
import { createSheetReads } from "./sheets";
import { createShelfReads, holderOf, inCollection, personOf, type HolderColumns } from "./shelves";
import { BLANK, cleanText, createUnlabelled, MAX_AUTHOR, MAX_AUTHORS, MAX_TITLE } from "./unlabelled";

export type AddInput = {
  code: string;
  book: { isbn: string } | { title: string; authors: string[] };
  collectionId?: string | null; // one of the adder's own; absent or null means their default
};

export type ActInput = { type: "claim"; code: string } | { type: "return"; copyId: string };

export interface Ledger {
  mintLabels(member: Member, count: number): Promise<{ code: string; url: string }[] | Rejection>;
  add(owner: Member, input: AddInput): Promise<CopyView | Rejection>;
  view(code: string, viewer: Member | null): Promise<LabelView>;
  act(viewer: Member, action: ActInput): Promise<CopyView | Rejection>;
  viewCopy(copyId: string, viewer: Member): Promise<CopyView | Rejection>; // code null, no claim
  collectionsOf(ownerId: string): Promise<{ owner: Person; collections: CollectionSummary[] } | Rejection>;
  shelf(collectionId: string): Promise<Shelf | Rejection>;
  holding(member: Member): Promise<ShelfItem[]>;
  moveCopy(member: Member, copyId: string, collectionId: string): Promise<CopyView | Rejection>; // answers with code null
  createCollection(member: Member, name: string): Promise<CollectionSummary | Rejection>;
  renameCollection(member: Member, id: string, name: string): Promise<CollectionSummary | Rejection>;
  deleteCollection(member: Member, id: string): Promise<{ deleted: true } | Rejection>;
  makeDefault(member: Member, id: string): Promise<CollectionSummary[] | Rejection>; // the member's collections after
  // 1 to 20 rows, unlabelled copies owned and held by the importer; rows they already have are skipped inside the write.
  importCopies(owner: Member, input: { collectionId: string | null; rows: ImportRow[] }): Promise<ImportResult | Rejection>;
  sheets(member: Member): Promise<SheetSummary[]>; // the member's mints, newest first
  sheetCodes(member: Member, sheetId: string, opts: { includeMine: boolean }): Promise<{ code: string; url: string }[] | Rejection>;
  labelCopy(owner: Member, copyId: string, code: string): Promise<CopyView | Rejection>; // answers with the code the request carried
  // Retires `replacing`, the copy's live label, and binds the blank `code` in its place; answers with the new code in hand.
  replaceLabel(owner: Member, copyId: string, input: { code: string; replacing: string }): Promise<CopyView | Rejection>;
  candidates(owner: Member, query: { isbn?: string; title?: string }): Promise<Candidates | Rejection>; // never a label code
}

export type LedgerDeps = {
  db: D1Database;
  siteUrl: string;
  lookup: (isbn: string) => Promise<BookInfo | null>;
  lookupMany: (isbns: string[]) => Promise<Map<string, BookInfo>>;
  now?: () => number;
  randomBytes?: (n: number) => Uint8Array;
};

const MAX_MINT = 100;
const MAX_MINT_ROUNDS = 10;
// The largest multiple of the alphabet size that fits in a byte; bytes at or above it would bias the draw.
const BYTE_LIMIT = 248;

type CopyRow = {
  copy_id: string | null;
  isbn: string | null;
  title: string | null;
  authors: string | null;
  cover_url: string | null;
  owner_id: string | null;
  holder_member_id: string | null;
  requested_by: string | null;
  requested_at: number | null;
  collection_id: string | null;
  code: string | null;
};
const COPY_SELECT = `select c.id as copy_id, b.isbn, b.title, b.authors, b.cover_url, c.owner_id, c.holder_member_id, c.holder_person_id,
    c.requested_by, c.requested_at, hp.name as holder_person_name, c.collection_id, l.code
  from copies c
  join books b on b.id = c.book_id
  left join people hp on hp.id = c.holder_person_id
  left join labels l on l.copy_id = c.id and l.retired_at is null`;
type PersonRow = { id: string; name: string; picture_url: string | null; removed_at: number | null };

function person(r: PersonRow): Person {
  return personOf(r.id, r.name, r.picture_url, r.removed_at);
}

type HistoryRow = PersonRow & {
  at: number;
  type: HistoryEntry["type"];
  subject_member_id: string | null;
  subject_member_name: string | null;
  subject_member_picture: string | null;
  subject_member_removed_at: number | null;
  subject_person_id: string | null;
  subject_person_name: string | null;
  linked_member_id: string | null;
  linked_name: string | null;
  linked_picture: string | null;
  linked_removed_at: number | null;
};

// An event's subject: its member; else its placeholder, shown as the member the placeholder is now linked to, if any.
function subjectOf(r: HistoryRow): Holder | null {
  if (r.subject_member_id !== null && r.subject_member_name !== null) {
    return { kind: "member", person: personOf(r.subject_member_id, r.subject_member_name, r.subject_member_picture, r.subject_member_removed_at) };
  }
  if (r.linked_member_id !== null && r.linked_name !== null) {
    return { kind: "member", person: personOf(r.linked_member_id, r.linked_name, r.linked_picture, r.linked_removed_at) };
  }
  if (r.subject_person_id !== null && r.subject_person_name !== null) return { kind: "person", id: r.subject_person_id, name: r.subject_person_name };
  return null;
}

export function createLedger(deps: LedgerDeps): Ledger {
  const { db, lookup, lookupMany } = deps;
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

  // A copy as its owner sees it with a label of the request's in hand (labelling from a shelf, scanning an imported copy,
  // or replacing a label).
  const renderWithCode = async (copyId: string, viewer: Member, code: string): Promise<CopyView | null> => {
    const v = await renderCopy(copyId, viewer, code);
    return v?.kind === "copy" ? v.copy : null;
  };
  const unlabelled = createUnlabelled(db, now, lookup, lookupMany, renderWithCode);

  async function mintLabels(member: Member, count: number) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_MINT) return { rejected: "invalid" } as const;
    const sheetId = crypto.randomUUID();
    const minted: string[] = [];
    let needed = count;
    for (let round = 0; needed > 0; round++) {
      if (round === MAX_MINT_ROUNDS) throw new Error("could not mint distinct label codes");
      const codes = Array.from({ length: needed }, newCode);
      const results = await db.batch(
        codes.map((code) =>
          db
            .prepare("insert into labels (code, minted_by, minted_at, sheet_id) values (?, ?, ?, ?) on conflict(code) do nothing")
            .bind(code, member.id, now(), sheetId),
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
    const label = await db.prepare("select copy_id, retired_at from labels where code = ?").bind(code).first<{ copy_id: string | null; retired_at: number | null }>();
    if (!label) return { kind: "unknown" };
    if (label.retired_at !== null) return { kind: "retired" };
    if (label.copy_id === null) return { kind: "blank", code };
    return (await renderCopy(label.copy_id, viewer, code)) ?? { kind: "unknown" };
  }

  // The copy, its people, and its history are read in one batch, which is one transaction, so a view agrees with itself.
  // `codeInHand`: the code the request carried, if any. The view carries that code (never the joined row's) and offers a claim.
  async function renderCopy(copyId: string, viewer: Member | null, codeInHand: string | null): Promise<LabelView | null> {
    const statements = [
      db
        .prepare(
          `select x.*, o.name as owner_name, o.picture_url as owner_picture, o.removed_at as owner_removed_at,
             h.name as holder_name, h.picture_url as holder_picture, h.removed_at as holder_removed_at,
             a.name as asker_name, a.picture_url as asker_picture, a.removed_at as asker_removed_at,
             ${viewer === null ? "null" : "k.id"} as shown_collection_id, ${viewer === null ? "null" : "k.name"} as shown_collection_name
           from (${COPY_SELECT} where c.id = ?) x
           left join members o on o.id = x.owner_id
           left join members h on h.id = x.holder_member_id
           left join members a on a.id = x.requested_by
           ${viewer === null ? "" : `left join collections k on ${inCollection("x", "k")}`}`,
        )
        .bind(copyId),
    ];
    if (viewer !== null) {
      statements.push(
        db
          .prepare(
            `select e.at, e.type, m.id, m.name, m.picture_url, m.removed_at,
               e.subject_member_id, sm.name as subject_member_name, sm.picture_url as subject_member_picture, sm.removed_at as subject_member_removed_at,
               e.subject_person_id, sp.name as subject_person_name,
               sp.linked_member_id, lm.name as linked_name, lm.picture_url as linked_picture, lm.removed_at as linked_removed_at
             from events e
             join members m on m.id = e.actor_id
             left join members sm on sm.id = e.subject_member_id
             left join people sp on sp.id = e.subject_person_id
             left join members lm on lm.id = sp.linked_member_id
             where e.copy_id = ? order by e.id desc`,
          )
          .bind(copyId),
      );
    }
    const [copyResult, history] = await db.batch(statements);
    const row = copyResult.results[0] as
      | (CopyRow & HolderColumns & {
          owner_name: string | null;
          owner_picture: string | null;
          owner_removed_at: number | null;
          asker_name: string | null;
          asker_picture: string | null;
          asker_removed_at: number | null;
          shown_collection_id: string | null; shown_collection_name: string | null;
        })
      | undefined;
    if (!row) return null;
    const book: BookInfo = {
      isbn: row.isbn,
      title: row.title!,
      authors: JSON.parse(row.authors!) as string[],
      coverUrl: row.cover_url,
    };
    if (viewer === null) {
      return { kind: "public", code: codeInHand!, book: { title: book.title, authors: book.authors, coverUrl: book.coverUrl } };
    }
    const entries = (history.results as HistoryRow[]).map((r): HistoryEntry => {
      const entry: HistoryEntry = { at: r.at, type: r.type, actor: person(r) };
      const subject = subjectOf(r);
      return subject === null ? entry : { ...entry, subject };
    });
    return {
      kind: "copy",
      copy: {
        copyId,
        code: codeInHand,
        // The live label's code, for the owner only, however the page was reached.
        ownerCode: row.owner_id !== null && row.owner_id === viewer.id ? row.code : null,
        book,
        owner:
          row.owner_id !== null && row.owner_name !== null ? personOf(row.owner_id, row.owner_name, row.owner_picture, row.owner_removed_at) : null,
        holder: holderOf(row),
        // A removed asker's request counts as none.
        request:
          row.requested_by !== null && row.requested_at !== null && row.asker_name !== null && row.asker_removed_at === null
            ? { by: personOf(row.requested_by, row.asker_name, row.asker_picture, null), at: row.requested_at }
            : null,
        home: row.owner_id !== null && row.owner_id === row.holder_member_id,
        // Members see where a copy lives, home or out; the public view (above) has no collection.
        collection:
          row.shown_collection_id !== null && row.shown_collection_name !== null
            ? { id: row.shown_collection_id, name: row.shown_collection_name }
            : null,
        history: entries,
        actions: availableActions(
          { ownerId: row.owner_id, holderMemberId: row.holder_member_id, labelled: row.code !== null },
          viewer,
          { labelInHand: codeInHand !== null },
        ),
      },
    };
  }

  async function add(owner: Member, input: AddInput): Promise<CopyView | Rejection> {
    if (typeof input !== "object" || input === null || typeof input.code !== "string") return { rejected: "invalid" };
    const code = parseLabelLink(input.code);
    const collectionId = input.collectionId ?? null;
    if (collectionId !== null && typeof collectionId !== "string") return { rejected: "invalid" };
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

    // A scan of an ISBN the adder already has an unlabelled copy of (imported, say) labels that copy: no lookup, no new copy, and the picked collection does not apply to a copy that exists.
    if (isbn !== null) {
      const bound = await unlabelled.bindToUnlabelled(owner, code, isbn);
      if (bound !== null) return bound;
    }

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
    // The whole write runs only while the label is blank, the adder is active and the destination is theirs, all decided
    // inside each statement. The destination is the persisted default row or the chosen collection, never an id the
    // request made up. A book is written only with the copy, so a refused add leaves no orphan.
    const dest =
      collectionId === null
        ? { sql: `exists ${DEFAULT_OF}`, binds: [owner.id], column: DEFAULT_OF }
        : { sql: "exists (select 1 from collections where id = ? and owner_id = ?)", binds: [collectionId, owner.id], column: "?" };
    // An ISBN add also requires that the adder has no unlabelled copy of it: one an import wrote since the bind path looked
    // belongs to the label instead (see the retry below).
    const hasNone =
      isbn === null
        ? { sql: "", binds: [] as string[] }
        : {
            sql: ` and not exists (select 1 from copies c join books b on b.id = c.book_id
                     where c.owner_id = ? and not exists (select 1 from labels where copy_id = c.id) and (b.isbn = ? or c.import_isbn = ?))`,
            binds: [owner.id, isbn, isbn],
          };
    const baseGuard = `exists ${BLANK} and ${ACTIVE} and ${dest.sql}`;
    const baseBinds = [code, owner.id, ...dest.binds];
    // The book and the copy carry the no-unlabelled-copy guard; the events follow the copy, which is itself unlabelled until
    // the last statement, so they carry the base guard and the copy-exists check only.
    const guard = baseGuard + hasNone.sql;
    const guardBinds = [...baseBinds, ...hasNone.binds];
    const statements: D1PreparedStatement[] = [];
    // Without a chosen collection, the adder's default exists first (and old code's null-collection copies are pinned to it).
    if (collectionId === null) statements.push(...ensureDefault(db, owner.id, at));
    if (newBook) {
      statements.push(
        db
          .prepare(
            `insert into books (id, isbn, title, authors, cover_url, created_at)
             select ?, ?, ?, ?, ?, ? where ${guard}
             on conflict(isbn) do nothing`,
          )
          .bind(bookId, isbn, newBook.title, JSON.stringify(newBook.authors), newBook.coverUrl, at, ...guardBinds),
      );
    }
    const bookRef = isbn !== null ? "(select id from books where isbn = ?)" : "?";
    statements.push(
      db
        .prepare(
          `insert into copies (id, book_id, owner_id, holder_member_id, collection_id, created_at)
           select ?, ${bookRef}, ?, ?, ${dest.column}, ? where ${guard}`,
        )
        .bind(copyId, isbn ?? bookId, owner.id, owner.id, ...(collectionId === null ? [owner.id] : [collectionId]), at, ...guardBinds),
    );
    const copyExists = "exists (select 1 from copies where id = ?)";
    for (const type of ["added", "labelled"]) {
      statements.push(
        db
          .prepare(`insert into events (copy_id, at, actor_id, type) select ?, ?, ?, ? where ${copyExists} and ${baseGuard}`)
          // Binds in order: the inserted values (copy id, at, actor, type), then the copy-exists check's copy id, then the guard.
          .bind(copyId, at, owner.id, type, copyId, ...baseBinds),
      );
    }
    // Last, and guarded on the copy row existing, so its change count says whether everything applied.
    statements.push(
      db
        .prepare(
          `update labels set copy_id = ?, bound_at = ? where code = ? and copy_id is null and ${copyExists} and ${ACTIVE}`,
        )
        .bind(copyId, at, code, copyId, owner.id),
    );

    const results = await db.batch(statements);
    if (results[results.length - 1].meta.changes === 0) {
      const bound = await db.prepare("select copy_id from labels where code = ?").bind(code).first<{ copy_id: string | null }>();
      if (bound?.copy_id != null) return { rejected: "label-in-use" };
      // An import landed after the bind path looked: the label belongs on that copy. Once, so this cannot loop.
      if (isbn !== null) {
        const late = await unlabelled.bindToUnlabelled(owner, code, isbn);
        if (late !== null) return late;
      }
      if (collectionId !== null) {
        const k = await db.prepare("select owner_id from collections where id = ?").bind(collectionId).first<{ owner_id: string }>();
        if (k === null || k.owner_id !== owner.id) return { rejected: "not-found" };
      }
      return { rejected: "not-allowed" };
    }

    const v = await view(code, owner);
    if (v.kind !== "copy") throw new Error("a label just bound has no copy");
    return v.copy;
  }

  async function act(viewer: Member, action: ActInput): Promise<CopyView | Rejection> {
    if (typeof action !== "object" || action === null) return { rejected: "invalid" };
    const type: unknown = action.type;
    if (type !== "claim" && type !== "return") return { rejected: "invalid" };

    let row: CopyRow | null;
    let code: string | null = null;
    if (type === "claim") {
      const raw = (action as { code?: unknown }).code;
      if (typeof raw !== "string") return { rejected: "invalid" };
      code = parseLabelLink(raw);
      if (code === null) return { rejected: "not-found" };
      row = await db.prepare(`${COPY_SELECT} where l.code = ?`).bind(code).first<CopyRow>();
    } else {
      const copyId = (action as { copyId?: unknown }).copyId;
      if (typeof copyId !== "string") return { rejected: "invalid" };
      row = await db.prepare(`${COPY_SELECT} where c.id = ?`).bind(copyId).first<CopyRow>();
    }
    if (!row || row.copy_id === null) return { rejected: "not-found" };

    const decision = decide({ ownerId: row.owner_id, holderMemberId: row.holder_member_id, labelled: row.code !== null }, viewer, type);
    if ("rejected" in decision) return decision;

    // Both statements carry the whole state the decision was made against (and, for a claim, the label still being
    // bound to this copy), so anything that changed in between leaves both of them touching no row.
    const labelGuard = (copyColumn: string): { sql: string; binds: string[] } =>
      type === "claim"
        ? { sql: ` and exists (select 1 from labels where code = ? and copy_id = ${copyColumn} and retired_at is null)`, binds: [code!] }
        : { sql: "", binds: [] };
    const at = now();
    const onInsert = labelGuard("c.id");
    const onUpdate = labelGuard("copies.id");
    const insert = db
      .prepare(
        `insert into events (copy_id, at, actor_id, type)
         select c.id, ?, ?, ? from copies c where c.id = ? and c.owner_id is ? and c.holder_member_id is ?${onInsert.sql}`,
      )
      .bind(at, viewer.id, decision.event, row.copy_id, row.owner_id, row.holder_member_id, ...onInsert.binds);
    // The collection is never changed, except that a copy old code left with none gets its owner's default.
    const update = db
      .prepare(
        `update copies set holder_member_id = ?,
           collection_id = coalesce(collection_id, (select id from collections k where k.owner_id = copies.owner_id and k.is_default = 1))
         where id = ? and owner_id is ? and holder_member_id is ?${onUpdate.sql}`,
      )
      .bind(decision.holderMemberId, row.copy_id, row.owner_id, row.holder_member_id, ...onUpdate.binds);

    // A copy old code left with no collection, whose owner has no default yet, gets that default first.
    const prelude = row.owner_id !== null && row.collection_id === null ? ensureDefault(db, row.owner_id, at) : [];
    // Event first, update last; the update's change count says whether the pair applied.
    const results = await db.batch([...prelude, insert, update]);
    if (results[results.length - 1].meta.changes === 0) return { rejected: "not-allowed" };

    const v = await renderCopy(row.copy_id, viewer, code ?? null);
    if (v?.kind !== "copy") throw new Error("a copy just changed has vanished");
    return v.copy;
  }

  // A copy reached by id: the request carried no label, so no code and no claim.
  async function viewCopy(copyId: string, viewer: Member): Promise<CopyView | Rejection> {
    if (typeof copyId !== "string") return { rejected: "not-found" };
    const v = await renderCopy(copyId, viewer, null);
    return v?.kind === "copy" ? v.copy : { rejected: "not-found" };
  }

  async function moveCopy(member: Member, copyId: string, collectionId: string): Promise<CopyView | Rejection> {
    if (typeof copyId !== "string" || typeof collectionId !== "string") return { rejected: "invalid" };
    // decide() says whether the owner may move this copy; the write then re-checks the copy, the destination and the
    // actor inside the statement, against anything that changed since.
    const row = await db.prepare(`${COPY_SELECT} where c.id = ?`).bind(copyId).first<CopyRow>();
    if (!row || row.copy_id === null) return { rejected: "not-found" };
    const decision = decide({ ownerId: row.owner_id, holderMemberId: row.holder_member_id, labelled: row.code !== null }, member, "move");
    if ("rejected" in decision) return decision;
    const [r] = await db.batch([
      db
        .prepare(
          `update copies set collection_id = ?
           where id = ? and owner_id = ? and ${ACTIVE}
             and exists (select 1 from collections where id = ? and owner_id = ?)`,
        )
        .bind(collectionId, copyId, member.id, member.id, collectionId, member.id),
    ]);
    if (r.meta.changes === 0) {
      const active = await db.prepare("select 1 as ok from members where id = ? and removed_at is null").bind(member.id).first();
      if (active === null) return { rejected: "not-allowed" };
      const copy = await db.prepare("select owner_id from copies where id = ?").bind(copyId).first<{ owner_id: string | null }>();
      if (copy === null) return { rejected: "not-found" };
      if (copy.owner_id !== member.id) return { rejected: "not-allowed" };
      const k = await db.prepare("select owner_id from collections where id = ?").bind(collectionId).first<{ owner_id: string }>();
      return k === null || k.owner_id !== member.id ? { rejected: "not-found" } : { rejected: "not-allowed" };
    }
    const v = await renderCopy(copyId, member, null);
    if (v?.kind !== "copy") throw new Error("a copy just moved has vanished");
    return v.copy;
  }

  const { importCopies, labelCopy, candidates } = unlabelled;
  return { mintLabels, add, view, act, viewCopy, moveCopy, importCopies, labelCopy, candidates, ...createShelfReads(db), ...createSheetReads(db, deps.siteUrl), ...createRelabel(db, now, renderWithCode), ...createCollectionWrites(db, now) };
}
