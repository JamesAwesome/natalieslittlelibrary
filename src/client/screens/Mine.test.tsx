import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import { Mine } from "./Mine";
import { ann, item, me, shelfOf, summary } from "./shelfFixtures";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, listRequests: vi.fn(), approveRequest: vi.fn(), declineRequest: vi.fn(), myCollections: vi.fn(), getShelf: vi.fn(), createCollection: vi.fn() };
});
beforeEach(() => {
  vi.resetAllMocks();
  // The wall saves its chips per path as it unmounts; each test starts with none.
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

const home = summary({ id: "k1", name: "Home library", isDefault: true, count: 2, unlabelled: 1 });
const beach = summary({ id: "k2", name: "Beach house", count: 1 });
const homeItems = [item({ copyId: "a" }), item({ copyId: "b", labelled: false })];
const beachItems = [item({ copyId: "c", collection: { id: "k2", name: "Beach house" }, home: false, holder: { kind: "member", person: ann } })];

// A cover's link is named by its title, then its authors.
const book = (id: string) => ({ name: `Book ${id}, An Author` });
const covers = () => screen.queryAllByRole("link", { name: /^Book .*, An Author$/ }).map((l) => l.getAttribute("href"));

function setup(collections = [home, beach]) {
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [] });
  vi.mocked(api.myCollections).mockResolvedValue({ owner: { id: "1", name: "Natalie", pictureUrl: null }, collections });
  vi.mocked(api.getShelf).mockImplementation(async (id) =>
    id === "k1" ? shelfOf(home, homeItems) : shelfOf(beach, beachItems));
}
const show = () => render(<Mine member={me} returnTo="/mine" />);

// The create form is behind Collection ▾ → New collection…
async function openCreate() {
  await userEvent.click(await screen.findByRole("button", { name: "Collection" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "New collection…" }));
}

test("/ shows My books as a wall of every collection's covers, merged", async () => {
  setup();
  show();
  expect(await screen.findByRole("link", book("c"))).toHaveAttribute("href", "/copies/c");
  expect(screen.getByRole("heading", { level: 1, name: "My books" })).toBeInTheDocument();
  expect(covers()).toEqual(["/copies/a", "/copies/b", "/copies/c"]);
  expect(screen.getByText("3 books · 1 lent out")).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "With Ann")).toBeInTheDocument();
  for (const name of ["All", "At home", "Lent out", "No label"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  expect(api.getShelf).toHaveBeenCalledTimes(2);
});

test("the No label chip replaces the old toggle", async () => {
  setup();
  show();
  await screen.findByRole("link", book("c"));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "No label" }));
  expect(covers()).toEqual(["/copies/b"]);
});

test("Collection ▾ lists my collections and Manage goes to the picked one's page", async () => {
  setup();
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Collection" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: "Beach house" }));
  expect(covers()).toEqual(["/copies/c"]);
  await userEvent.click(screen.getByRole("button", { name: "Collection: Beach house" }));
  expect(screen.getByRole("menuitem", { name: "Manage Beach house" })).toHaveAttribute("href", "/collections/k2");
});

test("the wall waits for the requests read, so the bar never shifts the covers after they land", async () => {
  setup();
  let answer: (v: { requests: never[] }) => void = () => {};
  vi.mocked(api.listRequests).mockReturnValue(new Promise((r) => { answer = r; }));
  show();
  await waitFor(() => expect(api.getShelf).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(covers()).toEqual([]);
  expect(screen.getByRole("heading", { level: 1, name: "My books" })).toBeInTheDocument();
  await act(async () => answer({ requests: [] }));
  expect(covers()).toHaveLength(3);
});

test("coming back restores the chips and scroll once the wall, requests and all, has loaded", async () => {
  setup();
  sessionStorage.setItem(`wall:${location.pathname}`, JSON.stringify({ filter: { status: "all", collectionId: "k2" }, scrollY: 300 }));
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  let answer: (v: { requests: never[] }) => void = () => {};
  vi.mocked(api.listRequests).mockReturnValue(new Promise((r) => { answer = r; }));
  show();
  await waitFor(() => expect(api.getShelf).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(scrollTo).not.toHaveBeenCalled();
  await act(async () => answer({ requests: [] }));
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 300);
  expect(screen.getByRole("button", { name: "Collection: Beach house" })).toBeInTheDocument();
  expect(covers()).toEqual(["/copies/c"]);
  scrollTo.mockRestore();
});

test("no collections: the empty line with pair, import, friends and holding links", async () => {
  setup([]);
  show();
  expect(await screen.findByText("You haven’t added any books yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pair a book" })).toHaveAttribute("href", "/pair");
  expect(screen.getByRole("link", { name: "Import from StoryGraph" })).toHaveAttribute("href", "/import");
  expect(screen.getByRole("link", { name: "Friends" })).toHaveAttribute("href", "/members");
  expect(screen.getByRole("link", { name: "Holding" })).toHaveAttribute("href", "/holding");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("collections with no books in them are the same empty wall", async () => {
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [] });
  vi.mocked(api.myCollections).mockResolvedValue({ owner: { id: "1", name: "Natalie", pictureUrl: null }, collections: [home] });
  vi.mocked(api.getShelf).mockResolvedValue(shelfOf(home, []));
  show();
  expect(await screen.findByText("You haven’t added any books yet.")).toBeInTheDocument();
});

