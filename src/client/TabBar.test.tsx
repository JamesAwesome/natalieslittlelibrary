import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { TabBar } from "./TabBar";

const hrefs = [["Books", "/"], ["Holding", "/holding"], ["Friends", "/members"], ["More", "/more"]] as const;

test("four links in order, with their addresses", () => {
  render(<TabBar active={null} />);
  const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
  expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual(hrefs.map(([a, b]) => [a, b]));
});

test("only the active tab is current", () => {
  render(<TabBar active="friends" />);
  const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
  expect(current.map((l) => l.textContent)).toEqual(["Friends"]);
});

test("none is current when active is null", () => {
  render(<TabBar active={null} />);
  for (const l of screen.getAllByRole("link")) expect(l).not.toHaveAttribute("aria-current");
});

test("each icon is an inline svg hidden from assistive technology", () => {
  render(<TabBar active="books" />);
  for (const l of screen.getAllByRole("link")) {
    const svg = l.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  }
});

test("the bar is app chrome, so it does not print", () => {
  render(<TabBar active={null} />);
  expect(screen.getByRole("navigation", { name: "Main" })).toHaveClass("tab-bar", "app-chrome");
});
