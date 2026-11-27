import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CopyView, LabelView } from "../../shared/types";
import * as api from "../api";
import { ShellContext, type Tab } from "../shell";
import { CopyPage } from "./CopyPage";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, getLabel: vi.fn(), claim: vi.fn(), returnCopy: vi.fn(), getCopy: vi.fn(), moveCopy: vi.fn(), myCollections: vi.fn(),
    lendCopy: vi.fn(), giveCopy: vi.fn(), requestCopy: vi.fn(), withdrawRequest: vi.fn(), approveRequest: vi.fn(), declineRequest: vi.fn(),
    releaseCopy: vi.fn(), adoptCopy: vi.fn(), listPeople: vi.fn(), listMembers: vi.fn() };
});

const me = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };
const ann = { id: "2", name: "Ann", pictureUrl: null };
const me2 = { id: "1", name: "Natalie", pictureUrl: null };
const bob = { id: "3", name: "Bob", pictureUrl: null };
const book = { isbn: "9780000000002", title: "Dune", authors: ["Frank Herbert", "Someone Else"], coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg" };

function copyView(over: Partial<CopyView> = {}): CopyView {
  return {
    copyId: "c1", code: "abc", ownerCode: null, book, owner: ann, holder: { kind: "member", person: bob }, request: null, home: false, collection: null,
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

const referrer = (value: string) => Object.defineProperty(document, "referrer", { value, configurable: true });

beforeEach(() => {
  vi.resetAllMocks();
  ua.mockReturnValue("Mozilla/5.0 (iPhone) AppleWebKit/605 Version/17 Mobile Safari/604.1");
  referrer("");
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
  await screen.findByRole("heading", { level: 1, name: "Dune" });
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("[data-state=none]")).not.toBeNull();
  expect(screen.queryByText("Cover didn’t load")).toBeNull();
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

test("copy shows the status line, the button and history newest first with dates", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  show();
  expect(await screen.findByText(line("With Bob · Ann’s book"))).toBeInTheDocument();
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

test("relabelled entries read 'replaced its label'", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ history: [{ at: 0, type: "relabelled", actor: ann }] })));
  show();
  expect(await screen.findByText((_, el) => el?.tagName === "LI" && /^Ann replaced its label /.test(el.textContent ?? ""))).toBeInTheDocument();
});

test("home reads 'At home'; away, a placeholder holder shows as 'With <name>'", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ home: true, holder: { kind: "person", id: "p1", name: "Cara" }, actions: [] })));
  const { unmount } = show();
  expect(await screen.findByText(line("At home · Ann’s book"))).toBeInTheDocument();
  unmount();
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ home: false, holder: { kind: "person", id: "p1", name: "Cara" }, actions: [] })));
  show();
  expect(await screen.findByText(line("With Cara · Ann’s book"))).toBeInTheDocument();
});

test("a copy with no holder and an owner shows neither 'With' nor 'At home'", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ home: false, holder: null, actions: [] })));
  show();
  await screen.findByText(line("Ann’s book"));
  expect(screen.queryByText(/^With /)).not.toBeInTheDocument();
  expect(screen.queryByText("At home")).not.toBeInTheDocument();
});

test("a copy with an open request renders, and a removed member reads as no longer a member", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(
    asCopy(copyView({ request: { by: bob, at: 5 }, holder: { kind: "member", person: { ...bob, removed: true } }, actions: [] })),
  );
  show();
  expect(await screen.findByText(line("With Bob (no longer a member) · Ann’s book"))).toBeInTheDocument();
});

test("history says what each new event did, naming its subject", async () => {
  const cara = { kind: "person", id: "p1", name: "Cara" } as const;
  vi.mocked(api.getLabel).mockResolvedValue(
    asCopy(copyView({ actions: [], history: [
      { at: 3, type: "lent", actor: ann, subject: cara },
      { at: 2, type: "declined", actor: ann, subject: { kind: "member", person: bob } },
      { at: 1, type: "adopted", actor: bob },
    ] })),
  );
  show();
  expect(await screen.findByText((_, el) => el?.tagName === "LI" && /^Ann lent this to Cara /.test(el.textContent ?? ""))).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === "LI" && /^Ann declined Bob's request /.test(el.textContent ?? ""))).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === "LI" && /^Bob took this on /.test(el.textContent ?? ""))).toBeInTheDocument();
});

test("actions: [] renders no buttons", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: [] })));
  show();
  await screen.findByText(line("With Bob · Ann’s book"));
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("only the listed action gets a button", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: ["return"] })));
  show();
  expect(await screen.findByRole("button", { name: "Mark as returned" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "I have this book" })).not.toBeInTheDocument();
});

