import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TabBar } from "./TabBar";

const hrefs = [["Books", "/"], ["Holding", "/holding"], ["Pair", "/pair"], ["Friends", "/members"], ["More", "/more"]] as const;

test("five links in order, with their addresses", () => {
  render(<TabBar active={null} />);
  const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
  expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual(hrefs.map(([a, b]) => [a, b]));
});

test("only the active tab is current", () => {
  render(<TabBar active="friends" />);
  const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
  expect(current.map((l) => l.textContent)).toEqual(["Friends"]);
});

test("Pair can be the current tab", () => {
  render(<TabBar active="pair" />);
  const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
  expect(current.map((l) => l.textContent)).toEqual(["Pair"]);
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

// Fires a click and reports whether the page's own handler took it over.
function tap(name: string, init: MouseEventInit = {}, type: "click" | "auxclick" = "click") {
  const link = screen.getByRole("link", { name });
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  fireEvent(link, ev);
  return ev.defaultPrevented;
}

let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
  scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
});
afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

test("tapping Books on / scrolls to the top and doesn't navigate", () => {
  history.replaceState(null, "", "/");
  render(<TabBar active="books" />);
  expect(tap("Books")).toBe(true);
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
});

test("tapping the active tab away from its own page navigates", () => {
  history.replaceState(null, "", "/collections/k1");
  render(<TabBar active="books" />);
  expect(tap("Books")).toBe(false);
  expect(scrollTo).not.toHaveBeenCalled();
});

test("a modified or middle click opens normally", () => {
  history.replaceState(null, "", "/");
  render(<TabBar active="books" />);
  for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    expect(tap("Books", init)).toBe(false);
  }
  expect(tap("Books", { button: 1 }, "auxclick")).toBe(false);
  expect(scrollTo).not.toHaveBeenCalled();
});

test("tapping a tab that isn't active navigates", () => {
  history.replaceState(null, "", "/");
  render(<TabBar active="books" />);
  expect(tap("Holding")).toBe(false);
  expect(scrollTo).not.toHaveBeenCalled();
});

test("reduced motion scrolls instantly", () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" }));
  render(<TabBar active="books" />);
  tap("Books");
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
});

test("with no reduced-motion preference it scrolls smoothly", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  render(<TabBar active="books" />);
  tap("Books");
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
});
