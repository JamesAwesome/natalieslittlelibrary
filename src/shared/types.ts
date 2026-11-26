export type Member = { id: string; name: string; email: string; pictureUrl: string | null; isAdmin: boolean };
export type RefusalReason = "not-invited" | "removed" | "unverified" | "failed" | "unavailable";

export type Person = { id: string; name: string; pictureUrl: string | null };
export type BookInfo = { isbn: string | null; title: string; authors: string[]; coverUrl: string | null };
export type Holder = { kind: "member"; person: Person } | { kind: "named"; name: string };
export type CollectionRef = { id: string; name: string };
export type CollectionSummary = { id: string; name: string; isDefault: boolean; count: number; unlabelled: number };
export type ActionType = "claim" | "return" | "move" | "label";
export type HistoryEntry = { at: number; type: "added" | "labelled" | "claimed" | "returned"; actor: Person };
export type CopyView = {
  copyId: string;
  code: string | null;
  book: BookInfo;
  owner: Person | null;
  holder: Holder;
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
  holder: Holder;
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