const plain = [
  ["request", "Ask to keep this", "requestCopy"],
  ["withdraw", "Withdraw", "withdrawRequest"],
  ["decline", "Decline", "declineRequest"],
] as const;

test.each(plain)("the %s button calls its own api function and never returnCopy", async (action, text, fn) => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: [action] })));
  vi.mocked(api[fn]).mockResolvedValue(copyView({ actions: [] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: text }));
  expect(api[fn]).toHaveBeenCalledExactlyOnceWith("c1");
  expect(api.returnCopy).not.toHaveBeenCalled();
  expect(api.claim).not.toHaveBeenCalled();
});

test("Approve asks first, then approves; Cancel approves nothing", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, request: { by: bob, at: 5 }, actions: ["approve", "decline"] })));
  vi.mocked(api.approveRequest).mockResolvedValue(copyView({ actions: [] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
  expect(screen.getByText(line("Let Bob keep Dune?"))).toBeInTheDocument();
  expect(api.approveRequest).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api.approveRequest).not.toHaveBeenCalled();
  expect(screen.queryByText(line("Let Bob keep Dune?"))).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Approve" }));
  await userEvent.click(screen.getByRole("button", { name: "Approve" }));
  expect(api.approveRequest).toHaveBeenCalledExactlyOnceWith("c1");
  expect(api.returnCopy).not.toHaveBeenCalled();
});

test("Lend, Give, Release and Take offer no stray plain buttons", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: ["lend", "give", "release"] })));
  vi.mocked(api.listPeople).mockResolvedValue({ people: [] });
  vi.mocked(api.listMembers).mockResolvedValue({ members: [] });
  show();
  await screen.findByRole("button", { name: "Lend" });
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Lend", "Give", "Release"]);
  expect(api.returnCopy).not.toHaveBeenCalled();
});

test("Lend opens the lend box and lendCopy's answer is shown", async () => {
  vi.mocked(api.getLabel)
    .mockResolvedValueOnce(asCopy(copyView({ owner: me2, actions: ["lend"] })))
    .mockResolvedValue(asCopy(copyView({ owner: me2, holder: { kind: "person", id: "p1", name: "Zed" }, actions: [] })));
  vi.mocked(api.listPeople).mockResolvedValue({ people: [] });
  vi.mocked(api.listMembers).mockResolvedValue({ members: [me2, bob] });
  vi.mocked(api.lendCopy).mockResolvedValue(copyView({ owner: me2, holder: { kind: "person", id: "p1", name: "Zed" }, actions: [] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Lend" }));
  await userEvent.type(screen.getByRole("textbox"), "Zed");
  await userEvent.click(await screen.findByRole("button", { name: 'Lend to "Zed"' }));
  expect(api.lendCopy).toHaveBeenCalledExactlyOnceWith("c1", { name: "Zed" });
  expect(await screen.findByText(line("With Zed"))).toBeInTheDocument();
});

test("the lend box does not suggest the member who holds the copy", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, holder: { kind: "member", person: bob }, home: false, actions: ["lend"] })));
  vi.mocked(api.listPeople).mockResolvedValue({ people: [] });
  vi.mocked(api.listMembers).mockResolvedValue({ members: [me2, bob] });
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Lend" }));
  await userEvent.type(screen.getByRole("textbox"), "Bo");
  expect(await screen.findByRole("button", { name: 'Lend to "Bo"' })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Bob member" })).not.toBeInTheDocument();
});

test("Give lists members, confirms by name, then gives", async () => {
  const kim = { id: "4", name: "Kim", pictureUrl: null };
  vi.mocked(api.getLabel)
    .mockResolvedValueOnce(asCopy(copyView({ owner: me2, actions: ["give"] })))
    .mockResolvedValue(asCopy(copyView({ owner: kim, actions: [] })));
  vi.mocked(api.listMembers).mockResolvedValue({ members: [me2, kim] });
  vi.mocked(api.giveCopy).mockResolvedValue(copyView({ owner: kim, actions: [] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Give" }));
  expect(screen.queryByRole("button", { name: "Natalie" })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Kim" }));
  expect(screen.getByText(line("Give Dune to Kim?"))).toBeInTheDocument();
  expect(api.giveCopy).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Give" }));
  expect(api.giveCopy).toHaveBeenCalledExactlyOnceWith("c1", "4");
  expect(await screen.findByText(line("With Bob · Kim’s book"))).toBeInTheDocument();
});

test("Give can be backed out of without a call", async () => {
  const kim = { id: "4", name: "Kim", pictureUrl: null };
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, actions: ["give"] })));
  vi.mocked(api.listMembers).mockResolvedValue({ members: [kim] });
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Give" }));
  await userEvent.click(await screen.findByRole("button", { name: "Kim" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByText(line("Give Dune to Kim?"))).not.toBeInTheDocument();
  expect(api.giveCopy).not.toHaveBeenCalled();
});

test("the Release confirm wraps the title in a bdi", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, actions: ["release"] })));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Release" }));
  expect(screen.getByText("Dune", { selector: "bdi" })).toBeInTheDocument();
});