test("a collection that vanished between reads is left out, not an error", async () => {
  setup();
  vi.mocked(api.getShelf).mockImplementation(async (id) => {
    if (id === "k2") throw new api.ApiError(404, null);
    return shelfOf(home, homeItems);
  });
  show();
  await screen.findByRole("link", book("a"));
  expect(covers()).toEqual(["/copies/a", "/copies/b"]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("2 books")).toBeInTheDocument();
});

test("one failing shelf: the rest show, with an alert and Try again and no count line", async () => {
  setup();
  vi.mocked(api.getShelf).mockImplementation(async (id) => {
    if (id === "k2") throw new api.ApiError(500, null);
    return shelfOf(home, homeItems);
  });
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("Some books couldn't load.");
  expect(covers()).toEqual(["/copies/a", "/copies/b"]);
  expect(screen.queryByText(/^\d+ books?/)).not.toBeInTheDocument();
  vi.mocked(api.getShelf).mockImplementation(async (id) => (id === "k1" ? shelfOf(home, homeItems) : shelfOf(beach, beachItems)));
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("link", book("c"))).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("3 books · 1 lent out")).toBeInTheDocument();
});

test("one failing shelf beside an empty one doesn't claim there are no books", async () => {
  setup();
  vi.mocked(api.getShelf).mockImplementation(async (id) => {
    if (id === "k2") throw new api.ApiError(500, null);
    return shelfOf(home, []);
  });
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("Some books couldn't load.");
  expect(screen.queryByText("You haven’t added any books yet.")).not.toBeInTheDocument();
});

test("every shelf failing is trouble", async () => {
  setup();
  vi.mocked(api.getShelf).mockRejectedValue(new api.ApiError(500, null));
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("having trouble");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("a 401 on any one shelf goes to sign-in", async () => {
  setup();
  vi.mocked(api.getShelf).mockImplementation(async (id) => {
    if (id === "k2") throw new api.ApiError(401, null);
    return shelfOf(home, homeItems);
  });
  show();
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(covers()).toEqual([]);
});

test("a 404 from myCollections is trouble, not the empty wall", async () => {
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [] });
  vi.mocked(api.myCollections).mockRejectedValue(new api.ApiError(404, null));
  show();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("You haven’t added any books yet.")).not.toBeInTheDocument();
});

test("New collection… reveals the create form and puts the cursor in it", async () => {
  setup();
  show();
  expect(await screen.findByRole("link", book("c"))).toBeInTheDocument();
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  await openCreate();
  expect(screen.getByRole("heading", { level: 2, name: "New collection" })).toBeInTheDocument();
  expect(screen.getByLabelText("Name")).toHaveFocus();
});

test("creating a collection sends one request, trimmed, and re-reads", async () => {
  setup();
  vi.mocked(api.createCollection).mockResolvedValue(summary({ id: "k3", name: "Cabin" }));
  show();
  await openCreate();
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
  await openCreate();
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
  await openCreate();
  await userEvent.type(screen.getByLabelText("Name"), "beach HOUSE");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByText("You already have a collection called that.")).toBeInTheDocument();
  await waitFor(() => expect(api.myCollections).toHaveBeenCalledTimes(2));
});

