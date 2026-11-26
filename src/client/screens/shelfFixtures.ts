import type { CollectionSummary, Member, Person, Shelf, ShelfItem } from "../../shared/types";

export const me: Member = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };
export const natalie: Person = { id: "1", name: "Natalie", pictureUrl: null };
export const ann: Person = { id: "2", name: "Ann", pictureUrl: null };

export function item(over: Partial<ShelfItem> & { copyId: string }): ShelfItem {
  return {
    book: { isbn: null, title: `Book ${over.copyId}`, authors: ["An Author"], coverUrl: null },
    labelled: true, owner: natalie, holder: { kind: "member", person: natalie }, home: true,
    collection: { id: "k1", name: "Home library" }, ...over,
  };
}
export const summary = (over: Partial<CollectionSummary> & { id: string; name: string }): CollectionSummary => ({
  isDefault: false, count: 0, unlabelled: 0, ...over,
});
export const shelfOf = (collection: CollectionSummary, items: ShelfItem[], owner: Person = natalie): Shelf => ({ collection, owner, items });