test("Release confirms first, then releases", async () => {
  vi.mocked(api.getLabel)
    .mockResolvedValueOnce(asCopy(copyView({ owner: me2, actions: ["release"] })))
    .mockResolvedValue(asCopy(copyView({ owner: null, holder: null, actions: [] })));
  vi.mocked(api.releaseCopy).mockResolvedValue(copyView({ owner: null, holder: null, actions: [] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Release" }));
  expect(screen.getByText(line("Release Dune? It leaves your collection and anyone who scans it can take it."))).toBeInTheDocument();
  expect(api.releaseCopy).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Release" }));
  expect(api.releaseCopy).toHaveBeenCalledExactlyOnceWith("c1");
  expect(await screen.findByText("No one owns this book.")).toBeInTheDocument();
});

test("an open request reads '<name> asked to keep this', with Approve and Decline for the owner", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, request: { by: bob, at: 5 }, actions: ["approve", "decline"] })));
  show();
  expect(await screen.findByText(line("Bob asked to keep this"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
});

test("the asker sees Withdraw", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ request: { by: bob, at: 5 }, actions: ["withdraw"] })));
  show();
  expect(await screen.findByText(line("Bob asked to keep this"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
});

test("an ownerless copy reached by a code says so and offers Take, which adopts by the code", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: null, holder: null, actions: ["adopt"] })));
  vi.mocked(api.adoptCopy).mockResolvedValue(copyView({ owner: me2, holder: null, actions: [] }));
  show();
  expect(await screen.findByText("No one owns this book.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Take this book" }));
  expect(api.adoptCopy).toHaveBeenCalledExactlyOnceWith("abc");
  expect(api.returnCopy).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText("No one owns this book.")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Take this book" })).not.toBeInTheDocument();
});

test("an ownerless copy reached by id shows the line and no Take button", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(copyView({ owner: null, holder: null, code: null, actions: ["adopt"] }));
  render(<CopyPage copyId="c1" member={me} returnTo="/c/c1" />);
  expect(await screen.findByText("No one owns this book.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Take this book" })).not.toBeInTheDocument();
});

test("a removed owner's copy reached by a code reads as no longer a member and offers Take", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: { ...ann, removed: true }, holder: null, actions: ["adopt"] })));
  show();
  expect(await screen.findByText(line("Ann (no longer a member)’s book"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Take this book" })).toBeInTheDocument();
});

test("a removed member reads as no longer a member as owner, actor and subject", async () => {
  const gone = { ...bob, removed: true as const };
  vi.mocked(api.getLabel).mockResolvedValue(
    asCopy(copyView({ owner: gone, actions: [], history: [{ at: 1, type: "lent", actor: gone, subject: { kind: "member", person: gone } }] })),
  );
  show();
  expect(await screen.findByText(line("With Bob · Bob (no longer a member)’s book"))).toBeInTheDocument();
  expect(screen.getByText((_, el) => el?.tagName === "LI" && /^Bob \(no longer a member\) lent this to Bob \(no longer a member\) /.test(el.textContent ?? ""))).toBeInTheDocument();
});

test("a history entry with a subject reads 'Natalie lent this to Sarah'", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(
    asCopy(copyView({ actions: [], history: [{ at: 1, type: "lent", actor: me2, subject: { kind: "person", id: "p1", name: "Sarah" } }] })),
  );
  show();
  expect(await screen.findByText((_, el) => el?.tagName === "LI" && /^Natalie lent this to Sarah /.test(el.textContent ?? ""))).toBeInTheDocument();
});

test.each([
  ["Release", ["release"], async () => { await userEvent.click(await screen.findByRole("button", { name: "Release" })); await userEvent.click(screen.getByRole("button", { name: "Release" })); }, "releaseCopy"],
  ["Take", ["adopt"], async () => { await userEvent.click(await screen.findByRole("button", { name: "Take this book" })); }, "adoptCopy"],
  ["Ask", ["request"], async () => { await userEvent.click(await screen.findByRole("button", { name: "Ask to keep this" })); }, "requestCopy"],
] as const)("a 403 not-allowed on %s shows the changed notice and reloads", async (_n, actions, run, fn) => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, actions: [...actions] })));
  vi.mocked(api[fn]).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  show();
  await run();
  expect(await screen.findByText("That's already changed. Here's where the book is now.")).toBeInTheDocument();
  expect(api.getLabel).toHaveBeenCalledTimes(2);
});

