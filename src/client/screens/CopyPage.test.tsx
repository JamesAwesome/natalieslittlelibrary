import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CopyView, LabelView } from "../../shared/types";
import * as api from "../api";
import { CopyPage } from "./CopyPage";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, getLabel: vi.fn(), claim: vi.fn(), returnCopy: vi.fn(), getCopy: vi.fn(), moveCopy: vi.fn(), myCollections: vi.fn() };
});

const me = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };
const ann = { id: "2", name: "Ann", pictureUrl: null };
const me2 = { id: "1", name: "Natalie", pictureUrl: null };
const bob = { id: "3", name: "Bob", pictureUrl: null };
const book = { isbn: "9780000000002", title: "Dune", authors: ["Frank Herbert", "Someone Else"], coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg" };

function copyView(over: Partial<CopyView> = {}): CopyView {
  return {
    copyId: "c1", code: "abc", book, owner: ann, holder: { kind: "member", person: bob }, home: false, collection: null,
    history: [
      { at: Date.UTC(2026, 10, 3, 12), type: "claimed", actor: bob },
      { at: Date.UTC(2026, 10, 1, 12), type: "labelled", actor: ann },
      { at: Date.UTC(2026, 9, 30, 12), type: "added", actor: ann },
    ],
    actions: ["claim"], ...over,
  };
}
const asCopy = (copy: CopyView): LabelView => ({ kind: "copy", copy });
const publicView: LabelView = { kind: "public", code: "abc", book: { title: "Dune", authors: ["Frank Herbert"], coverUrl: null } };
const line = (t: string) => (_: string, el: Element | null) => el?.tagName === "P" && el.textContent === t;
const ua = vi.spyOn(navigator, "userAgent", "get");

beforeEach(() => {
  vi.resetAllMocks();
  ua.mockReturnValue("Mozilla/5.0 (iPhone) AppleWebKit/605 Version/17 Mobile Safari/604.1");
});
afterEach(() => vi.unstubAllGlobals());

const show = (member: typeof me | null = me) => render(<CopyPage code="abc" member={member} returnTo="/b/abc" />);

test("loading shows only the heading", () => {
  vi.mocked(api.getLabel).mockReturnValue(new Promise(() => {}));
  show();
  expect(screen.getByRole("heading", { name: "Natalie's Little Library" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

test("unknown", async () => {
  vi.mocked(api.getLabel).mockResolvedValue({ kind: "unknown" });
  show(null);
  expect(await screen.findByText("This label isn't one of ours.")).toBeInTheDocument();
});

test("blank, signed in, links to pairing with the code", async () => {
  vi.mocked(api.getLabel).mockResolvedValue({ kind: "blank", code: "abc" });
  show();
  expect(await screen.findByText("This label isn't on a book yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pair it with a book" })).toHaveAttribute("href", "/pair?label=abc");
  expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
});

test("blank, signed out, offers sign-in back to this page", async () => {
  vi.mocked(api.getLabel).mockResolvedValue({ kind: "blank", code: "abc" });
  show(null);
  expect(await screen.findByText("This label isn't on a book yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fb%2Fabc");
  expect(screen.queryByRole("link", { name: "Pair it with a book" })).not.toBeInTheDocument();
});

test("public shows the book, the prompt and the sign-in link; cover has empty alt", async () => {
  vi.mocked(api.getLabel).mockResolvedValue({ ...publicView, book: { ...publicView.book, coverUrl: book.coverUrl } } as LabelView);
  const { container } = show(null);
  expect(await screen.findByText("Dune")).toBeInTheDocument();
  expect(screen.getByText("Frank Herbert")).toBeInTheDocument();
  expect(screen.getByText("Sign in to see who has this book or to take it.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fb%2Fabc");
  expect(container.querySelector("img")).toHaveAttribute("alt", "");
});

test("a missing cover is a placeholder, not an image", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(publicView);
  const { container } = show(null);
  await screen.findByText("Dune");
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".cover-missing")).not.toBeNull();
});

test("public in an embedded browser explains, offers no login link, and copies the link", async () => {
  ua.mockReturnValue("Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 Instagram 300.0");
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { userAgent: navigator.userAgent, clipboard: { writeText } });
  vi.mocked(api.getLabel).mockResolvedValue(publicView);
  show(null);
  expect(await screen.findByText("Google won't let you sign in inside Instagram. Open this page in Safari or Chrome.")).toBeInTheDocument();
  expect(document.querySelector('a[href*="/auth/login"]')).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
  expect(writeText).toHaveBeenCalledWith(location.origin + location.pathname);
  expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
});

test("when the clipboard is missing, the address is shown to copy by hand", async () => {
  ua.mockReturnValue("Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 Instagram 300.0");
  vi.stubGlobal("navigator", { userAgent: navigator.userAgent });
  vi.mocked(api.getLabel).mockResolvedValue(publicView);
  show(null);
  await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
  const field = screen.getByRole("textbox");
  expect(field).toHaveAttribute("readonly");
  expect(field).toHaveValue(location.origin + location.pathname);
});

test("when the clipboard throws, the address is shown too", async () => {
  ua.mockReturnValue("Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 Instagram 300.0");
  vi.stubGlobal("navigator", { userAgent: navigator.userAgent, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } });
  vi.mocked(api.getLabel).mockResolvedValue(publicView);
  show(null);
  await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
  expect(screen.getByRole("textbox")).toHaveValue(location.origin + location.pathname);
  expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
});

test("copy shows owner, holder, button and history newest first with dates", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  show();
  expect(await screen.findByText(line("Owned by Ann"))).toBeInTheDocument();
  expect(screen.getByText(line("With Bob"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "I have this book" })).toBeInTheDocument();
  const items = screen.getAllByRole("listitem");
  expect(items.map((li) => li.textContent)).toEqual([
    `Bob took it ${new Date(Date.UTC(2026, 10, 3, 12)).toLocaleDateString()}`,
    `Ann put a label on it ${new Date(Date.UTC(2026, 10, 1, 12)).toLocaleDateString()}`,
    `Ann added this book ${new Date(Date.UTC(2026, 9, 30, 12)).toLocaleDateString()}`,
  ]);
});

test("returned entries read 'marked it returned'", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ history: [{ at: 0, type: "returned", actor: bob }] })));
  show();
  expect(await screen.findByText((_, el) => el?.tagName === "LI" && /^Bob marked it returned/.test(el.textContent ?? ""))).toBeInTheDocument();
});

