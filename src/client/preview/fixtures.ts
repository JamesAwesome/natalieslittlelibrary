// Development only: public-domain books with real Open Library cover URLs, so the preview needs no API.
// Cover ids are those of common modern editions, in the /b/id/ form the app stores; none of this is anyone's reading data.
import type { CollectionRef, CollectionSummary, CopyView, Holder, Person, ShelfItem } from "../../shared/types";

const ol = (id: number) => `https://covers.openlibrary.org/b/id/${id}-M.jpg`;

export type FixtureBook = { title: string; authors: string[]; coverUrl: string | null };

export const LOADED: FixtureBook[] = [
  { title: "Pride and Prejudice", authors: ["Jane Austen"], coverUrl: ol(12645114) },
  { title: "Moby-Dick; or, The Whale", authors: ["Herman Melville"], coverUrl: ol(110556) },
  { title: "Frankenstein", authors: ["Mary Shelley"], coverUrl: ol(109033) },
  { title: "Dracula", authors: ["Bram Stoker"], coverUrl: ol(10541361) },
  { title: "Ruth", authors: ["Elizabeth Gaskell"], coverUrl: ol(103292) },
];

export const NO_COVER: FixtureBook = { title: "Beowulf", authors: ["Anonymous"], coverUrl: null };
// 90 characters, no spaces.
export const LONG_TITLE = "Donaudampfschifffahrtsgesellschaftskapitaenspatentinhaberskonferenzraumreservierungssystem1".slice(0, 90);
export const NO_COVER_LONG: FixtureBook = { title: LONG_TITLE, authors: ["Hans Müller-Schönenberger-Wolfsburg"], coverUrl: null };
// Nothing answers here, so the image really fails to load.
export const FAILED: FixtureBook = { title: "Middlemarch", authors: ["George Eliot"], coverUrl: "https://covers.invalid/b/isbn/0000000000-M.jpg" };
export const FAILED_LONG: FixtureBook = { ...NO_COVER_LONG, coverUrl: FAILED.coverUrl };

// The wall: 60 public-domain books over most letters (and "#"). Most have no cover; a few reuse the covers above.
// Copy ids are made up. A few are out, one with a removed member and one with a placeholder person.
const ann: Person = { id: "2", name: "Ann", pictureUrl: null };
const sam: Person = { id: "3", name: "Sam", pictureUrl: null, removed: true };
const natalie: Person = { id: "1", name: "Natalie", pictureUrl: null };
// k3's name is 60 characters, the longest a collection may have.
export const WALL_COLLECTIONS: CollectionRef[] = [
  { id: "k1", name: "Home library" }, { id: "k2", name: "Children’s shelf" },
  { id: "k3", name: "Russian, French and German novels in translation, mostly old" },
  { id: "k4", name: "Poetry" }, { id: "k5", name: "Plays" }, { id: "k6", name: "Lent to the school" },
];
const WALL_BOOKS: [string, string, string | null][] = [
  ...LOADED.map((b): [string, string, string | null] => [b.title, b.authors[0], b.coverUrl]),
  [NO_COVER.title, NO_COVER.authors[0], null],
  [FAILED.title, FAILED.authors[0], FAILED.coverUrl],
  [LONG_TITLE, NO_COVER_LONG.authors[0], null],
  ["Persuasion", "Jane Austen", null], ["Emma", "Jane Austen", LOADED[0].coverUrl], ["Northanger Abbey", "Jane Austen", null],
  ["Sense and Sensibility", "Jane Austen", null], ["Mansfield Park", "Jane Austen", null], ["Jane Eyre", "Charlotte Brontë", null],
  ["Villette", "Charlotte Brontë", null], ["Wuthering Heights", "Emily Brontë", LOADED[2].coverUrl],
  ["Great Expectations", "Charles Dickens", null], ["Bleak House", "Charles Dickens", LOADED[1].coverUrl], ["Oliver Twist", "Charles Dickens", null],
  ["Little Women", "Louisa May Alcott", null], ["Anna Karenina", "Leo Tolstoy", null], ["War and Peace", "Leo Tolstoy", LOADED[3].coverUrl],
  ["Crime and Punishment", "Fyodor Dostoevsky", null], ["The Odyssey", "Homer", null], ["The Iliad", "Homer", null],
  ["Aesop’s Fables", "Aesop", null], ["Silas Marner", "George Eliot", null], ["Tess of the d’Urbervilles", "Thomas Hardy", null],
  ["Jude the Obscure", "Thomas Hardy", LOADED[4].coverUrl], ["Uncle Tom’s Cabin", "Harriet Beecher Stowe", null], ["Vanity Fair", "William Makepeace Thackeray", null],
  ["Walden", "Henry David Thoreau", null], ["The Yellow Wallpaper", "Charlotte Perkins Gilman", null], ["Zuleika Dobson", "Max Beerbohm", null],
  ["Quo Vadis", "Henryk Sienkiewicz", null], ["The Time Machine", "H. G. Wells", LOADED[3].coverUrl], ["Heart of Darkness", "Joseph Conrad", null],
  ["Nostromo", "Joseph Conrad", null], ["Dubliners", "James Joyce", null],
  ["Ethan Frome", "Edith Wharton", null], ["North and South", "Elizabeth Gaskell", LOADED[4].coverUrl], ["Cranford", "Elizabeth Gaskell", null],
  ["Les Misérables", "Victor Hugo", null], ["Madame Bovary", "Gustave Flaubert", null], ["Don Quixote", "Miguel de Cervantes", LOADED[1].coverUrl],
  ["Effi Briest", "Theodor Fontane", null], ["Germinal", "Émile Zola", null], ["Kidnapped", "Robert Louis Stevenson", null],
  ["Treasure Island", "Robert Louis Stevenson", LOADED[2].coverUrl], ["Kim", "Rudyard Kipling", null], ["Ivanhoe", "Walter Scott", null],
  ["Robinson Crusoe", "Daniel Defoe", null], ["Gulliver’s Travels", "Jonathan Swift", null], ["Leviathan", "Thomas Hobbes", null],
  ["Pygmalion", "George Bernard Shaw", null], ["Siddhartha", "Hermann Hesse", null], ["Lysistrata", "Aristophanes", null],
  ["Metamorphoses", "Ovid", null], ["Candide", "Voltaire", null], ["1601", "Mark Twain", null],
];
const OUT: Record<string, Holder> = {
  Emma: { kind: "member", person: ann },
  Kidnapped: { kind: "member", person: sam },
  "Bleak House": { kind: "person", id: "p1", name: "Grandad" },
  Walden: { kind: "member", person: ann },
};
const KIDS = new Set(["Little Women", "Treasure Island", "Kidnapped", "Kim", "Aesop’s Fables", "Gulliver’s Travels", "Robinson Crusoe"]);
const TRANSLATED = new Set(["Anna Karenina", "War and Peace", "Crime and Punishment", "Les Misérables", "Madame Bovary", "Germinal", "Effi Briest", "Siddhartha"]);
export const WALL: ShelfItem[] = WALL_BOOKS.map(([title, author, coverUrl], i) => ({
  copyId: `p${i + 1}`,
  book: { isbn: null, title, authors: [author], coverUrl },
  labelled: i % 7 !== 3,
  owner: natalie,
  holder: OUT[title] ?? { kind: "member", person: natalie },
  home: !OUT[title],
  collection: KIDS.has(title) ? WALL_COLLECTIONS[1] : TRANSLATED.has(title) ? WALL_COLLECTIONS[2] : WALL_COLLECTIONS[0],
}));