test("a 403 not-allowed on Give and on Lend shows the changed notice and reloads", async () => {
  const kim = { id: "4", name: "Kim", pictureUrl: null };
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, actions: ["give", "lend"] })));
  vi.mocked(api.listMembers).mockResolvedValue({ members: [kim] });
  vi.mocked(api.listPeople).mockResolvedValue({ people: [] });
  vi.mocked(api.giveCopy).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  vi.mocked(api.lendCopy).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Give" }));
  await userEvent.click(await screen.findByRole("button", { name: "Kim" }));
  await userEvent.click(screen.getByRole("button", { name: "Give" }));
  expect(await screen.findByText("That's already changed. Here's where the book is now.")).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "Lend" }));
  await userEvent.type(screen.getByRole("textbox"), "ki");
  await userEvent.click(await screen.findByRole("button", { name: "Kim member" }));
  await waitFor(() => expect(api.lendCopy).toHaveBeenCalledWith("c1", { member: "4" }));
  expect(api.getLabel).toHaveBeenCalledTimes(3);
});

test("a 401 on a new action drops to sign-in", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView({ actions: ["request"] }))).mockResolvedValueOnce(publicView);
  vi.mocked(api.requestCopy).mockRejectedValue(new api.ApiError(401, null));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Ask to keep this" }));
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("claim calls claim once and shows the returned state", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  vi.mocked(api.claim).mockResolvedValue(copyView({ holder: { kind: "member", person: ann }, actions: ["return"] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(api.claim).toHaveBeenCalledExactlyOnceWith("abc");
  expect(await screen.findByText(line("With Ann · Ann’s book"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark as returned" })).toBeInTheDocument();
});

test("return calls returnCopy once with the copy id and shows the returned state", async () => {
  vi.mocked(api.getLabel)
    .mockResolvedValueOnce(asCopy(copyView({ actions: ["return"] })))
    .mockResolvedValue(asCopy(copyView({ home: true, holder: { kind: "member", person: ann }, actions: ["claim"] })));
  vi.mocked(api.returnCopy).mockResolvedValue(copyView({ home: true, holder: { kind: "member", person: ann }, actions: ["claim"] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Mark as returned" }));
  expect(api.returnCopy).toHaveBeenCalledExactlyOnceWith("c1");
  expect(await screen.findByText(line("At home · Ann’s book"))).toBeInTheDocument();
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
  expect(screen.getByText(line("With Ann · Ann’s book"))).toBeInTheDocument();
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
  expect(screen.getByText(line("With Natalie · Ann’s book"))).toBeInTheDocument();
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
  expect(screen.queryByRole("heading", { name: "Dune" })).not.toBeInTheDocument();
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
  await screen.findByText(line("With Bob · Ann’s book"));
  // The hero asks for the larger image first, so it takes two failures to give up.
  act(() => { container.querySelector("img")!.dispatchEvent(new Event("error")); });
  act(() => { container.querySelector("img")!.dispatchEvent(new Event("error")); });
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("[data-state=failed]")).not.toBeNull();
  expect(screen.getByText("Cover didn’t load")).toBeInTheDocument();
});

test("names and authors are isolated with bdi so a bidi override cannot reorder the line", async () => {
  const evil = { id: "9", name: "\u202Eevil", pictureUrl: null };
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({
    owner: evil, holder: { kind: "member", person: evil },
    book: { ...book, authors: ["\u202Efoo", "bar"] },
    history: [{ at: 1, type: "claimed", actor: evil }],
  })));
  const { container } = show();
  await screen.findByText(line("With \u202Eevil · \u202Eevil’s book"));
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
  await screen.findByText(line("With Bob · Ann’s book"));
  rerender(<CopyPage code="def" member={me} returnTo="/b/def" />);
  expect(screen.queryByRole("heading", { name: "Dune" })).not.toBeInTheDocument();
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

test("the owner's meta line names the collection inside bdi", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, collection: { id: "k1", name: "Cook \u202Ebooks" }, actions: [] })));
  const { container } = show();
  expect(await screen.findByText(line("In Cook \u202Ebooks"))).toBeInTheDocument();
  const bdis = [...container.querySelectorAll("p bdi")].map((b) => b.textContent);
  expect(bdis).toContain("Cook \u202Ebooks");
});

test("an owner's copy with no collection and no label has no meta line; nobody else sees the collection", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, actions: [] })));
  const { unmount } = show();
  expect(await screen.findByText(line("With Bob"))).toBeInTheDocument();
  expect(screen.queryByText(/^In /)).not.toBeInTheDocument();
  unmount();
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ collection: { id: "k1", name: "Home library" }, actions: [] })));
  show();
  expect(await screen.findByText(line("With Bob · Ann’s book"))).toBeInTheDocument();
  expect(screen.queryByText("Home library")).not.toBeInTheDocument();
});