test("home reads 'At home'; away, a named holder shows as 'With <name>'", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ home: true, holder: { kind: "named", name: "Cara" }, actions: [] })));
  const { unmount } = show();
  expect(await screen.findByText(line("At home"))).toBeInTheDocument();
  unmount();
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ home: false, holder: { kind: "named", name: "Cara" }, actions: [] })));
  show();
  expect(await screen.findByText(line("With Cara"))).toBeInTheDocument();
});

test("actions: [] renders no buttons", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: [] })));
  show();
  await screen.findByText(line("Owned by Ann"));
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("only the listed action gets a button", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: ["return"] })));
  show();
  expect(await screen.findByRole("button", { name: "Mark as returned" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "I have this book" })).not.toBeInTheDocument();
});

test("claim calls claim once and shows the returned state", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  vi.mocked(api.claim).mockResolvedValue(copyView({ holder: { kind: "member", person: ann }, actions: ["return"] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(api.claim).toHaveBeenCalledExactlyOnceWith("abc");
  expect(await screen.findByText(line("With Ann"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark as returned" })).toBeInTheDocument();
});

test("return calls returnCopy once with the copy id and shows the returned state", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: ["return"] })));
  vi.mocked(api.returnCopy).mockResolvedValue(copyView({ home: true, holder: { kind: "member", person: ann }, actions: ["claim"] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Mark as returned" }));
  expect(api.returnCopy).toHaveBeenCalledExactlyOnceWith("c1");
  expect(await screen.findByText(line("At home"))).toBeInTheDocument();
});

test("a double click sends one request and the button is disabled meanwhile", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  let finish!: (c: CopyView) => void;
  vi.mocked(api.claim).mockReturnValue(new Promise((r) => { finish = r; }));
  show();
  const button = await screen.findByRole("button", { name: "I have this book" });
  await userEvent.dblClick(button);
  expect(api.claim).toHaveBeenCalledOnce();
  expect(button).toBeDisabled();
  finish(copyView({ actions: [] }));
  await waitFor(() => expect(screen.queryByRole("button")).not.toBeInTheDocument());
});

test("a refusal refetches and shows the current state with the changed message", async () => {
  vi.mocked(api.getLabel)
    .mockResolvedValueOnce(asCopy(copyView()))
    .mockResolvedValueOnce(asCopy(copyView({ holder: { kind: "member", person: ann }, actions: [] })));
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(await screen.findByText("That's already changed. Here's where the book is now.")).toBeInTheDocument();
  expect(screen.getByText(line("With Ann"))).toBeInTheDocument();
  expect(api.getLabel).toHaveBeenCalledTimes(2);
});

test("a 401 during an action refetches and shows the signed-out page", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockResolvedValueOnce(publicView);
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(401, null));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(await screen.findByText("Sign in to see who has this book or to take it.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fb%2Fabc");
  expect(screen.queryByText("Something went wrong. Try again.")).not.toBeInTheDocument();
});

test("a refusal whose refetch comes back public still offers sign-in", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockResolvedValueOnce(publicView);
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(await screen.findByText("That's already changed. Here's where the book is now.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fb%2Fabc");
});

test("after a 401 a blank label offers sign-in, not pairing", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockResolvedValueOnce({ kind: "blank", code: "abc" });
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(401, null));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(await screen.findByText("This label isn't on a book yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Pair it with a book" })).not.toBeInTheDocument();
});

