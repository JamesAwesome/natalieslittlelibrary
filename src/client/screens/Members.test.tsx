import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import { Members } from "./Members";
import { ann, item, me, natalie, shelfOf, summary } from "./shelfFixtures";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, listMembers: vi.fn(), memberCollections: vi.fn(), getShelf: vi.fn() };
});
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

const beach = summary({ id: "k9", name: "Beach house", count: 1 });
const kids = summary({ id: "k8", name: "Kids", count: 1 });
const annItem = (copyId: string, k: { id: string; name: string }, over = {}) => item({ copyId, owner: ann, holder: { kind: "member", person: ann }, collection: { id: k.id, name: k.name }, ...over });
const covers = () => screen.queryAllByRole("link", { name: /^Book .*, An Author$/ }).map((l) => l.getAttribute("href"));
const line = (t: string) => (_: string, el: Element | null) => el?.tagName === "P" && el.textContent === t;

function annWall(fail?: string) {
  vi.mocked(api.memberCollections).mockResolvedValue({ owner: ann, collections: [beach, kids] });
  vi.mocked(api.getShelf).mockImplementation(async (id) => {
    if (id === fail) throw new api.ApiError(500, null);
    return id === "k9" ? shelfOf(beach, [annItem("x", beach, { home: false })], ann) : shelfOf(kids, [annItem("y", kids)], ann);
  });
}

test("lists other members by name, omitting the signed-in one, each linking to their page", async () => {
  vi.mocked(api.listMembers).mockResolvedValue({ members: [natalie, ann] });
  render(<Members member={me} returnTo="/members" />);
  const link = await screen.findByRole("link", { name: "Ann" });
  expect(link).toHaveAttribute("href", "/members/2");
  expect(link.tagName).toBe("A");
  expect(screen.queryByText("Natalie")).not.toBeInTheDocument();
});

