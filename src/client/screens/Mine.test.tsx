import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import { Mine } from "./Mine";
import { item, me, shelfOf, summary } from "./shelfFixtures";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, myCollections: vi.fn(), getShelf: vi.fn(), createCollection: vi.fn() };
});
beforeEach(() => vi.resetAllMocks());

const home = summary({ id: "k1", name: "Home library", isDefault: true, count: 2, unlabelled: 1 });
const beach = summary({ id: "k2", name: "Beach house", count: 1 });
const homeItems = [item({ copyId: "a" }), item({ copyId: "b", labelled: false })];
const beachItems = [item({ copyId: "c" })];

function setup(collections = [home, beach]) {
  vi.mocked(api.myCollections).mockResolvedValue({ owner: { id: "1", name: "Natalie", pictureUrl: null }, collections });
  vi.mocked(api.getShelf).mockImplementation(async (id) =>
    id === "k1" ? shelfOf(home, homeItems) : shelfOf(beach, beachItems));
}
const show = () => render(<Mine member={me} returnTo="/mine" />);

test("groups collections in order with counts, headings link to shelves", async () => {
  setup();
  show();
  const headings = await screen.findAllByRole("heading", { level: 3 });
  expect(headings.map((h) => h.textContent)).toEqual(["Home library", "Beach house", "New collection"]);
  expect(within(headings[0]).getByRole("link")).toHaveAttribute("href", "/collections/k1");
  expect(screen.getByText("1 without a label")).toBeInTheDocument();
  expect(screen.getByText("2 books")).toBeInTheDocument();
  expect(screen.getByText("1 book")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /^Book / })).toHaveLength(3);
  expect(screen.getByRole("link", { name: "Put a label on it" })).toHaveAttribute("href", "/pair?copy=b");
});

test("the unlabelled toggle filters every group", async () => {
  setup();
  show();
  await screen.findByText("Beach house");
  await userEvent.click(screen.getByRole("checkbox", { name: "Show only books without a label" }));
  expect(screen.getAllByRole("link", { name: /^Book / }).map((l) => l.textContent)).toEqual(["Book b"]);
  await userEvent.click(screen.getByRole("checkbox"));
  expect(screen.getAllByRole("link", { name: /^Book / })).toHaveLength(3);
});