test("a copy reached by id loads with getCopy, never getLabel, and offers no claim even when listed", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId({ owner: ann, holder: { kind: "member", person: bob }, home: false, actions: ["claim"] }));
  showById();
  expect(await screen.findByText(line("With Bob · Ann’s book"))).toBeInTheDocument();
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
  expect(await screen.findByText(line("In Cookbooks"))).toBeInTheDocument();
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
  await screen.findByText(line("In Home library"));
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
  expect(await screen.findByText(line("In Cookbooks"))).toBeInTheDocument();
  expect(api.getLabel).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Dune")).toBeInTheDocument();
});

test("relabel is never an action button", async () => {
  const names = async (over: Partial<CopyView>) => {
    vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, ...over })));
    const { unmount } = show();
    await screen.findByText("Dune");
    const shown = screen.queryAllByRole("button").map((b) => b.textContent);
    unmount();
    return shown;
  };
  const without = await names({ actions: ["return"] });
  expect(await names({ actions: ["return", "relabel"] })).toEqual(without);
  expect(without).toContain("Mark as returned");
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

test("the owner sees the label code under the book; nobody else does", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, ownerCode: "t7k2q9xzmb" })));
  const { unmount } = show();
  expect(await screen.findByText("Label t7k2q9xzmb")).toHaveClass("label-code");
  unmount();
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ ownerCode: null })));
  const { container } = show();
  await screen.findByText("Dune");
  expect(container.querySelector(".label-code")).toBeNull();
});

test("Replace label links to pairing in replace mode, only when offered", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, actions: ["move", "relabel"] })));
  const { unmount } = show();
  const link = await screen.findByRole("link", { name: "Replace label" });
  expect(link).toHaveAttribute("href", "/pair?copy=c1&replace=1");
  expect(screen.queryByRole("button", { name: "Replace label" })).toBeNull();
  unmount();
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, actions: ["move"] })));
  show();
  await screen.findByText("Dune");
  expect(screen.queryByRole("link", { name: "Replace label" })).toBeNull();
});

test.each([["signed in", me], ["signed out", null]])("a replaced label says so and shows nothing else (%s)", async (_n, who) => {
  vi.mocked(api.getLabel).mockResolvedValue({ kind: "retired" });
  const { container } = show(who);
  const p = await screen.findByText("This label has been replaced.");
  expect(p.tagName).toBe("P");
  expect(p.textContent).toBe("This label has been replaced.");
  expect(screen.queryByText("Dune")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  // Signed in, the only link is the way back.
  expect(screen.queryAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(who ? ["/"] : []);
});

test("Replace label stays hidden when Put a label on it is offered", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, ownerCode: null, actions: ["move", "label"] })));
  show();
  expect(await screen.findByRole("link", { name: "Put a label on it" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Replace label" })).toBeNull();
});

test("an action this page does not know is never a button, and never returns the book", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, actions: ["return", "frobnicate" as never] })));
  show();
  await screen.findByText("Dune");
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Mark as returned"]);
});

