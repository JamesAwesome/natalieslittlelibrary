import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { ShelfItem } from "../../shared/types";
import { ann, item } from "../screens/shelfFixtures";
import { CoverWall, type WallKind } from "./CoverWall";
import { ALL, type WallFilter } from "./model";

// A note line holds a <bdi> name, so match on the paragraph's whole text.
const line = (t: string) => (_: string, el: Element | null) => el?.tagName === "P" && el.textContent === t;

const sam = { id: "3", name: "Sam", pictureUrl: null, removed: true as const };
const home = { id: "k1", name: "Home library" };
const kids = { id: "k2", name: "Kids" };

const wall = (over: Partial<Parameters<typeof CoverWall>[0]> & { kind?: WallKind } = {}) => {
  const props = {
    kind: "mine" as WallKind, title: "My books", items: [item({ copyId: "c1" })], collections: [home, kids],
    filter: ALL, onFilter: vi.fn(), empty: <p>Nothing here yet.</p>, ...over,
  };
  return { ...render(<CoverWall {...props} />), props };
};

// n books, spread over the alphabet unless one letter is asked for.
const many = (n: number, letter?: string): ShelfItem[] =>
  Array.from({ length: n }, (_, i) => item({ copyId: `c${i}`, book: { isbn: null, title: `${letter ?? String.fromCharCode(65 + (i % 26))}ook ${i}`, authors: [], coverUrl: null } }));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

test("shows the title as the h1 and the count line, and hides the count line when incomplete", () => {
  const items = [item({ copyId: "c1" }), item({ copyId: "c2", home: false, holder: { kind: "member", person: ann } })];
  const { unmount } = wall({ items });
  expect(screen.getByRole("heading", { level: 1, name: "My books" })).toBeInTheDocument();
  expect(screen.getByText("2 books · 1 lent out")).toBeInTheDocument();
  unmount();
  wall({ items, incomplete: true });
  expect(screen.getByRole("heading", { level: 1, name: "My books" })).toBeInTheDocument();
  expect(screen.queryByText(/\d+ books/)).toBeNull();
});

test("a friend's wall counts books without the lent-out part", () => {
  wall({ kind: "friend", title: "Ann", items: [item({ copyId: "c1", home: false })] });
  expect(screen.getByText("1 book")).toBeInTheDocument();
});

