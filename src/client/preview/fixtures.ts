// Development only: public-domain books with real Open Library cover URLs, so the preview needs no API.
// Cover ids are those of common modern editions, in the /b/id/ form the app stores; none of this is anyone's reading data.
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