test("an invalid name is stopped before any request", async () => {
  setup();
  show();
  await openCreate();
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("A collection name is 1 to 60 characters, with no control characters.");
  expect(api.createCollection).not.toHaveBeenCalled();
});

test("any other failure says something went wrong", async () => {
  setup();
  vi.mocked(api.createCollection).mockRejectedValue(new api.ApiError(500, null));
  show();
  await openCreate();
  await userEvent.type(screen.getByLabelText("Name"), "Cabin");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
});

test("a 401 while creating shows sign-in with no stale controls", async () => {
  setup();
  vi.mocked(api.createCollection).mockRejectedValue(new api.ApiError(401, null));
  show();
  await openCreate();
  await userEvent.type(screen.getByLabelText("Name"), "Cabin");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fmine");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(covers()).toEqual([]);
});

test("a 401 on load shows sign-in", async () => {
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [] });
  vi.mocked(api.myCollections).mockRejectedValue(new api.ApiError(401, null));
  show();
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("a 401 on the re-read after name-taken shows sign-in", async () => {
  setup();
  vi.mocked(api.createCollection).mockRejectedValue(new api.ApiError(409, "name-taken"));
  show();
  await openCreate();
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

const ask = { copyId: "r1", book: { isbn: null, title: "Wanted", authors: [], coverUrl: null }, by: { id: "2", name: "Ann", pictureUrl: null }, at: 1 };
const asked = (t: string) => (_: string, el: Element | null) => el?.tagName === "P" && el.textContent === t;

// The bar opens the list; Approve asks first, and the second Approve is the confirmation.
async function openRequests() {
  await userEvent.click(await screen.findByRole("button", { name: /^\d+ requests?$/ }));
}
async function approve() {
  await openRequests();
  await userEvent.click(screen.getByRole("button", { name: "Approve" }));
  await userEvent.click(screen.getByRole("button", { name: "Approve" }));
}

test("open requests show as a bar between the title and the chips, and it opens the list", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [ask] });
  show();
  const bar = await screen.findByRole("button", { name: "1 request" });
  expect(bar).toHaveAttribute("aria-expanded", "false");
  const title = screen.getByRole("heading", { level: 1, name: "My books" });
  const chip = screen.getByRole("button", { name: "All" });
  expect(title.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(bar.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  await userEvent.click(bar);
  expect(bar).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: "Wanted" })).toHaveAttribute("href", "/copies/r1");
  expect(screen.getByText(asked("Ann asked to keep this"))).toBeInTheDocument();
  await userEvent.click(bar);
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
});

test("two requests say so", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [ask, { ...ask, copyId: "r2" }] });
  show();
  expect(await screen.findByRole("button", { name: "2 requests" })).toBeInTheDocument();
});

test("no requests, no bar", async () => {
  setup();
  show();
  await screen.findByRole("link", book("c"));
  expect(screen.queryByRole("button", { name: /request/ })).not.toBeInTheDocument();
});

test("approving asks first, then answers in place", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValueOnce({ requests: [ask] }).mockResolvedValue({ requests: [] });
  vi.mocked(api.approveRequest).mockResolvedValue({} as never);
  show();
  await openRequests();
  await userEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect(screen.getByText(asked("Let Ann keep Wanted?"))).toBeInTheDocument();
  expect(api.approveRequest).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect(api.approveRequest).toHaveBeenCalledExactlyOnceWith("r1");
  await waitFor(() => expect(screen.queryByText(asked("Ann asked to keep this"))).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /request/ })).not.toBeInTheDocument();
  expect(api.listRequests).toHaveBeenCalledTimes(2);
});

test("declining sends decline", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [ask] });
  vi.mocked(api.declineRequest).mockResolvedValue({} as never);
  show();
  await openRequests();
  await userEvent.click(screen.getByRole("button", { name: "Decline" }));
  expect(api.declineRequest).toHaveBeenCalledExactlyOnceWith("r1");
});

test("a failed requests load says so in place of the bar and leaves the wall", async () => {
  setup();
  vi.mocked(api.listRequests).mockRejectedValue(new api.ApiError(500, null));
  show();
  expect(await screen.findByText("Couldn't load requests.")).toBeInTheDocument();
  expect(covers()).toHaveLength(3);
  expect(screen.queryByRole("button", { name: /request/ })).not.toBeInTheDocument();
});