test("a public view reached by refetch in an embedded browser has no login link", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockResolvedValueOnce(publicView);
  vi.mocked(api.claim).mockImplementation(async () => {
    ua.mockReturnValue("Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 Instagram 300.0");
    throw new api.ApiError(401, null);
  });
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(await screen.findByText(/Google won't let you sign in inside Instagram/)).toBeInTheDocument();
  expect(document.querySelector('a[href*="/auth/login"]')).toBeNull();
});

test.each([
  ["a 500", () => new api.ApiError(500, null)],
  ["a 403 that is not not-allowed", () => new api.ApiError(403, "invalid")],
  ["a network error", () => new TypeError("offline")],
])("%s during an action says so and re-enables the button", async (_n, make) => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  vi.mocked(api.claim).mockRejectedValue(make());
  show();
  const button = await screen.findByRole("button", { name: "I have this book" });
  await userEvent.click(button);
  expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "I have this book" })).toBeEnabled();
  expect(api.getLabel).toHaveBeenCalledTimes(2);
});

test("a failed POST that the server actually accepted shows the new holder after the refetch, with the trouble message", async () => {
  vi.mocked(api.getLabel)
    .mockResolvedValueOnce(asCopy(copyView()))
    .mockResolvedValueOnce(asCopy(copyView({ holder: { kind: "member", person: me2 }, actions: ["return"] })));
  vi.mocked(api.claim).mockRejectedValue(new TypeError("offline"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(await screen.findByText("Something went wrong. Try again.")).toBeInTheDocument();
  expect(screen.getByText(line("With Natalie"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark as returned" })).toBeInTheDocument();
});

test("if the refetch after a failed action also fails, the trouble screen with Try again shows", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockRejectedValueOnce(new Error("down"));
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(500, null));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(await screen.findByText("The library is having trouble right now. Please try again later.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("Try again clears the old page while it reloads", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockRejectedValueOnce(new Error("x"));
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(500, null));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  await screen.findByRole("button", { name: "Try again" });
  vi.mocked(api.getLabel).mockReturnValue(new Promise(() => {}));
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.queryByText("Owned by Ann")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("two clicks before React re-renders send one request", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  vi.mocked(api.claim).mockReturnValue(new Promise(() => {}));
  show();
  const button = await screen.findByRole("button", { name: "I have this book" });
  act(() => {
    button.click();
    button.click();
  });
  expect(api.claim).toHaveBeenCalledOnce();
});

test("a broken cover image falls back to the placeholder", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  const { container } = show();
  await screen.findByText(line("Owned by Ann"));
  act(() => { container.querySelector("img")!.dispatchEvent(new Event("error")); });
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".cover-missing")).not.toBeNull();
});

test("names and authors are isolated with bdi so a bidi override cannot reorder the line", async () => {
  const evil = { id: "9", name: "\u202Eevil", pictureUrl: null };
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({
    owner: evil, holder: { kind: "member", person: evil },
    book: { ...book, authors: ["\u202Efoo", "bar"] },
    history: [{ at: 1, type: "claimed", actor: evil }],
  })));
  const { container } = show();
  await screen.findByText(line("Owned by \u202Eevil"));
  const texts = [...container.querySelectorAll("bdi")].map((b) => b.textContent);
  expect(texts.filter((t) => t === "\u202Eevil")).toHaveLength(3);
  expect(texts).toEqual(expect.arrayContaining(["\u202Efoo", "bar"]));
});