test("a claim through a label replaced meanwhile shows only the replaced page", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockResolvedValue({ kind: "retired" });
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(404, "not-found"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(await screen.findByText("This label has been replaced.")).toBeInTheDocument();
  expect(screen.queryByText(/Something went wrong/)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("on a label page, Release re-reads the page so Take appears", async () => {
  vi.mocked(api.getLabel)
    .mockResolvedValueOnce(asCopy(copyView({ owner: me2, actions: ["release"] })))
    .mockResolvedValueOnce(asCopy(copyView({ owner: null, holder: null, actions: ["adopt"] })));
  vi.mocked(api.releaseCopy).mockResolvedValue(copyView({ owner: null, holder: null, code: null, actions: [] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Release" }));
  await userEvent.click(screen.getByRole("button", { name: "Release" }));
  expect(await screen.findByText("No one owns this book.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Take this book" })).toBeInTheDocument();
});

const APP = "Natalie's Little Library";
const h1 = (name: string) => screen.getByRole("heading", { level: 1, name });

test("h1 is the book's title for a public view, with no second heading", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(publicView);
  show(null);
  await screen.findByRole("heading", { level: 1, name: "Dune" });
  expect(screen.queryByRole("heading", { level: 2, name: "Dune" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: APP })).not.toBeInTheDocument();
});

test("h1 is the book's title for a copy view", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  show();
  await screen.findByRole("heading", { level: 1, name: "Dune" });
  expect(screen.queryByRole("heading", { name: APP })).not.toBeInTheDocument();
});

test.each<[string, LabelView]>([
  ["unknown", { kind: "unknown" }],
  ["retired", { kind: "retired" } as LabelView],
  ["blank", { kind: "blank", code: "abc" }],
])("h1 is the app name for a %s label", async (_, view) => {
  vi.mocked(api.getLabel).mockResolvedValue(view);
  show();
  await waitFor(() => expect(vi.mocked(api.getLabel)).toHaveBeenCalled());
  await screen.findByRole("heading", { level: 1, name: APP });
  expect(h1(APP)).toBeInTheDocument();
});

test("h1 is the app name while loading, when gone and when failed", async () => {
  vi.mocked(api.getLabel).mockReturnValue(new Promise(() => {}));
  const a = show();
  expect(h1(APP)).toBeInTheDocument();
  a.unmount();
  vi.mocked(api.getCopy).mockRejectedValue(new api.ApiError(404, null));
  const b = render(<CopyPage copyId="c1" member={me} returnTo="/copies/c1" />);
  await screen.findByText("That book isn't here.");
  expect(h1(APP)).toBeInTheDocument();
  b.unmount();
  vi.mocked(api.getLabel).mockRejectedValue(new Error("boom"));
  show();
  await screen.findByText("The library is having trouble right now. Please try again later.");
  expect(h1(APP)).toBeInTheDocument();
});

async function tabFor(view: LabelView, signedIn = true) {
  const setTab = vi.fn<(t: Tab | null) => void>();
  vi.mocked(api.getLabel).mockResolvedValue(view);
  vi.mocked(api.listMembers).mockResolvedValue({ members: [] });
  vi.mocked(api.myCollections).mockResolvedValue({ owner: me2, collections: [] });
  render(
    <ShellContext.Provider value={{ setTab, setSignedOut: vi.fn() }}>
      <CopyPage code="abc" member={signedIn ? me : null} returnTo="/b/abc" />
    </ShellContext.Provider>,
  );
  expect(setTab).not.toHaveBeenCalled();
  await waitFor(() => expect(setTab).toHaveBeenCalled());
  return setTab;
}

test("a copy I own reports the books tab, once", async () => {
  const setTab = await tabFor(asCopy(copyView({ owner: me2, holder: { kind: "member", person: bob } })));
  expect(setTab.mock.calls).toEqual([["books"]]);
});

test("a copy I hold but don't own reports the holding tab", async () => {
  const setTab = await tabFor(asCopy(copyView({ owner: ann, holder: { kind: "member", person: me2 } })));
  expect(setTab.mock.calls).toEqual([["holding"]]);
});

test("a copy that is someone else's and with someone else reports the friends tab", async () => {
  const setTab = await tabFor(asCopy(copyView({ owner: ann, holder: { kind: "member", person: bob } })));
  expect(setTab.mock.calls).toEqual([["friends"]]);
});

test("a copy held by a placeholder person is not mine to hold", async () => {
  const setTab = await tabFor(asCopy(copyView({ owner: ann, holder: { kind: "person", id: "me-id-1", name: "Natalie" } })));
  expect(setTab.mock.calls).toEqual([["friends"]]);
});

test.each<[string, LabelView]>([
  ["unknown", { kind: "unknown" }],
  ["retired", { kind: "retired" } as LabelView],
  ["blank", { kind: "blank", code: "abc" }],
])("a %s label reports the books tab", async (_, view) => {
  const setTab = await tabFor(view);
  expect(setTab.mock.calls).toEqual([["books"]]);
});

test("signed out, the page never reports a tab", async () => {
  const setTab = vi.fn();
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  render(
    <ShellContext.Provider value={{ setTab, setSignedOut: vi.fn() }}>
      <CopyPage code="abc" member={null} returnTo="/b/abc" />
    </ShellContext.Provider>,
  );
  await screen.findByRole("heading", { level: 1, name: "Dune" });
  expect(setTab).not.toHaveBeenCalled();
});

test("a book at home (holder is the owner, both me) reports books, not holding", async () => {
  const setTab = await tabFor(asCopy(copyView({ owner: me2, holder: { kind: "member", person: me2 }, home: true })));
  expect(setTab.mock.calls).toEqual([["books"]]);
});

// The cover-first layout.
const sam = { id: "5", name: "Sam", pictureUrl: null };
const annMember = { id: "2", name: "Ann", email: "a@example.com", pictureUrl: null, isAdmin: false };
const before = (a: Element, b: Element) => expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
const rows = () => screen.queryByRole("list", { name: "Other actions" });
// Buttons outside the rows list and outside any open flow: the main button.
const mainButtons = () => screen.queryAllByRole("button").filter((b) => !rows()?.contains(b));

test("from the top: back link, title, authors, status line, main button, rows, history", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: ["claim", "request"] })));
  show();
  const title = await screen.findByRole("heading", { level: 1, name: "Dune" });
  const back = screen.getByRole("link", { name: "Back to Friends" });
  const authors = screen.getByText("Frank Herbert");
  const status = screen.getByText(line("With Bob · Ann’s book"));
  const main = screen.getByRole("button", { name: "I have this book" });
  const list = rows()!;
  const history = screen.getByRole("heading", { level: 2, name: "History" });
  [back, title, authors, status, main, list, history].reduce((a, b) => { before(a, b); return b; });
  expect(list).toContainElement(screen.getByRole("button", { name: "Ask to keep this" }));
  expect(history.nextElementSibling).toContainElement(screen.getByText((_, el) => el?.tagName === "LI" && /^Bob took it /.test(el.textContent ?? "")));
});