test("no collections: the empty message with pair and import links", async () => {
  setup([]);
  show();
  expect(await screen.findByText(/No books yet\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pair a book" })).toHaveAttribute("href", "/pair");
  expect(screen.getByRole("link", { name: "import from StoryGraph" })).toHaveAttribute("href", "/import");
  expect(screen.getByRole("heading", { name: "New collection" })).toBeInTheDocument();
});

test("a collection that vanished between reads is left out, not an error", async () => {
  setup();
  vi.mocked(api.getShelf).mockImplementation(async (id) => {
    if (id === "k2") throw new api.ApiError(404, null);
    return shelfOf(home, homeItems);
  });
  show();
  await screen.findByText("Home library");
  expect(screen.queryByText("Beach house")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("creating a collection sends one request, trimmed, and re-reads", async () => {
  setup();
  vi.mocked(api.createCollection).mockResolvedValue(summary({ id: "k3", name: "Cabin" }));
  show();
  await screen.findByText("Beach house");
  await userEvent.type(screen.getByLabelText("Name"), "  Cabin ");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(api.createCollection).toHaveBeenCalledExactlyOnceWith("Cabin");
  await waitFor(() => expect(api.myCollections).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Name")).toHaveValue("");
});

test("a double tap sends one request", async () => {
  setup();
  let finish: (v: ReturnType<typeof summary>) => void = () => {};
  vi.mocked(api.createCollection).mockReturnValue(new Promise((r) => { finish = r; }));
  show();
  await screen.findByText("Beach house");
  await userEvent.type(screen.getByLabelText("Name"), "Cabin");
  const button = screen.getByRole("button", { name: "Create" });
  await act(async () => {
    button.click();
    button.click();
  });
  expect(api.createCollection).toHaveBeenCalledTimes(1);
  await act(async () => finish(summary({ id: "k3", name: "Cabin" })));
});

test("name-taken shows its message and re-reads the list", async () => {
  setup();
  vi.mocked(api.createCollection).mockRejectedValue(new api.ApiError(409, "name-taken"));
  show();
  await screen.findByText("Beach house");
  await userEvent.type(screen.getByLabelText("Name"), "beach HOUSE");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByText("You already have a collection called that.")).toBeInTheDocument();
  await waitFor(() => expect(api.myCollections).toHaveBeenCalledTimes(2));
});

test("an invalid name is stopped before any request", async () => {
  setup();
  show();
  await screen.findByText("Beach house");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(api.createCollection).not.toHaveBeenCalled();
});

test("a 401 while creating shows sign-in with no stale controls", async () => {
  setup();
  vi.mocked(api.createCollection).mockRejectedValue(new api.ApiError(401, null));
  show();
  await screen.findByText("Beach house");
  await userEvent.type(screen.getByLabelText("Name"), "Cabin");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fmine");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText("Beach house")).not.toBeInTheDocument();
});

test("a 401 on load, and a 401 on the re-read after a refusal, show sign-in", async () => {
  vi.mocked(api.myCollections).mockRejectedValue(new api.ApiError(401, null));
  show();
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("a 401 on the re-read after name-taken shows sign-in", async () => {
  setup();
  vi.mocked(api.createCollection).mockRejectedValue(new api.ApiError(409, "name-taken"));
  show();
  await screen.findByText("Beach house");
  vi.mocked(api.myCollections).mockRejectedValue(new api.ApiError(401, null));
  await userEvent.type(screen.getByLabelText("Name"), "Cabin");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("signed out: only the sign-in link", () => {
  show_(null);
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(api.myCollections).not.toHaveBeenCalled();
});
function show_(m: typeof me | null) { render(<Mine member={m} returnTo="/mine" />); }

test("collection names render in bdi", async () => {
  const long = summary({ id: "k2", name: "W".repeat(70), count: 0 });
  vi.mocked(api.myCollections).mockResolvedValue({ owner: { id: "1", name: "Natalie", pictureUrl: null }, collections: [long] });
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(long, []));
  show();
  expect((await screen.findByText("W".repeat(70))).tagName).toBe("BDI");
});

test("a group's heading and count come from its own shelf read, not the summary", async () => {
  setup();
  const fresh = summary({ id: "k2", name: "Beach cabin", count: 3, unlabelled: 2 });
  vi.mocked(api.getShelf).mockImplementation(async (id) =>
    id === "k1" ? shelfOf(home, homeItems) : shelfOf(fresh, [item({ copyId: "x" }), item({ copyId: "y" }), item({ copyId: "z" })]));
  show();
  expect(await screen.findByRole("link", { name: "Beach cabin" })).toBeInTheDocument();
  expect(screen.queryByText("Beach house")).not.toBeInTheDocument();
  expect(screen.getByText("3 books")).toBeInTheDocument();
  expect(screen.getByText("2 without a label")).toBeInTheDocument();
});

test("one failing shelf shows trouble for that group only, the others stay, and Try again re-reads", async () => {
  setup();
  vi.mocked(api.getShelf).mockImplementation(async (id) => {
    if (id === "k2") throw new api.ApiError(500, null);
    return shelfOf(home, homeItems);
  });
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("having trouble");
  expect(screen.getByRole("link", { name: "Book a" })).toBeInTheDocument();
  expect(screen.getByText("Beach house").tagName).toBe("BDI");
  vi.mocked(api.getShelf).mockImplementation(async (id) => (id === "k1" ? shelfOf(home, homeItems) : shelfOf(beach, beachItems)));
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("link", { name: "Book c" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a 401 on any one shelf goes to sign-in", async () => {
  setup();
  vi.mocked(api.getShelf).mockImplementation(async (id) => {
    if (id === "k2") throw new api.ApiError(401, null);
    return shelfOf(home, homeItems);
  });
  show();
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByText("Home library")).not.toBeInTheDocument();
});

test("a 404 from myCollections is trouble, not 'No books yet'", async () => {
  vi.mocked(api.myCollections).mockRejectedValue(new api.ApiError(404, null));
  show();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText(/No books yet/)).not.toBeInTheDocument();
});
