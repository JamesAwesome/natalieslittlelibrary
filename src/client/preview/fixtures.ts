// Development only: public-domain books with real Open Library cover URLs, so the preview needs no API.
// ISBNs are common modern editions; none of this is anyone's reading data.
const ol = (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;

export type FixtureBook = { title: string; authors: string[]; coverUrl: string | null };

export const LOADED: FixtureBook[] = [
  { title: "Pride and Prejudice", authors: ["Jane Austen"], coverUrl: ol("9780141439518") },
  { title: "Moby-Dick; or, The Whale", authors: ["Herman Melville"], coverUrl: ol("9780142437247") },
  { title: "Frankenstein", authors: ["Mary Shelley"], coverUrl: ol("9780141439471") },
  { title: "Dracula", authors: ["Bram Stoker"], coverUrl: ol("9780141439846") },
  { title: "Ruth", authors: ["Elizabeth Gaskell"], coverUrl: ol("9780140434309") },
];

export const NO_COVER: FixtureBook = { title: "Beowulf", authors: ["Anonymous"], coverUrl: null };
// 90 characters, no spaces.
export const LONG_TITLE = "Donaudampfschifffahrtsgesellschaftskapitaenspatentinhaberskonferenzraumreservierungssystem1".slice(0, 90);
export const NO_COVER_LONG: FixtureBook = { title: LONG_TITLE, authors: ["Hans Müller-Schönenberger-Wolfsburg"], coverUrl: null };
// Nothing answers here, so the image really fails to load.
export const FAILED: FixtureBook = { title: "Middlemarch", authors: ["George Eliot"], coverUrl: "https://covers.invalid/b/isbn/0000000000-M.jpg" };
export const FAILED_LONG: FixtureBook = { ...NO_COVER_LONG, coverUrl: FAILED.coverUrl };
