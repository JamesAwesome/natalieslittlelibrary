import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Book, Cover } from "./BookCard";

test("a cover asks for no referrer, so the image host is not told which page it was shown on", () => {
  const { container } = render(<Book title="T" authors={[]} coverUrl="https://books.google.com/books/content?id=abc" />);
  const img = container.querySelector("img.cover");
  expect(img).toHaveAttribute("src", "https://books.google.com/books/content?id=abc");
  expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(screen.getByText("T")).toBeInTheDocument();
});

test("a null cover shows the title tile", () => {
  const { container } = render(<Cover url={null} title="Beowulf" authors={[]} />);
  expect(screen.getByText("Beowulf")).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.queryByText("Cover didn’t load")).toBeNull();
  expect(container.firstElementChild).toHaveAttribute("data-state", "none");
});

test("a cover that fails to load says so", () => {
  const { container } = render(<Cover url="https://example.test/c.jpg" title="Beowulf" authors={["Anon"]} />);
  fireEvent.error(container.querySelector("img")!);
  expect(screen.getByText("Cover didn’t load")).toBeInTheDocument();
  expect(screen.getByText("Beowulf")).toBeInTheDocument();
  expect(container.firstElementChild).toHaveAttribute("data-state", "failed");
});

test("a loaded cover has no tile text", () => {
  const { container } = render(<Cover url="https://example.test/c.jpg" title="Beowulf" authors={["Anon"]} />);
  expect(container.querySelector("img")).not.toBeNull();
  expect(screen.queryByText("Beowulf")).toBeNull();
  expect(screen.queryByText("Cover didn’t load")).toBeNull();
  expect(container.firstElementChild).toHaveAttribute("data-state", "loaded");
});

test("the cover is hidden from assistive tech", () => {
  const { container } = render(<Cover url={null} title="Beowulf" authors={[]} />);
  expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
});

test("a hero cover asks for the larger image and falls back to the stored one before showing the failed tile", () => {
  const stored = "https://covers.openlibrary.org/b/isbn/9780141439518-M.jpg";
  const { container } = render(<Cover url={stored} title="T" authors={[]} size="hero" />);
  const img = () => container.querySelector("img")!;
  expect(img()).toHaveAttribute("src", "https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg");
  fireEvent.error(img());
  expect(img()).toHaveAttribute("src", stored);
  expect(container.firstElementChild).toHaveAttribute("data-state", "loaded");
  fireEvent.error(img());
  expect(container.querySelector("img")).toBeNull();
  expect(container.firstElementChild).toHaveAttribute("data-state", "failed");
});

test("wall and row covers use the stored URL as is", () => {
  const stored = "https://covers.openlibrary.org/b/isbn/9780141439518-M.jpg";
  const { container } = render(<Cover url={stored} title="T" authors={[]} size="row" />);
  expect(container.querySelector("img")).toHaveAttribute("src", stored);
});