test("a member's page is their wall: every collection read and merged under their name", async () => {
  annWall();
  render(<Members id="2" member={me} returnTo="/members/2" />);
  expect(await screen.findByRole("link", { name: "Book x, An Author" })).toHaveAttribute("href", "/copies/x");
  expect(screen.getByRole("heading", { level: 1, name: "Ann" })).toBeInTheDocument();
  expect(covers()).toEqual(["/copies/x", "/copies/y"]);
  expect(api.memberCollections).toHaveBeenCalledWith("2");
  expect(vi.mocked(api.getShelf).mock.calls.map((c) => c[0]).sort()).toEqual(["k8", "k9"]);
  expect(screen.getByText("2 books")).toBeInTheDocument();
  expect(screen.getByText(line("Out"))).toBeInTheDocument();
  for (const name of ["All", "At home", "Collection"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Lent out" })).not.toBeInTheDocument();
});

test("a friend's Collection ▾ lists their collections and has nothing to manage or create", async () => {
  annWall();
  render(<Members id="2" member={me} returnTo="/members/2" />);
  await userEvent.click(await screen.findByRole("button", { name: "Collection" }));
  expect(screen.getAllByRole("menuitemradio").map((m) => m.textContent)).toEqual(["All collections", "Beach house", "Kids"]);
  expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Kids" }));
  expect(covers()).toEqual(["/copies/y"]);
});

test("coming back to a friend's wall restores the picked collection and the scroll", async () => {
  annWall();
  sessionStorage.setItem(`wall:${location.pathname}`, JSON.stringify({ filter: { status: "all", collectionId: "k8" }, scrollY: 200 }));
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(<Members id="2" member={me} returnTo="/members/2" />);
  expect(await screen.findByRole("button", { name: "Collection: Kids" })).toBeInTheDocument();
  expect(covers()).toEqual(["/copies/y"]);
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 200);
  scrollTo.mockRestore();
});

test("one of a friend's shelves failing shows the rest with an alert and Try again", async () => {
  annWall("k8");
  render(<Members id="2" member={me} returnTo="/members/2" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Some books couldn't load.");
  expect(covers()).toEqual(["/copies/x"]);
  expect(screen.queryByText(/^\d+ books?$/)).not.toBeInTheDocument();
  annWall();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("link", { name: "Book y, An Author" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("one failing shelf beside an empty one shows the alert, not the empty line", async () => {
  vi.mocked(api.memberCollections).mockResolvedValue({ owner: ann, collections: [beach, kids] });
  vi.mocked(api.getShelf).mockImplementation(async (id) => {
    if (id === "k8") throw new api.ApiError(500, null);
    return shelfOf(beach, [], ann);
  });
  render(<Members id="2" member={me} returnTo="/members/2" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Some books couldn't load.");
  expect(screen.queryByText("No books here yet.")).not.toBeInTheDocument();
});

test("every one of a friend's shelves failing is trouble", async () => {
  vi.mocked(api.memberCollections).mockResolvedValue({ owner: ann, collections: [beach] });
  vi.mocked(api.getShelf).mockRejectedValue(new api.ApiError(500, null));
  render(<Members id="2" member={me} returnTo="/members/2" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("having trouble");
});

test("a friend with no collections has an empty wall", async () => {
  vi.mocked(api.memberCollections).mockResolvedValue({ owner: ann, collections: [] });
  render(<Members id="2" member={me} returnTo="/members/2" />);
  expect(await screen.findByText("No books here yet.")).toBeInTheDocument();
  expect(api.getShelf).not.toHaveBeenCalled();
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
  annWall();
  const { rerender } = render(<Members id="2" member={me} returnTo="/members/2" />);
  await screen.findByRole("link", { name: "Book x, An Author" });
  vi.mocked(api.memberCollections).mockReturnValue(new Promise(() => {}));
  rerender(<Members id="3" member={me} returnTo="/members/3" />);
  expect(covers()).toEqual([]);
  expect(screen.queryByRole("heading", { level: 1, name: "Ann" })).not.toBeInTheDocument();
});

test("long unbroken names sit in bdi", async () => {
  vi.mocked(api.listMembers).mockResolvedValue({ members: [{ id: "5", name: "W".repeat(80), pictureUrl: null }] });
  render(<Members member={me} returnTo="/members" />);
  expect((await screen.findByText("W".repeat(80))).tagName).toBe("BDI");
});

test("the list's h1 is Friends and the member page's h1 is the member's name", async () => {
  vi.mocked(api.listMembers).mockResolvedValue({ members: [natalie, ann] });
  const { unmount } = render(<Members member={me} returnTo="/members" />);
  expect(screen.getByRole("heading", { level: 1, name: "Friends" })).toBeInTheDocument();
  await screen.findByRole("link", { name: "Ann" });
  expect(screen.queryByRole("heading", { name: "Friends' shelves" })).not.toBeInTheDocument();
  unmount();
  vi.mocked(api.memberCollections).mockResolvedValue({ owner: ann, collections: [] });
  render(<Members id="2" member={me} returnTo="/members/2" />);
  expect(await screen.findByRole("heading", { level: 1, name: "Ann" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
});

test("signed out, the h1 is the app name", () => {
  render(<Members member={null} returnTo="/members" />);
  expect(screen.getByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
});

test("a lost session turns the h1 into the app name", async () => {
  vi.mocked(api.listMembers).mockRejectedValue(new api.ApiError(401, null));
  render(<Members member={me} returnTo="/members" />);
  expect(await screen.findByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Friends" })).not.toBeInTheDocument();
});

test("a member page's h1 is the app name until the name is known, and when gone or failed", async () => {
  vi.mocked(api.memberCollections).mockReturnValue(new Promise(() => {}));
  const a = render(<Members id="2" member={me} returnTo="/members/2" />);
  expect(screen.getByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
  a.unmount();
  vi.mocked(api.memberCollections).mockRejectedValue(new api.ApiError(404, null));
  render(<Members id="2" member={me} returnTo="/members/2" />);
  await screen.findByText("That member isn't here.");
  expect(screen.getByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
});