test("Cancel on the approve step answers nothing and brings the buttons back", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [ask] });
  show();
  await openRequests();
  await userEvent.click(screen.getByRole("button", { name: "Approve" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api.approveRequest).not.toHaveBeenCalled();
  expect(screen.queryByText(asked("Let Ann keep Wanted?"))).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
});

test("approving re-reads the shelves too", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValueOnce({ requests: [ask] }).mockResolvedValue({ requests: [] });
  vi.mocked(api.approveRequest).mockResolvedValue({} as never);
  show();
  await approve();
  await waitFor(() => expect(api.myCollections).toHaveBeenCalledTimes(2));
});

test("declining does not re-read the shelves", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValueOnce({ requests: [ask] }).mockResolvedValue({ requests: [] });
  vi.mocked(api.declineRequest).mockResolvedValue({} as never);
  show();
  await openRequests();
  await userEvent.click(screen.getByRole("button", { name: "Decline" }));
  await waitFor(() => expect(api.listRequests).toHaveBeenCalledTimes(2));
  expect(api.myCollections).toHaveBeenCalledTimes(1);
});

test("a 401 on approve goes to sign-in", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [ask] });
  vi.mocked(api.approveRequest).mockRejectedValue(new api.ApiError(401, null));
  show();
  await approve();
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("a 401 on the requests re-read goes to sign-in", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValueOnce({ requests: [ask] }).mockRejectedValue(new api.ApiError(401, null));
  vi.mocked(api.declineRequest).mockResolvedValue({} as never);
  show();
  await openRequests();
  await userEvent.click(screen.getByRole("button", { name: "Decline" }));
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("a failed answer says so and keeps the request listed", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [ask] });
  vi.mocked(api.approveRequest).mockRejectedValue(new api.ApiError(500, null));
  show();
  await approve();
  expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Wanted" })).toBeInTheDocument();
});

test("a failed re-read after an answer shows the alert", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValueOnce({ requests: [ask] }).mockRejectedValue(new api.ApiError(500, null));
  vi.mocked(api.declineRequest).mockResolvedValue({} as never);
  show();
  await openRequests();
  await userEvent.click(screen.getByRole("button", { name: "Decline" }));
  expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
});

test("not-allowed says it was already answered and the row goes after the reload", async () => {
  setup();
  vi.mocked(api.listRequests).mockResolvedValueOnce({ requests: [ask] }).mockResolvedValue({ requests: [] });
  vi.mocked(api.approveRequest).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  show();
  await approve();
  expect(await screen.findByText("That request was already answered or withdrawn.")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("link", { name: "Wanted" })).not.toBeInTheDocument());
});

test("the h1 is My books, once", async () => {
  setup();
  show();
  expect(await screen.findByRole("heading", { level: 1, name: "My books" })).toBeInTheDocument();
  await screen.findByRole("link", book("c"));
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.queryByRole("heading", { level: 2, name: "My books" })).not.toBeInTheDocument();
});

test("signed out, the h1 is the app name", () => {
  show_(null);
  expect(screen.getByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
});

test("headings run h1, then a letter h2 for each group", async () => {
  setup();
  vi.mocked(api.getShelf).mockImplementation(async (id) =>
    id === "k1"
      ? shelfOf(home, [item({ copyId: "a", book: { isbn: null, title: "Dune", authors: ["An Author"], coverUrl: null } })])
      : shelfOf(beach, [item({ copyId: "c", book: { isbn: null, title: "Emma", authors: ["An Author"], coverUrl: null } })]));
  show();
  await screen.findByRole("link", { name: "Emma, An Author" });
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["D", "E"]);
  expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  const wall = screen.getByRole("heading", { level: 1 }).parentElement!;
  expect(within(wall).getAllByRole("listitem")).toHaveLength(2);
});

test("a lost session turns the h1 into the app name", async () => {
  vi.mocked(api.listRequests).mockResolvedValue({ requests: [] });
  vi.mocked(api.myCollections).mockRejectedValue(new api.ApiError(401, null));
  show();
  expect(await screen.findByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "My books" })).not.toBeInTheDocument();
});
