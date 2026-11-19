import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CopyView, LabelView } from "../../shared/types";
import * as api from "../api";
import { CopyPage } from "./CopyPage";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, getLabel: vi.fn(), claim: vi.fn(), returnCopy: vi.fn() };
});

const me = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };
const ann = { id: "2", name: "Ann", pictureUrl: null };
const bob = { id: "3", name: "Bob", pictureUrl: null };
const book = { isbn: "9780000000002", title: "Dune", authors: ["Frank Herbert", "Someone Else"], coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg" };

function copyView(over: Partial<CopyView> = {}): CopyView {
  return {
    copyId: "c1", code: "abc", book, owner: ann, holder: { kind: "member", person: bob }, home: false,
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
  expect(writeText).toHaveBeenCalledWith(location.href);
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
  expect(field).toHaveValue(location.href);
});

test("when the clipboard throws, the address is shown too", async () => {
  ua.mockReturnValue("Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 Instagram 300.0");
  vi.stubGlobal("navigator", { userAgent: navigator.userAgent, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } });
  vi.mocked(api.getLabel).mockResolvedValue(publicView);
  show(null);
  await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
  expect(screen.getByRole("textbox")).toHaveValue(location.href);
  expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
});

test("copy shows owner, holder, button and history newest first with dates", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  show();
  expect(await screen.findByText("Owned by Ann")).toBeInTheDocument();
  expect(screen.getByText("With Bob")).toBeInTheDocument();
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
  expect(await screen.findByText(/Bob marked it returned/)).toBeInTheDocument();
});

test("home reads 'At home with'; a named holder shows their name", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ home: true, holder: { kind: "named", name: "Cara" }, actions: [] })));
  show();
  expect(await screen.findByText("At home with Cara")).toBeInTheDocument();
});

test("actions: [] renders no buttons", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: [] })));
  show();
  await screen.findByText("Owned by Ann");
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
  expect(await screen.findByText("With Ann")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark as returned" })).toBeInTheDocument();
});

test("return calls returnCopy once with the copy id and shows the returned state", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: ["return"] })));
  vi.mocked(api.returnCopy).mockResolvedValue(copyView({ home: true, holder: { kind: "member", person: ann }, actions: ["claim"] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Mark as returned" }));
  expect(api.returnCopy).toHaveBeenCalledExactlyOnceWith("c1");
  expect(await screen.findByText("At home with Ann")).toBeInTheDocument();
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
  expect(screen.getByText("With Ann")).toBeInTheDocument();
  expect(api.getLabel).toHaveBeenCalledTimes(2);
});

test("a 401 during an action refetches and shows the signed-out page", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockResolvedValueOnce(publicView);
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(401, null));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(await screen.findByText("Sign in to see who has this book or to take it.")).toBeInTheDocument();
  expect(screen.queryByText("Something went wrong. Try again.")).not.toBeInTheDocument();
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
  expect(api.getLabel).toHaveBeenCalledOnce();
});

test("a failed initial load shows the trouble row; Try again reloads", async () => {
  vi.mocked(api.getLabel).mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ kind: "unknown" });
  show();
  expect(await screen.findByText("The library is having trouble right now. Please try again later.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("This label isn't one of ours.")).toBeInTheDocument();
});