test("the status line: at home or with someone, plus whose book for anyone but the owner", async () => {
  const at = async (member: typeof me, over: Partial<CopyView>, text: string) => {
    vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, actions: [], ...over })));
    const { unmount } = render(<CopyPage code="abc" member={member} returnTo="/b/abc" />);
    expect(await screen.findByText(line(text))).toBeInTheDocument();
    unmount();
  };
  await at(me, { home: true, holder: { kind: "member", person: me2 } }, "At home");
  await at(me, { holder: { kind: "member", person: sam } }, "With Sam");
  await at(annMember, { home: true, holder: { kind: "member", person: me2 } }, "At home · Natalie’s book");
  await at(annMember, { holder: { kind: "member", person: sam } }, "With Sam · Natalie’s book");
  await at(annMember, { owner: { ...me2, removed: true }, holder: { kind: "member", person: { ...sam, removed: true } } },
    "With Sam (no longer a member) · Natalie (no longer a member)’s book");
  await at(annMember, { holder: { kind: "person", id: "p1", name: "Grandad" } }, "With Grandad · Natalie’s book");
});

test("a book no one owns says so in the status line, with no leading separator", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: null, holder: null, actions: [] })));
  show();
  const p = (await screen.findByText("No one owns this book.")).closest("p")!;
  expect(p.textContent).toBe("No one owns this book.");
});

test("the owner sees 'In {collection} · Label {code}' under the status line", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({
    owner: me2, home: true, holder: { kind: "member", person: me2 }, ownerCode: "t7k2q9xzmb", collection: { id: "k1", name: "Home library" }, actions: [],
  })));
  show();
  const meta = await screen.findByText(line("In Home library · Label t7k2q9xzmb"));
  before(screen.getByText(line("At home")), meta);
});

test("one main button, picked by mainAction; the other actions are rows, with label and relabel as links", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({
    owner: me2, home: true, holder: { kind: "member", person: me2 }, collection: { id: "k1", name: "Home library" },
    actions: ["give", "move", "relabel", "release", "lend"],
  })));
  vi.mocked(api.myCollections).mockResolvedValue(mine);
  show();
  await screen.findByRole("combobox", { name: "Move to" });
  expect(mainButtons().map((b) => b.textContent)).toEqual(["Lend"]);
  const list = rows()!;
  for (const name of ["Give", "Release", "Move"]) expect(list).toContainElement(screen.getByRole("button", { name }));
  expect(list).toContainElement(screen.getByRole("link", { name: "Replace label" }));
});

test("Put a label on it is a row link too", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId({ actions: ["label", "give"] }));
  showById();
  const link = await screen.findByRole("link", { name: "Put a label on it" });
  expect(rows()).toContainElement(link);
});

test("with no main action there is no main button", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ owner: me2, actions: ["give", "release", "decline"] })));
  show();
  await screen.findByRole("button", { name: "Give" });
  expect(mainButtons()).toEqual([]);
  expect(rows()).toContainElement(screen.getByRole("button", { name: "Decline" }));
});

test("reached by id, a friend's book offers Ask as the main button, never claim", async () => {
  vi.mocked(api.getCopy).mockResolvedValue(byId({ owner: ann, holder: { kind: "member", person: bob }, home: false, actions: ["claim", "request"] }));
  showById();
  await screen.findByRole("heading", { level: 1, name: "Dune" });
  expect(mainButtons().map((b) => b.textContent)).toEqual(["Ask to keep this"]);
  expect(rows()).toBeNull();
});

test.each([
  ["a wall of mine", "/", "Back to My books", "/"],
  ["Holding", "/holding", "Back to Holding", "/holding"],
  ["the owner's wall", "/members/2", "Back to Ann’s books", "/members/2"],
  ["another member's wall", "/members/9", "Back to Friends", "/members"],
  ["another site", "https://elsewhere.test/holding", "Back to Friends", "/members"],
  ["no referrer", "", "Back to Friends", "/members"],
])("the back link after %s comes from backFor", async (_n, from, name, href) => {
  referrer(from.startsWith("/") ? location.origin + from : from);
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ actions: [] })));
  show();
  expect(await screen.findByRole("link", { name })).toHaveAttribute("href", href);
});