test("renders top between the count line and the chips", () => {
  wall({ top: <p>2 requests</p> });
  const top = screen.getByText("2 requests");
  const count = screen.getByText("1 book");
  const chip = screen.getByRole("button", { name: "All" });
  expect(count.compareDocumentPosition(top) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(top.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("each letter group is an h2 with a letter id, # as letter-hash", () => {
  wall({ items: [
    item({ copyId: "c1", book: { isbn: null, title: "Beowulf", authors: [], coverUrl: null } }),
    item({ copyId: "c2", book: { isbn: null, title: "The Aeneid", authors: [], coverUrl: null } }),
    item({ copyId: "c3", book: { isbn: null, title: "1984", authors: [], coverUrl: null } }),
  ] });
  const headings = screen.getAllByRole("heading", { level: 2 });
  expect(headings.map((h) => [h.textContent, h.id])).toEqual([["A", "letter-A"], ["B", "letter-B"], ["#", "letter-hash"]]);
});

test("each book links to its page, named by title then authors through hidden text", () => {
  wall({ items: [
    item({ copyId: "c 1", book: { isbn: null, title: "Good Omens", authors: ["Terry Pratchett", "Neil Gaiman"], coverUrl: null } }),
    item({ copyId: "c2", book: { isbn: null, title: "Beowulf", authors: [], coverUrl: null } }),
  ] });
  const omens = screen.getByRole("link", { name: "Good Omens, Terry Pratchett, Neil Gaiman" });
  expect(omens).toHaveAttribute("href", "/copies/c%201");
  expect(within(omens).getByText("Good Omens, Terry Pratchett, Neil Gaiman")).toHaveClass("visually-hidden");
  expect(screen.getByRole("link", { name: "Beowulf" })).toHaveAttribute("href", "/copies/c2");
});

test("on your own wall a lent book reads 'With Ann' and a book at home has no note", () => {
  wall({ items: [
    item({ copyId: "c1", book: { isbn: null, title: "Away", authors: [], coverUrl: null }, home: false, holder: { kind: "member", person: ann } }),
    item({ copyId: "c2", book: { isbn: null, title: "Here", authors: [], coverUrl: null } }),
  ] });
  expect(screen.getByText(line("With Ann"))).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Away" })).toHaveAccessibleDescription("With Ann");
  expect(screen.getByRole("link", { name: "Here" })).not.toHaveAccessibleDescription();
});

test("a removed holder reads 'With Sam (no longer a member)'", () => {
  wall({ items: [item({ copyId: "c1", home: false, holder: { kind: "member", person: sam } })] });
  expect(screen.getByText(line("With Sam (no longer a member)"))).toBeInTheDocument();
});

test("Holding reads 'From Ann', or 'No owner' when there is none", () => {
  wall({ kind: "holding", title: "Holding", items: [
    item({ copyId: "c1", owner: ann, home: false }),
    item({ copyId: "c2", owner: null, home: false }),
  ] });
  expect(screen.getByText(line("From Ann"))).toBeInTheDocument();
  expect(screen.getByText(line("No owner"))).toBeInTheDocument();
});

test("Holding names a removed owner as such", () => {
  wall({ kind: "holding", title: "Holding", items: [item({ copyId: "c1", owner: sam, home: false })] });
  expect(screen.getByText(line("From Sam (no longer a member)"))).toBeInTheDocument();
});

test("a placeholder person holding your book reads 'With Grandad'", () => {
  wall({ items: [item({ copyId: "c1", home: false, holder: { kind: "person", id: "p1", name: "Grandad" } })] });
  expect(screen.getByText(line("With Grandad"))).toBeInTheDocument();
});

test("your own collection reads like your wall: 'With Ann' and the lent-out count", () => {
  wall({ kind: "my-collection", title: "Kids", items: [item({ copyId: "c1", home: false, holder: { kind: "member", person: ann } })] });
  expect(screen.getByText(line("With Ann"))).toBeInTheDocument();
  expect(screen.getByText("1 book · 1 lent out")).toBeInTheDocument();
});

test("a friend's collection reads 'Out' and counts books only", () => {
  wall({ kind: "friend-collection", title: "Ann’s shelf", items: [item({ copyId: "c1", home: false, holder: { kind: "member", person: ann } })] });
  expect(screen.getByText(line("Out"))).toBeInTheDocument();
  expect(screen.getByText("1 book")).toBeInTheDocument();
});

test("a friend's wall reads 'Out' when a book is not at home, and nothing when it is", () => {
  wall({ kind: "friend", title: "Ann", items: [
    item({ copyId: "c1", home: false, holder: { kind: "member", person: ann } }),
    item({ copyId: "c2" }),
  ] });
  expect(screen.getAllByText(line("Out"))).toHaveLength(1);
  expect(screen.queryByText(/With/)).toBeNull();
});

// Every entry of a menu, plain and radio, in order.
const entriesOf = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')];

const pressed = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));

test("your wall has All, At home, Lent out and No label toggles and a Collection menu button", () => {
  wall();
  expect(pressed().map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
    ["All", "true"], ["At home", "false"], ["Lent out", "false"], ["No label", "false"],
  ]);
  const menu = screen.getByRole("button", { name: "Collection" });
  expect(menu).toHaveAttribute("aria-haspopup", "menu");
  expect(menu).toHaveAttribute("aria-expanded", "false");
});

test("a friend's wall has All and At home and the menu", () => {
  wall({ kind: "friend", title: "Ann" });
  expect(pressed().map((b) => b.textContent)).toEqual(["All", "At home"]);
  expect(screen.getByRole("button", { name: "Collection" })).toHaveAttribute("aria-haspopup", "menu");
});

test.each<WallKind>(["holding", "my-collection", "friend-collection"])("%s has no chips", (kind) => {
  wall({ kind, title: "T" });
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

test("the pressed chip follows the filter", () => {
  wall({ filter: { status: "out", collectionId: null } });
  expect(screen.getByRole("button", { name: "Lent out" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
});

test("Lent out filters to out; All clears the status and keeps the collection", () => {
  const onFilter = vi.fn();
  const { unmount } = wall({ onFilter });
  fireEvent.click(screen.getByRole("button", { name: "Lent out" }));
  expect(onFilter).toHaveBeenLastCalledWith({ status: "out", collectionId: null });
  unmount();
  wall({ onFilter, filter: { status: "home", collectionId: "k2" } });
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(onFilter).toHaveBeenLastCalledWith({ status: "all", collectionId: "k2" });
});

test("the wall shows only what the filter lets through", () => {
  wall({ filter: { status: "out", collectionId: null }, items: [
    item({ copyId: "c1", book: { isbn: null, title: "Away", authors: [], coverUrl: null }, home: false }),
    item({ copyId: "c2", book: { isbn: null, title: "Here", authors: [], coverUrl: null } }),
  ] });
  expect(screen.getByRole("link", { name: "Away" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Here" })).toBeNull();
});

test("the Collection menu lists All collections, then each collection, and picking one keeps the status", () => {
  const onFilter = vi.fn();
  wall({ onFilter, filter: { status: "home", collectionId: null } });
  const button = screen.getByRole("button", { name: "Collection" });
  fireEvent.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  const menu = screen.getByRole("menu");
  const entries = entriesOf(menu);
  expect(entries.map((e) => e.textContent)).toEqual(["All collections", "Home library", "Kids", "New collection…"]);
  expect(within(menu).getByRole("menuitemradio", { name: "All collections" })).toHaveAttribute("aria-checked", "true");
  expect(entries[0]).toHaveFocus();
  fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Kids" }));
  expect(onFilter).toHaveBeenLastCalledWith({ status: "home", collectionId: "k2" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(button).toHaveFocus();
});

test("your Collection menu ends with New collection…, which calls onNewCollection", () => {
  const onNewCollection = vi.fn();
  wall({ onNewCollection });
  fireEvent.click(screen.getByRole("button", { name: "Collection" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "New collection…" }));
  expect(onNewCollection).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).toBeNull();
});

test("a friend's Collection menu has no New collection… and no Manage link", () => {
  wall({ kind: "friend", title: "Ann", filter: { status: "all", collectionId: "k1" } });
  fireEvent.click(screen.getByRole("button", { name: "Home library" }));
  const menu = screen.getByRole("menu");
  expect(entriesOf(menu).map((e) => e.textContent)).toEqual(["All collections", "Home library", "Kids"]);
});

test("with a collection picked, the button names it and your menu offers Manage {name}", () => {
  wall({ filter: { status: "all", collectionId: "k2" } });
  const button = screen.getByRole("button", { name: "Kids" });
  expect(button).toHaveAttribute("aria-haspopup", "menu");
  fireEvent.click(button);
  expect(screen.getByRole("menuitemradio", { name: "Kids" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("menuitem", { name: "Manage Kids" })).toHaveAttribute("href", "/collections/k2");
});

test("an unknown collection id reads as Collection", () => {
  wall({ filter: { status: "all", collectionId: "gone" } });
  expect(screen.getByRole("button", { name: "Collection" })).toBeInTheDocument();
});

test("Escape and a click outside close the menu", () => {
  wall();
  const button = screen.getByRole("button", { name: "Collection" });
  fireEvent.click(button);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(button);
  fireEvent.pointerDown(screen.getByRole("heading", { level: 1 }));
  expect(screen.queryByRole("menu")).toBeNull();
});

test("Tab closes the menu and leaves focus on the button", () => {
  wall();
  const button = screen.getByRole("button", { name: "Collection" });
  fireEvent.click(button);
  fireEvent.keyDown(entriesOf(screen.getByRole("menu"))[0], { key: "Tab" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(button).toHaveFocus();
});

test("arrow keys move through the menu", () => {
  wall();
  fireEvent.click(screen.getByRole("button", { name: "Collection" }));
  const entries = entriesOf(screen.getByRole("menu"));
  fireEvent.keyDown(entries[0], { key: "ArrowDown" });
  expect(entries[1]).toHaveFocus();
  fireEvent.keyDown(entries[1], { key: "ArrowUp" });
  fireEvent.keyDown(entries[0], { key: "ArrowUp" });
  expect(entries[entries.length - 1]).toHaveFocus();
});

test("a filter that matches nothing says so and offers Show all", () => {
  const onFilter = vi.fn();
  wall({ onFilter, filter: { status: "out", collectionId: null } });
  expect(screen.getByText("No books match.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  expect(onFilter).toHaveBeenLastCalledWith(ALL);
  expect(screen.queryByText("Nothing here yet.")).toBeNull();
});

test("an empty wall shows empty, with no chips, count or rail", () => {
  const { container } = wall({ items: [] });
  expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryByText(/\d+ book/)).toBeNull();
  expect(screen.queryByText("No books match.")).toBeNull();
  expect(container.querySelector(".alpha-rail")).toBeNull();
});

test.each<[string, ShelfItem[], boolean]>([
  ["24 books", many(24), false],
  ["25 books", many(25), true],
  ["25 books under one letter", many(25, "M"), false],
])("the rail shows only past 24 books and two letters: %s", (_name, items, shown) => {
  const { container } = wall({ items });
  expect(container.querySelector(".alpha-rail") !== null).toBe(shown);
});

test("the rail counts what the filter shows", () => {
  const items = many(30).map((it, i) => (i < 20 ? { ...it, home: false } : it));
  const { container } = wall({ items, filter: { status: "out", collectionId: null } satisfies WallFilter });
  expect(container.querySelector(".alpha-rail")).toBeNull();
});

test("picking a letter on the rail scrolls its heading to the top instantly", () => {
  const { container } = wall({ items: many(26) });
  const rail = container.querySelector<HTMLElement>(".alpha-rail")!;
  rail.setPointerCapture = vi.fn();
  rail.getBoundingClientRect = () => ({ top: 0, height: 270, bottom: 270, left: 0, right: 44, width: 44, x: 0, y: 0, toJSON() {} });
  fireEvent.pointerDown(rail, { clientY: 25, pointerId: 1 }); // the third mark, C
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
  expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(document.getElementById("letter-C"));
});

test("while loading it shows nine tile-shaped blocks, hidden, with no images, chips or rail", () => {
  const { container } = wall({ loading: true, items: many(30) });
  expect(screen.getByRole("heading", { level: 1, name: "My books" })).toBeInTheDocument();
  const skeleton = container.querySelector(".wall-skeleton")!;
  expect(skeleton).toHaveAttribute("aria-hidden", "true");
  expect(skeleton.children).toHaveLength(9);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(container.querySelector(".alpha-rail")).toBeNull();
  expect(screen.queryByText(/books ·|^\d+ books?$/)).toBeNull();
});
