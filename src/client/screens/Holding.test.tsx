import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import { Holding } from "./Holding";
import { ann, item, me } from "./shelfFixtures";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, getHolding: vi.fn() };
});
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
});

// A note line holds a <bdi> name, so match on the paragraph's whole text.
const line = (t: string) => (_: string, el: Element | null) => el?.tagName === "P" && el.textContent === t;
const removed = { id: "3", name: "Sam", pictureUrl: null, removed: true as const };

test("a wall of what I hold, each cover saying whose it is", async () => {
  vi.mocked(api.getHolding).mockResolvedValue({ items: [
    item({ copyId: "c1", owner: ann, home: false, holder: { kind: "member", person: { id: "1", name: "Natalie", pictureUrl: null } } }),
    item({ copyId: "c2", owner: removed, home: false }),
  ] });
  render(<Holding member={me} returnTo="/holding" />);
  expect(await screen.findByRole("link", { name: "Book c1, An Author" })).toHaveAttribute("href", "/copies/c1");
  expect(screen.getByText(line("From Ann"))).toBeInTheDocument();
  expect(screen.getByText(line("From Sam (no longer a member)"))).toBeInTheDocument();
  expect(screen.getByText("2 books")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("empty", async () => {
  vi.mocked(api.getHolding).mockResolvedValue({ items: [] });
  render(<Holding member={me} returnTo="/holding" />);
  expect(await screen.findByText("You aren’t holding anyone’s books.")).toBeInTheDocument();
});

test("signed out: only the sign-in link back to the page, and nothing is fetched", () => {
  render(<Holding member={null} returnTo="/holding" />);
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fholding");
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(api.getHolding).not.toHaveBeenCalled();
});

test("a 401 on load shows sign-in", async () => {
  vi.mocked(api.getHolding).mockRejectedValue(new api.ApiError(401, null));
  render(<Holding member={me} returnTo="/holding" />);
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("a failure shows trouble with a retry", async () => {
  vi.mocked(api.getHolding).mockRejectedValue(new api.ApiError(500, null));
  render(<Holding member={me} returnTo="/holding" />);
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("an ownerless copy says No owner", async () => {
  vi.mocked(api.getHolding).mockResolvedValue({ items: [item({ copyId: "c9", owner: null, collection: null })] });
  render(<Holding member={me} returnTo="/holding" />);
  expect(await screen.findByText(line("No owner"))).toBeInTheDocument();
});

test("the h1 is Holding, with no What I'm holding heading", async () => {
  vi.mocked(api.getHolding).mockResolvedValue({ items: [] });
  render(<Holding member={me} returnTo="/holding" />);
  expect(screen.getByRole("heading", { level: 1, name: "Holding" })).toBeInTheDocument();
  await screen.findByText("You aren’t holding anyone’s books.");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: "What I'm holding" })).not.toBeInTheDocument();
});

test("a failed load keeps the Holding title; signed out uses the app name", async () => {
  vi.mocked(api.getHolding).mockRejectedValue(new Error("boom"));
  const { unmount } = render(<Holding member={me} returnTo="/holding" />);
  await screen.findByRole("button", { name: /try again/i });
  expect(screen.getByRole("heading", { level: 1, name: "Holding" })).toBeInTheDocument();
  unmount();
  render(<Holding member={null} returnTo="/holding" />);
  expect(screen.getByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
});

test("a lost session turns the h1 into the app name", async () => {
  vi.mocked(api.getHolding).mockRejectedValue(new api.ApiError(401, null));
  render(<Holding member={me} returnTo="/holding" />);
  expect(await screen.findByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Holding" })).not.toBeInTheDocument();
});
