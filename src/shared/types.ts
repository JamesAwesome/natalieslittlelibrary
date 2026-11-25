export type Member = { id: string; name: string; email: string; pictureUrl: string | null; isAdmin: boolean };
export type RefusalReason = "not-invited" | "removed" | "unverified" | "failed" | "unavailable";

export type Person = { id: string; name: string; pictureUrl: string | null };
export type BookInfo = { isbn: string | null; title: string; authors: string[]; coverUrl: string | null };
// A second catalogue's guess at a book, shown for the person to check; never stored.
export type Suggestion = { title: string; authors: string[]; link: string };
export type Holder = { kind: "member"; person: Person } | { kind: "named"; name: string };
export type ActionType = "claim" | "return";
export type HistoryEntry = { at: number; type: "added" | "labelled" | "claimed" | "returned"; actor: Person };
export type CopyView = {
  copyId: string;
  code: string | null;
  book: BookInfo;
  owner: Person | null;
  holder: Holder;
  home: boolean;
  history: HistoryEntry[]; // newest first
  actions: ActionType[]; // what this viewer may do right now
};
export type LabelView =
  | { kind: "unknown" }
  | { kind: "blank"; code: string }
  | { kind: "public"; code: string; book: { title: string; authors: string[]; coverUrl: string | null } }
  | { kind: "copy"; copy: CopyView };
export type RejectionReason = "not-found" | "not-allowed" | "label-unknown" | "label-in-use" | "book-not-found" | "invalid" | "signed-out" | "unavailable";
export type Rejection = { rejected: RejectionReason };