test("the back link to a collection names it", async () => {
  referrer(`${location.origin}/collections/k1`);
  vi.mocked(api.getCopy).mockResolvedValue(byId());
  vi.mocked(api.myCollections).mockResolvedValue(mine);
  showById();
  expect(await screen.findByRole("link", { name: "Back to Home library" })).toHaveAttribute("href", "/collections/k1");
});

test("the back link keeps the tab it started with, even after a claim makes me the holder", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  vi.mocked(api.claim).mockResolvedValue(copyView({ holder: { kind: "member", person: me2 }, actions: ["return"] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  await screen.findByRole("button", { name: "Mark as returned" });
  expect(screen.getByRole("link", { name: "Back to Friends" })).toHaveAttribute("href", "/members");
});

test("label states go back to My books", async () => {
  vi.mocked(api.getLabel).mockResolvedValue({ kind: "blank", code: "abc" });
  referrer(`${location.origin}/holding`);
  show();
  expect(await screen.findByRole("link", { name: "Back to My books" })).toHaveAttribute("href", "/");
});

test("signed out, there is no back link and sign-in takes the main button's place", async () => {
  referrer(`${location.origin}/holding`);
  vi.mocked(api.getLabel).mockResolvedValue(publicView);
  show(null);
  const title = await screen.findByRole("heading", { level: 1, name: "Dune" });
  expect(screen.queryByRole("link", { name: /^Back to/ })).not.toBeInTheDocument();
  const signIn = screen.getByRole("link", { name: "Sign in with Google" });
  before(title, screen.getByText("Sign in to see who has this book or to take it."));
  before(screen.getByText("Sign in to see who has this book or to take it."), signIn);
  expect(screen.queryAllByRole("link")).toEqual([signIn]);
});

test("losing the session mid-visit takes the back link away", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockResolvedValueOnce(publicView);
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(401, null));
  show();
  expect(await screen.findByRole("link", { name: "Back to Friends" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "I have this book" }));
  await screen.findByRole("link", { name: "Sign in with Google" });
  expect(screen.queryByRole("link", { name: /^Back to/ })).not.toBeInTheDocument();
});

test("the title is not focused on load, and is focused once an action is done", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView()));
  vi.mocked(api.claim).mockResolvedValue(copyView({ holder: { kind: "member", person: me2 }, actions: ["return"] }));
  show();
  const title = await screen.findByRole("heading", { level: 1, name: "Dune" });
  expect(title).not.toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "I have this book" }));
  await screen.findByRole("button", { name: "Mark as returned" });
  expect(screen.getByRole("heading", { level: 1, name: "Dune" })).toHaveFocus();
});

test("after a refused action the title takes focus and the notice is still an alert", async () => {
  vi.mocked(api.getLabel)
    .mockResolvedValueOnce(asCopy(copyView()))
    .mockResolvedValueOnce(asCopy(copyView({ holder: { kind: "member", person: ann }, actions: [] })));
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(403, "not-allowed"));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That's already changed.");
  await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Dune" })).toHaveFocus());
});

test("after a step is done (Release), focus lands on the title, not the top of the document", async () => {
  vi.mocked(api.getLabel)
    .mockResolvedValueOnce(asCopy(copyView({ owner: me2, actions: ["release"] })))
    .mockResolvedValueOnce(asCopy(copyView({ owner: null, holder: null, actions: ["adopt"] })));
  vi.mocked(api.releaseCopy).mockResolvedValue(copyView({ owner: null, holder: null, actions: [] }));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Release" }));
  await userEvent.click(screen.getByRole("button", { name: "Release" }));
  await screen.findByRole("button", { name: "Take this book" });
  expect(screen.getByRole("heading", { level: 1, name: "Dune" })).toHaveFocus();
});

test("a session lost during an action focuses the signed-out page's title", async () => {
  vi.mocked(api.getLabel).mockResolvedValueOnce(asCopy(copyView())).mockResolvedValueOnce(publicView);
  vi.mocked(api.claim).mockRejectedValue(new api.ApiError(401, null));
  show();
  await userEvent.click(await screen.findByRole("button", { name: "I have this book" }));
  await screen.findByRole("link", { name: "Sign in with Google" });
  expect(screen.getByRole("heading", { level: 1, name: "Dune" })).toHaveFocus();
});

test("with no history there is no History heading", async () => {
  vi.mocked(api.getLabel).mockResolvedValue(asCopy(copyView({ history: [], actions: [] })));
  show();
  await screen.findByRole("heading", { level: 1, name: "Dune" });
  expect(screen.queryByRole("heading", { name: "History" })).not.toBeInTheDocument();
});
