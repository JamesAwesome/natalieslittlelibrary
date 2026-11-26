import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Book } from "./BookCard";

test("a cover asks for no referrer, so the image host is not told which page it was shown on", () => {
  const { container } = render(<Book title="T" authors={[]} coverUrl="https://books.google.com/books/content?id=abc" />);
  const img = container.querySelector("img.cover");
  expect(img).toHaveAttribute("src", "https://books.google.com/books/content?id=abc");
  expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(screen.getByText("T")).toBeInTheDocument();
});