test("Copy link copies the page address without query or hash", async () => {
  ua.mockReturnValue("Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 Instagram 300.0");
  const writeText = vi.fn().mockResolvedValue(undefined);
  const loc = { href: "https://x.test/b/abc?t=1#h", origin: "https://x.test", pathname: "/b/abc" };
  vi.stubGlobal("location", loc);
  vi.stubGlobal("navigator", { userAgent: navigator.userAgent, clipboard: { writeText } });
  vi.mocked(api.getLabel).mockResolvedValue(publicView);
  show(null);
  await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
  expect(writeText).toHaveBeenCalledWith("https://x.test/b/abc");
});

test("changing the label code shows the new label, not the old book", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockReturnValue(new Promise(() => {}));
  const { rerender } = show();
  await screen.findByText(line("Owned by Ann"));
  rerender(<CopyPage code="def" member={me} returnTo="/b/def" />);
  expect(screen.queryByText("Owned by Ann")).not.toBeInTheDocument();
  expect(api.getLabel).toHaveBeenLastCalledWith("def");
});

test("a failed initial load shows the trouble row; Try again reloads", async () => {
  vi.mocked(api.getLabel).mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ kind: "unknown" });
  show();
  expect(await screen.findByText("The library is having trouble right now. Please try again later.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("This label isn't one of ours.")).toBeInTheDocument();
});

const k1 = { id: "k1", name: "Home library", isDefault: true, count: 2, unlabelled: 0 };
const k2 = { id: "k2", name: "Cookbooks", isDefault: false, count: 1, unlabelled: 0 };
const mine = { owner: me2, collections: [k1, k2] };
const byId = (over: Partial<CopyView> = {}) =>
  copyView({ code: null, owner: me2, holder: { kind: "member", person: me2 }, home: true, collection: { id: "k1", name: "Home library" }, actions: ["move", "label"], ...over });
const showById = (member: typeof me | null = me) => render(<CopyPage copyId="c1" member={member} returnTo="/copies/c1" />);

test("the owner line names the collection inside bdi, and omits it when there is none", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ collection: { id: "k1", name: "Cook \u202Ebooks" }, actions: [] })));
  const { container } = show();
  expect(await screen.findByText(line("Owned by Ann \u00B7 Cook \u202Ebooks"))).toBeInTheDocument();
  const bdis = [...container.querySelectorAll("p bdi")].map((b) => b.textContent);
  expect(bdis).toContain("Cook \u202Ebooks");
  expect(bdis).toContain("Ann");
});

test("a copy with no collection says only who owns it", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: [] })));
  show();
  expect(await screen.findByText(line("Owned by Ann"))).toBeInTheDocument();
});

test("a copy reached by id loads with getCopy, never getLabel, and offers no claim even when listed", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId({ owner: ann, holder: { kind: "member", person: bob }, home: false, actions: ["claim"] }));
  showById();
  expect(await screen.findByText(line("Owned by Ann \u00B7 Home library"))).toBeInTheDocument();
  expect(screen.getByText(line("With Bob"))).toBeInTheDocument();
  expect(api.getCopy).toHaveBeenCalledWith("c1");
  expect(api.getLabel).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "I have this book" })).not.toBeInTheDocument();
});

test("move offers the owner's collections, calls moveCopy once, and shows the returned view", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId());
  vi.mocked(api.myCollections).mockResolvedValue(mine);
  vi.mocked(api.moveCopy).mockResolvedValue(byId({ collection: { id: "k2", name: "Cookbooks" } }));
  showById();
  const select = await screen.findByRole("combobox", { name: "Move to" });
  expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Cookbooks"]);
  await userEvent.click(screen.getByRole("button", { name: "Move" }));
  expect(api.moveCopy).toHaveBeenCalledExactlyOnceWith("c1", "k2");
  expect(await screen.findByText(line("Owned by Natalie \u00B7 Cookbooks"))).toBeInTheDocument();
});

const k3 = { id: "k3", name: "Travel", isDefault: false, count: 0, unlabelled: 0 };

test("a move refused not-found says the collection is gone and refreshes the choices", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId());
  vi.mocked(api.myCollections).mockResolvedValueOnce({ owner: me2, collections: [k1, k2, k3] }).mockResolvedValue({ owner: me2, collections: [k1, k3] });
  vi.mocked(api.moveCopy).mockRejectedValue(new api.ApiError(404, "not-found"));
  showById();
  await userEvent.click(await screen.findByRole("button", { name: "Move" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That collection is gone. Pick another.");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Move to" }).querySelectorAll("option")).toHaveLength(1));
  expect(screen.getByRole("option", { name: "Travel" })).toBeInTheDocument();
  expect(api.myCollections).toHaveBeenCalledTimes(2);
});

