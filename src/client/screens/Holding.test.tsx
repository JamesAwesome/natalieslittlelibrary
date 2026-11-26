import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import { Holding } from "./Holding";
import { ann, item, me } from "./shelfFixtures";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, getHolding: vi.fn() };
});
beforeEach(() => vi.resetAllMocks());

test("shows each book with its owner", async () => {
  vi.mocked(api.getHolding).mockResolvedValue({ items: [item({ copyId: "c1", owner: ann, home: false, holder: { kind: "member", person: { id: "1", name: "Natalie", pictureUrl: null } } })] });
  render(<Holding member={me} returnTo="/holding" />);
  expect(await screen.findByText("Ann")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Book c1" })).toHaveAttribute("href", "/copies/c1");
});

test("empty", async () => {
  vi.mocked(api.getHolding).mockResolvedValue({ items: [] });
  render(<Holding member={me} returnTo="/holding" />);
  expect(await screen.findByText("You're not holding anyone else's books.")).toBeInTheDocument();
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
  expect(await screen.findByText("No owner")).toBeInTheDocument();
});
