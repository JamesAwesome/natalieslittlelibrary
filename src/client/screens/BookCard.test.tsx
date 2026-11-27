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

const stored = "https://covers.openlibrary.org/b/id/12345-M.jpg";
const larger = "https://covers.openlibrary.org/b/id/12345-L.jpg?default=false";
const loadWith = (img: Element, naturalWidth: number) => {
  Object.defineProperty(img, "naturalWidth", { value: naturalWidth, configurable: true });
  fireEvent.load(img);
};

test("a hero cover asks for the larger image and falls back to the stored one before showing the failed tile", () => {
  const { container } = render(<Cover url={stored} title="T" authors={[]} size="hero" />);
  const img = () => container.querySelector("img")!;
  expect(img()).toHaveAttribute("src", larger);
  fireEvent.error(img());
  expect(img()).toHaveAttribute("src", stored);
  expect(container.firstElementChild).toHaveAttribute("data-state", "loaded");
  fireEvent.error(img());
  expect(container.querySelector("img")).toBeNull();
  expect(container.firstElementChild).toHaveAttribute("data-state", "failed");
});

test("wall and row covers use the stored URL as is", () => {
  for (const size of ["wall", "row"] as const) {
    const { container, unmount } = render(<Cover url={stored} title="T" authors={[]} size={size} />);
    expect(container.querySelector("img")).toHaveAttribute("src", stored);
    unmount();
  }
});

test("the image carries width and height, so its box is reserved before it loads", () => {
  const { container } = render(<Cover url={stored} title="T" authors={[]} size="row" />);
  expect(container.querySelector("img")).toHaveAttribute("width", "64");
  expect(container.querySelector("img")).toHaveAttribute("height", "96");
});

test("a 1x1 placeholder answered with 200 counts as a failed load", () => {
  const { container } = render(<Cover url={stored} title="T" authors={[]} size="wall" />);
  loadWith(container.querySelector("img")!, 1);
  expect(container.firstElementChild).toHaveAttribute("data-state", "failed");
  expect(screen.getByText("Cover didn’t load")).toBeInTheDocument();
});

test("a blank larger hero image falls back to the stored one", () => {
  const { container } = render(<Cover url={stored} title="T" authors={[]} size="hero" />);
  loadWith(container.querySelector("img")!, 1);
  expect(container.querySelector("img")).toHaveAttribute("src", stored);
  loadWith(container.querySelector("img")!, 180);
  expect(container.firstElementChild).toHaveAttribute("data-state", "loaded");
  expect(container.firstElementChild).toHaveAttribute("data-ready");
});

test("a new url starts over: a failure does not stick, and a hero asks for the larger image again", () => {
  const { container, rerender } = render(<Cover url="https://example.test/a.jpg" title="A" authors={[]} size="hero" />);
  fireEvent.error(container.querySelector("img")!);
  expect(container.firstElementChild).toHaveAttribute("data-state", "failed");
  rerender(<Cover url={stored} title="B" authors={[]} size="hero" />);
  expect(container.firstElementChild).toHaveAttribute("data-state", "loaded");
  expect(container.querySelector("img")).toHaveAttribute("src", larger);
  fireEvent.error(container.querySelector("img")!);
  rerender(<Cover url="https://covers.openlibrary.org/b/id/999-M.jpg" title="C" authors={[]} size="hero" />);
  expect(container.querySelector("img")).toHaveAttribute("src", "https://covers.openlibrary.org/b/id/999-L.jpg?default=false");
});

test("the no-cover tile shows the title and the first author only", () => {
  const { container } = render(<Cover url={null} title="Beowulf" authors={["Anon", "Second"]} />);
  expect(container.querySelector(".cover-tile-title")).toHaveTextContent("Beowulf");
  expect(container.querySelector(".cover-tile-author")).toHaveTextContent("Anon");
  expect(screen.queryByText("Second")).toBeNull();
});

test("Book's title is an h2 unless asked for an h1", () => {
  const { rerender } = render(<Book title="Dune" authors={[]} coverUrl={null} />);
  expect(screen.getByRole("heading", { level: 2, name: "Dune" })).toBeInTheDocument();
  rerender(<Book title="Dune" authors={[]} coverUrl={null} headingLevel={1} />);
  expect(screen.getByRole("heading", { level: 1, name: "Dune" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
});
