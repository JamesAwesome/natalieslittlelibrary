export type Member = { id: string; name: string; email: string; pictureUrl: string | null; isAdmin: boolean };
export type RefusalReason = "not-invited" | "removed" | "unverified" | "failed" | "unavailable";

// `removed` is present (true) only for a member who has been removed; it is never false.
export type Person = { id: string; name: string; pictureUrl: string | null; removed?: true };
export type BookInfo = { isbn: string | null; title: string; authors: string[]; coverUrl: string | null };
export type Holder = { kind: "member"; person: Person } | { kind: "person"; id: string; name: string };
export type CollectionRef = { id: string; name: string };
export type CollectionSummary = { id: string; name: string; isDefault: boolean; count: number; unlabelled: number };
export type ActionType =
  | "claim" | "return" | "move" | "label" | "relabel"
  | "lend" | "give" | "request" | "withdraw" | "approve" | "decline" | "release" | "adopt";
export type HistoryEntry = {
  at: number;
  type: "added" | "labelled" | "relabelled" | "claimed" | "returned" | "lent" | "given" | "requested" | "withdrawn" | "approved" | "declined" | "released" | "adopted";
  actor: Person;
  subject?: Holder; // who the event was done to or for; a placeholder linked since renders as its member
};
export type CopyView = {
  copyId: string;
  code: string | null; // the code the request carried; null when reached by id
  ownerCode: string | null; // the copy's live label code, for its owner only; null for anyone else or an unlabelled copy
  book: BookInfo;
  owner: Person | null;
  holder: Holder | null;
  request: { by: Person; at: number } | null; // null when the asker has been removed
  home: boolean;
  collection: CollectionRef | null;
  history: HistoryEntry[]; // newest first
  actions: ActionType[]; // what this viewer may do right now
};
export type ShelfItem = {
  copyId: string;
  book: BookInfo;
  labelled: boolean;
  owner: Person | null;
  holder: Holder | null;
  home: boolean;
  collection: CollectionRef | null;
}; // never a label code
export type Shelf = { collection: CollectionSummary; owner: Person; items: ShelfItem[] };
export type Candidates = { sameIsbn: ShelfItem | null; similar: ShelfItem[] };
export type ImportRow = { title: string; authors: string[]; isbn: string | null };
export type ImportResult = { added: number; skipped: number };
export type LabelView =
  | { kind: "unknown" }
  | { kind: "blank"; code: string }
  | { kind: "retired" }
  | { kind: "public"; code: string; book: { title: string; authors: string[]; coverUrl: string | null } }
  | { kind: "copy"; copy: CopyView };
export type RejectionReason = "not-found" | "not-allowed" | "label-unknown" | "label-in-use" | "name-taken" | "book-not-found" | "invalid" | "signed-out" | "unavailable";
export type Rejection = { rejected: RejectionReason };

export type SheetSummary = { id: string; at: number; total: number; blank: number; mine: number };
