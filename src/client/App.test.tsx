import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import * as api from "./api";

vi.mock("./api");

const natalie = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };
const reload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMe).mockResolvedValue(null);
  vi.mocked(api.logout).mockResolvedValue();
  reload.mockReset();
  vi.stubGlobal("location", { pathname: "/", search: "", hash: "", reload });
  // This runtime's own localStorage is not usable and warns when touched (the labels page reads it).
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

function at(url: string) {
  // Split by hand: new URL("//b/abc") would read "b" as a host.
  const [rest, hash = ""] = url.split(/(?=#)/);
  const [pathname, search = ""] = rest.split(/(?=\?)/);
  vi.stubGlobal("location", { pathname, search, hash, reload });
}

test("while loading shows only the heading", () => {
  vi.mocked(api.getMe).mockReturnValue(new Promise(() => {}));
  render(<App />);
  expect(screen.getByRole("heading", { name: "Natalie's Little Library" })).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("signed in shows the name", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  render(<App />);
  expect(await screen.findByText("Hi, Natalie")).toBeInTheDocument();
});

test("a failed getMe is treated as signed out", async () => {
  vi.mocked(api.getMe).mockRejectedValue(new Error("network"));
  render(<App />);
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("refused is shown, then removed from the address bar", async () => {
  const replace = vi.spyOn(history, "replaceState");
  at("/?refused=not-invited");
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("invite-only");
  expect(replace).toHaveBeenCalled();
  expect(replace.mock.calls.at(-1)?.[2]).toBe("/");
});

test("returnTo drops refused and keeps other parameters", async () => {
  at("/?x=1&refused=removed&y=2");
  render(<App />);
  const link = await screen.findByRole("link", { name: "Sign in with Google" });
  expect(link).toHaveAttribute("href", `/auth/login?returnTo=${encodeURIComponent("/?x=1&y=2")}`);
});

test("returnTo is the bare path when refused was the only parameter", async () => {
  at("/?refused=removed");
  render(<App />);
  const link = await screen.findByRole("link", { name: "Sign in with Google" });
  expect(link).toHaveAttribute("href", "/auth/login?returnTo=%2F");
});

test("sign out reloads only after the API call resolves", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  let finish!: () => void;
  vi.mocked(api.logout).mockReturnValue(new Promise<void>((r) => { finish = r; }));
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(api.logout).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});

test("a failed sign-out says so, stays signed in, and does not reload", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  vi.mocked(api.logout).mockRejectedValue(new Error("offline"));
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't sign out. Check your connection and try again.");
  expect(screen.getByText("Hi, Natalie")).toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
});

test("a path starting with // still renders and loads the member once", async () => {
  at("//b/abc");
  render(<App />);
  expect(await screen.findByText("We couldn't find that page.")).toBeInTheDocument();
  expect(api.getMe).toHaveBeenCalledOnce();
  expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
  expect(api.getLabel).not.toHaveBeenCalled();
});

test("on a label page, signed out, the sign-in link returns to that page", async () => {
  vi.mocked(api.getLabel).mockResolvedValue({
    kind: "public", code: "abc", book: { title: "Dune", authors: [], coverUrl: null },
  });
  at("/b/abc");
  render(<App />);
  const link = await screen.findByRole("link", { name: "Sign in with Google" });
  expect(link).toHaveAttribute("href", "/auth/login?returnTo=%2Fb%2Fabc");
  expect(api.getLabel).toHaveBeenCalledWith("abc");
});

test("the pair page signed out signs back in to /pair with its label", async () => {
  at("/pair?label=T7K2Q9XZMB");
  render(<App />);
  const link = await screen.findByRole("link", { name: "Sign in with Google" });
  expect(link).toHaveAttribute("href", "/auth/login?returnTo=%2Fpair%3Flabel%3DT7K2Q9XZMB");
});

test("the labels page signed out signs back in to /labels", async () => {
  at("/labels");
  render(<App />);
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Flabels");
});

test("the labels page signed in shows the sheet picker", async () => {
  at("/labels");
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  render(<App />);
  expect(await screen.findByLabelText("Label sheet")).toBeInTheDocument();
});

test("removing refused keeps ?label= on the pair page", async () => {
  const replace = vi.spyOn(history, "replaceState");
  at("/pair?refused=failed&label=T7K2Q9XZMB");
  render(<App />);
  await screen.findByRole("alert");
  expect(replace.mock.calls[0][2]).toBe("/pair?label=T7K2Q9XZMB");
});

test("removing refused keeps the fragment", async () => {
  const replace = vi.spyOn(history, "replaceState");
  vi.mocked(api.getLabel).mockResolvedValue({ kind: "unknown" });
  at("/b/abc?refused=failed#x");
  render(<App />);
  await screen.findByRole("alert");
  expect(replace).toHaveBeenCalledOnce();
  expect(replace.mock.calls[0][2]).toBe("/b/abc#x");
});

test("replaceState is not called when there is no refused parameter", async () => {
  const replace = vi.spyOn(history, "replaceState");
  at("/?x=1");
  render(<App />);
  await screen.findByRole("link", { name: "Sign in with Google" });
  expect(replace).not.toHaveBeenCalled();
});

test("if replaceState throws the page still renders the refusal and sign-in link", async () => {
  vi.spyOn(history, "replaceState").mockImplementation(() => { throw new DOMException("no", "SecurityError"); });
  at("/?refused=failed");
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in didn't finish");
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(api.getMe).toHaveBeenCalledOnce();
});

test.each([
  ["not-invited", "This library is invite-only right now. Ask Natalie to add you."],
  ["removed", "This account no longer has access."],
  ["unverified", "Google hasn't verified that email address yet."],
  ["failed", "Sign-in didn't finish. Please try again."],
  ["unavailable", "The library is having trouble right now. Please try again later."],
  ["something-else", "Sign-in didn't finish. Please try again."],
])("refusal %s is explained", async (reason, text) => {
  at(`/?refused=${reason}`);
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent(text);
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("a refusal shows above the screen on another route", async () => {
  vi.mocked(api.getLabel).mockResolvedValue({ kind: "unknown" });
  at("/b/abc?refused=removed");
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("This account no longer has access.");
  expect(await screen.findByText("This label isn't one of ours.")).toBeInTheDocument();
});

test("no refusal alert when not refused", async () => {
  render(<App />);
  await screen.findByRole("link", { name: "Sign in with Google" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a 503 from getMe shows the trouble message and Try again, with no sign-in link", async () => {
  const { ApiError } = await vi.importActual<typeof import("./api")>("./api");
  vi.mocked(api.getMe).mockRejectedValue(new ApiError(503, "unavailable"));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The library is having trouble right now. Please try again later.");
  expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(reload).toHaveBeenCalledOnce();
});

test("a restored page reloads; a fresh one does not", async () => {
  render(<App />);
  await screen.findByRole("link", { name: "Sign in with Google" });
  window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
  expect(reload).not.toHaveBeenCalled();
  window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
  expect(reload).toHaveBeenCalledOnce();
});

test("an unknown path renders the not-found screen", async () => {
  at("/nope");
  render(<App />);
  expect(await screen.findByText("We couldn't find that page.")).toBeInTheDocument();
});

test("signed in, the home screen links to pairing and labels", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  render(<App />);
  expect(await screen.findByRole("link", { name: "Pair a book" })).toHaveAttribute("href", "/pair");
});

test.each([401, 500, 502])("a %i from getMe is signed out, not the trouble message", async (status) => {
  const { ApiError } = await vi.importActual<typeof import("./api")>("./api");
  vi.mocked(api.getMe).mockRejectedValue(new ApiError(status, null));
  render(<App />);
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test.each(["constructor", "toString"])("refused=%s falls back to the generic refusal text", async (reason) => {
  at(`/?refused=${reason}`);
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in didn't finish. Please try again.");
});

test("a refusal on a label page keeps returnTo at that page", async () => {
  vi.mocked(api.getLabel).mockResolvedValue({
    kind: "public", code: "abc", book: { title: "Dune", authors: [], coverUrl: null },
  });
  at("/b/abc?refused=removed");
  render(<App />);
  const link = await screen.findByRole("link", { name: "Sign in with Google" });
  expect(link).toHaveAttribute("href", "/auth/login?returnTo=%2Fb%2Fabc");
});

test("a copy reached by id loads with getCopy and never asks for a label", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  vi.mocked(api.getCopy).mockResolvedValue({
    copyId: "c1", code: null, book: { isbn: null, title: "Dune", authors: [], coverUrl: null }, owner: { id: "1", name: "Natalie", pictureUrl: null },
    holder: { kind: "member", person: { id: "1", name: "Natalie", pictureUrl: null } }, home: true, collection: null, history: [], actions: [],
  });
  at("/copies/c1");
  render(<App />);
  expect(await screen.findByText("Dune")).toBeInTheDocument();
  expect(api.getCopy).toHaveBeenCalledWith("c1");
  expect(api.getLabel).not.toHaveBeenCalled();
});

test("the shelf screens are routed", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  vi.mocked(api.myCollections).mockResolvedValue({ owner: { id: "1", name: "Natalie", pictureUrl: null }, collections: [] });
  vi.mocked(api.getHolding).mockResolvedValue({ items: [] });
  vi.mocked(api.listMembers).mockResolvedValue({ members: [] });
  vi.mocked(api.memberCollections).mockResolvedValue({ owner: { id: "2", name: "Ann", pictureUrl: null }, collections: [] });
  vi.mocked(api.getShelf).mockRejectedValue(Object.assign(new api.ApiError(404, null), { status: 404 }));
  for (const [path, text] of [
    ["/mine", "My books"],
    ["/holding", "You're not holding anyone else's books."],
    ["/members", "No one else is here yet."],
    ["/members/2", "No collections yet."],
    ["/collections/k1", "That collection isn't here."],
  ] as const) {
    at(path);
    const { unmount } = render(<App />);
    expect(await screen.findByText(text)).toBeInTheDocument();
    unmount();
  }
});

test("the import screen is routed", async () => {
  vi.mocked(api.getMe).mockResolvedValue(natalie);
  vi.mocked(api.myCollections).mockResolvedValue({ owner: { id: "1", name: "Natalie", pictureUrl: null }, collections: [] });
  at("/import");
  render(<App />);
  expect(await screen.findByLabelText(/StoryGraph export/)).toBeInTheDocument();
});
