import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import { Members } from "./Members";
import { ann, me, natalie, summary } from "./shelfFixtures";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, listMembers: vi.fn(), memberCollections: vi.fn() };
});
beforeEach(() => vi.resetAllMocks());

test("lists other members by name, omitting the signed-in one, each linking to their page", async () => {
  vi.mocked(api.listMembers).mockResolvedValue({ members: [natalie, ann] });
  render(<Members member={me} returnTo="/members" />);
  const link = await screen.findByRole("link", { name: "Ann" });
  expect(link).toHaveAttribute("href", "/members/2");
  expect(link.tagName).toBe("A");
  expect(screen.queryByText("Natalie")).not.toBeInTheDocument();
});

test("a member's page lists their collections linking to shelves", async () => {
  vi.mocked(api.memberCollections).mockResolvedValue({ owner: ann, collections: [summary({ id: "k9", name: "Beach house", count: 3 })] });
  render(<Members id="2" member={me} returnTo="/members/2" />);
  expect(await screen.findByRole("link", { name: "Beach house" })).toHaveAttribute("href", "/collections/k9");
  expect(screen.getByText("3 books")).toBeInTheDocument();
  expect(api.memberCollections).toHaveBeenCalledWith("2");
});

test("a removed or unknown member shows not-found, not an error", async () => {
  vi.mocked(api.memberCollections).mockRejectedValue(new api.ApiError(404, null));
  render(<Members id="2" member={me} returnTo="/members/2" />);
  expect(await screen.findByText("That member isn't here.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to my books" })).toHaveAttribute("href", "/");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("signed out: only the sign-in link", () => {
  render(<Members member={null} returnTo="/members" />);
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link")).toHaveAttribute("href", "/auth/login?returnTo=%2Fmembers");
});

test("a 401 on load shows sign-in", async () => {
  vi.mocked(api.listMembers).mockRejectedValue(new api.ApiError(401, null));
  render(<Members member={me} returnTo="/members" />);
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("navigating to another member starts from nothing", async () => {
  vi.mocked(api.memberCollections).mockResolvedValueOnce({ owner: ann, collections: [summary({ id: "k9", name: "Beach house" })] });
  const { rerender } = render(<Members id="2" member={me} returnTo="/members/2" />);
  await screen.findByText("Beach house");
  vi.mocked(api.memberCollections).mockReturnValue(new Promise(() => {}));
  rerender(<Members id="3" member={me} returnTo="/members/3" />);
  expect(screen.queryByText("Beach house")).not.toBeInTheDocument();
});

test("long unbroken names sit in bdi", async () => {
  vi.mocked(api.listMembers).mockResolvedValue({ members: [{ id: "5", name: "W".repeat(80), pictureUrl: null }] });
  render(<Members member={me} returnTo="/members" />);
  expect((await screen.findByText("W".repeat(80))).tagName).toBe("BDI");
});