// A book's page: Natalie's own copy, a friend's copy that someone else has, one no one owns, and one with the long title.
const day = (d: number) => Date.UTC(2026, 10, d, 12);
export const BOOK_COLLECTIONS: CollectionSummary[] = WALL_COLLECTIONS.map((c, i) => ({ ...c, isDefault: i === 0, count: 0, unlabelled: 0 }));
export const BOOK_VIEWER = { natalie: natalie.id, ann: ann.id };
const base = (book: FixtureBook): Pick<CopyView, "book" | "request"> => ({ book: { isbn: null, ...book }, request: null });
export const BOOK_OWNER: CopyView = {
  ...base(LOADED[3]), copyId: "p4", code: null, ownerCode: "t7k2q9xzmb", owner: natalie, holder: { kind: "member", person: natalie }, home: true,
  collection: WALL_COLLECTIONS[0], actions: ["lend", "give", "move", "relabel", "release"],
  history: [
    { at: day(22), type: "returned", actor: ann },
    { at: day(19), type: "lent", actor: natalie, subject: { kind: "member", person: ann } },
    { at: day(16), type: "labelled", actor: natalie },
    { at: day(16), type: "added", actor: natalie },
  ],
};
export const BOOK_FRIEND: CopyView = {
  ...base(LOADED[0]), copyId: "p1", code: "abc", ownerCode: null, owner: natalie, holder: { kind: "person", id: "x1", name: "Grandad" }, home: false,
  collection: WALL_COLLECTIONS[0], actions: ["claim", "request"],
  history: [{ at: day(20), type: "lent", actor: natalie, subject: { kind: "person", id: "x1", name: "Grandad" } }, { at: day(12), type: "added", actor: natalie }],
};
export const BOOK_OWNERLESS: CopyView = {
  ...base(NO_COVER), copyId: "p6", code: "def", ownerCode: null, owner: null, holder: null, home: false, collection: null, actions: ["adopt"],
  history: [{ at: day(21), type: "released", actor: sam }, { at: day(2), type: "added", actor: sam }],
};
export const BOOK_LONG: CopyView = {
  ...base(NO_COVER_LONG), copyId: "p8", code: "ghi", ownerCode: null, owner: { ...natalie, removed: true }, holder: { kind: "member", person: sam }, home: false,
  collection: WALL_COLLECTIONS[2], request: { by: sam, at: day(23) }, actions: ["withdraw"],
  history: [{ at: day(23), type: "requested", actor: sam }, { at: day(14), type: "claimed", actor: sam }],
};
