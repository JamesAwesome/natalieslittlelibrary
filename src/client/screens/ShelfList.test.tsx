import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ShelfList } from "./ShelfList";
import { ann, item } from "./shelfFixtures";

test("a row shows cover placeholder, title, authors, status, and links to the copy", () => {
  render(<ShelfList items={[item({ copyId: "c 1", book: { isbn: null, title: "Dune", authors: ["Frank Herbert"], coverUrl: null } })]} viewerId="1" />);
  expect(screen.getByRole("link", { name: "Dune" })).toHaveAttribute("href", "/copies/c%201");
  expect(screen.getByText("Frank Herbert").tagName).toBe("BDI");
  expect(screen.getByText("At home")).toBeInTheDocument();
  expect(screen.queryByText("No label yet")).not.toBeInTheDocument();
});

test("a book that is out says who has it, in bdi", () => {
  render(<ShelfList items={[item({ copyId: "c1", home: false, holder: { kind: "named", name: "Sam" } })]} />);
  expect(screen.getByText("Sam").tagName).toBe("BDI");
  expect(screen.getByText(/^With/)).toBeInTheDocument();
});

test("an unlabelled row the viewer owns offers a label; another's, or no viewer, does not", () => {
  const mine = item({ copyId: "m", labelled: false });
  const theirs = item({ copyId: "t", labelled: false, owner: ann });
  render(<ShelfList items={[mine, theirs]} viewerId="1" />);
  expect(screen.getAllByText("No label yet")).toHaveLength(2);
  const links = screen.getAllByRole("link", { name: "Put a label on it" });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute("href", "/pair?copy=m");
});

test("with no viewer there is no label link", () => {
  render(<ShelfList items={[item({ copyId: "m", labelled: false })]} />);
  expect(screen.queryByRole("link", { name: "Put a label on it" })).not.toBeInTheDocument();
});

test("showOwner names the owner on each row", () => {
  render(<ShelfList items={[item({ copyId: "c1", owner: ann })]} showOwner />);
  expect(screen.getByText("Ann").tagName).toBe("BDI");
  expect(screen.getByText(/^Owned by/)).toBeInTheDocument();
});

test("a forged code on the item is never rendered", () => {
  const forged = { ...item({ copyId: "c1" }), code: "SECRET-CODE-123", labelCode: "SECRET-CODE-123" };
  const { container } = render(<ShelfList items={[forged]} viewerId="1" />);
  expect(container.innerHTML).not.toContain("SECRET-CODE-123");
  expect(container.innerHTML).not.toContain("/b/");
});