test("a move refused not-allowed says you can't move it and re-reads the copy", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId());
  vi.mocked(api.myCollections).mockResolvedValue(mine);
  vi.mocked(api.moveCopy).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  showById();
  await userEvent.click(await screen.findByRole("button", { name: "Move" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("You can't move this book.");
  expect(api.getCopy).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("option", { name: "Cookbooks" })).toHaveAttribute("dir", "auto");
});

test("a move refused not-found while the collection still exists says the book is gone", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId());
  vi.mocked(api.myCollections).mockResolvedValue(mine);
  vi.mocked(api.moveCopy).mockRejectedValue(new api.ApiError(404, "not-found"));
  showById();
  await userEvent.click(await screen.findByRole("button", { name: "Move" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That book isn't here any more.");
});

test("with only one collection there is no Move control", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId());
  vi.mocked(api.myCollections).mockResolvedValue({ owner: me2, collections: [k1] });
  showById();
  await screen.findByText(line("Owned by Natalie \u00B7 Home library"));
  await waitFor(() => expect(api.myCollections).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

test("with several, the current one is left out and the first other is preselected", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId({ collection: { id: "k2", name: "Cookbooks" } }));
  vi.mocked(api.myCollections).mockResolvedValue({ owner: me2, collections: [k1, k2, k3] });
  showById();
  const select = await screen.findByRole("combobox", { name: "Move to" });
  expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Home library", "Travel"]);
  expect(select).toHaveValue("k1");
});

test("if the collections cannot be loaded, a line says moving is unavailable", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId());
  vi.mocked(api.myCollections).mockRejectedValue(new Error("offline"));
  showById();
  expect(await screen.findByText(/Couldn't load your collections/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
});

test("by id, losing the session after load leaves sign-in and no stale buttons", async () => {
  vi.mocked(api.getCopy).mockResolvedValueOnce(byId()).mockRejectedValue(new api.ApiError(401, "signed-out"));
  vi.mocked(api.myCollections).mockResolvedValue(mine);
  vi.mocked(api.moveCopy).mockRejectedValue(new api.ApiError(401, "signed-out"));
  showById();
  await userEvent.click(await screen.findByRole("button", { name: "Move" }));
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fcopies%2Fc1");
  expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Put a label on it" })).not.toBeInTheDocument();
});

test("a move on a label page refetches the label so the page keeps what it showed", async () => {
  const before = copyView({ owner: me2, collection: { id: "k1", name: "Home library" }, actions: ["move"] });
  const after = copyView({ owner: me2, collection: { id: "k2", name: "Cookbooks" }, actions: ["move"] });
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(before)).mockResolvedValue(asCopy(after));
  vi.mocked(api.myCollections).mockResolvedValue(mine);
  vi.mocked(api.moveCopy).mockResolvedValue({ ...after, code: null });
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Move" }));
  expect(await screen.findByText(line("Owned by Natalie \u00B7 Cookbooks"))).toBeInTheDocument();
  expect(api.getLabel).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Dune")).toBeInTheDocument();
});

test("Put a label on it links to pairing this copy", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId({ actions: ["label"] }));
  showById();
  expect(await screen.findByRole("link", { name: "Put a label on it" })).toHaveAttribute("href", "/pair?copy=c1");
});

test("by id, a 401 shows sign-in back to the page", async () => {
  vi.mocked(api.getCopy).mockRejectedValue(new api.ApiError(401, "signed-out"));
  showById(null);
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fcopies%2Fc1");
});

test("by id, a copy that is not there says so", async () => {
  vi.mocked(api.getCopy).mockRejectedValue(new api.ApiError(404, "not-found"));
  showById();
  expect(await screen.findByText("That book isn't here.")).toBeInTheDocument();
});

test("the trouble branch renders inside .copy-page", async () => {
  vi.mocked(api.getCopy).mockRejectedValue(new Error("offline"));
  const { container } = showById();
  expect(await screen.findByRole("alert")).toHaveTextContent("The library is having trouble right now");
  expect(container.querySelector(".copy-page [role=alert]")).not.toBeNull();
});
