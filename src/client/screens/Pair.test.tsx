import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BookInfo, CollectionSummary, CopyView, ShelfItem } from "../../shared/types";
import * as api from "../api";
import { Pair } from "./Pair";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, lookupBook: vi.fn(), addCopy: vi.fn(), getCandidates: vi.fn(), getCopy: vi.fn(), labelCopy: vi.fn(), myCollections: vi.fn(), createCollection: vi.fn() };
});

// A camera still pointed at a label reads it again on every fresh scanner: set this to model that.
let mockOnMount: { want: string; reading: unknown } | null = null;

vi.mock("../scanner", () => ({
  Scanner: (props: {
    want: string;
    onRead: (r: unknown) => void;
    onProblem: (p: string) => void;
  }) => {
    useEffect(() => {
      if (mockOnMount && mockOnMount.want === props.want) props.onRead(mockOnMount.reading);
    }, []);
    return (
    <div data-testid="scanner" data-want={props.want}>
      <button type="button" onClick={() => props.onRead({ kind: "isbn", isbn: "9780000000002" })}>stub isbn</button>
      <button type="button" onClick={() => props.onRead({ kind: "label", code: "t7k2q9xzmb" })}>stub label</button>
      <button type="button" onClick={() => props.onRead({ kind: "label", code: "mmmmmmmmmm" })}>stub other label</button>
      <button type="button" onClick={() => props.onProblem("no-camera")}>stub no-camera</button>
      <button type="button" onClick={() => props.onProblem("denied")}>stub denied</button>
      <button type="button" onClick={() => props.onProblem("decoder-failed")}>stub decoder-failed</button>
    </div>
    );
  },
}));

const me = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };
const book: BookInfo = { isbn: "9780000000002", title: "Dune", authors: ["Frank Herbert"], coverUrl: null };
const copy = { copyId: "c1", code: "t7k2q9xzmb" } as CopyView;
const assign = vi.fn();
const col = (id: string, name: string, isDefault = false): CollectionSummary => ({ id, name, isDefault, count: 1, unlabelled: 0 });
const two = [col("h", "Home library", true), col("g", "Garage")];
const mineIs = (collections: CollectionSummary[]) =>
  vi.mocked(api.myCollections).mockResolvedValue({ owner: { id: "1", name: "Natalie", pictureUrl: null }, collections });
const item = (copyId: string, title: string, collection = "Imported"): ShelfItem => ({
  copyId, book: { isbn: null, title, authors: ["A. Writer"], coverUrl: null }, labelled: false,
  owner: { id: "1", name: "Natalie", pictureUrl: null }, holder: { kind: "member", person: { id: "1", name: "Natalie", pictureUrl: null } },
  home: true, collection: { id: "i", name: collection },
});

beforeEach(() => {
  vi.resetAllMocks();
  mockOnMount = null;
  vi.stubGlobal("location", { ...window.location, assign, search: "" });
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.mocked(api.getCandidates).mockResolvedValue({ sameIsbn: null, similar: [] });
  vi.mocked(api.myCollections).mockResolvedValue({ owner: { id: "1", name: "Natalie", pictureUrl: null }, collections: [col("h", "Home library", true)] });
});
afterEach(() => vi.unstubAllGlobals());

const show = (search = "", member: typeof me | null = me) => {
  vi.stubGlobal("location", { ...window.location, assign, search });
  return render(<Pair member={member} returnTo={`/pair${search}`} />);
};
const click = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));
const wantOf = () => screen.getByTestId("scanner").dataset.want;
const para = (t: string) => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === t);
const refuse = (status: number, rejected: api.ApiError["rejected"]) => new api.ApiError(status, rejected);

async function toConfirm() {
  vi.mocked(api.lookupBook).mockResolvedValue({ book });
  await click("stub isbn");
  await screen.findByText("Is this the book?");
}

test("signed out shows only the sign-in link", () => {
  show("", null);
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Fpair");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByTestId("scanner")).not.toBeInTheDocument();
});

test("happy path saves by ISBN once and goes to the book's page", async () => {
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show();
  expect(screen.getByText("Scan the barcode on the back of the book.")).toBeInTheDocument();
  expect(wantOf()).toBe("isbn");
  expect(screen.getByRole("button", { name: "No barcode? Type it in" })).toBeInTheDocument();
  await toConfirm();
  expect(api.lookupBook).toHaveBeenCalledWith("9780000000002");
  expect(screen.getByText("Dune")).toBeInTheDocument();
  await click("Yes");
  expect(screen.getByText("Now scan a blank label.")).toBeInTheDocument();
  expect(wantOf()).toBe("label");
  expect(api.addCopy).not.toHaveBeenCalled();
  await click("stub label");
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/b/t7k2q9xzmb"));
  expect(api.addCopy).toHaveBeenCalledTimes(1);
  expect(api.addCopy).toHaveBeenCalledWith({ code: "t7k2q9xzmb", isbn: "9780000000002" });
});

test("No, scan again returns to the barcode step and saves nothing", async () => {
  show();
  await toConfirm();
  await click("No, scan again");
  expect(screen.getByText("Scan the barcode on the back of the book.")).toBeInTheDocument();
  expect(wantOf()).toBe("isbn");
  expect(api.addCopy).not.toHaveBeenCalled();
});

test("a lookup miss offers typing first, keeping the ISBN", async () => {
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null });
  show();
  await click("stub isbn");
  await screen.findByText("We couldn't find that book.");
  const buttons = screen.getAllByRole("button").map((b) => b.textContent);
  expect(buttons.indexOf("Type the title")).toBeLessThan(buttons.indexOf("Scan again"));
  await click("Type the title");
  expect(screen.getByLabelText("ISBN (optional)")).toHaveValue("9780000000002");
});

test("a lookup that fails outright is treated as a miss", async () => {
  vi.mocked(api.lookupBook).mockRejectedValue(refuse(503, null));
  show();
  await click("stub isbn");
  await screen.findByText("We couldn't find that book.");
});

test("typed title and author save without an ISBN", async () => {
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show();
  await click("No barcode? Type it in");
  await userEvent.type(screen.getByLabelText("Title"), "Home Made");
  await userEvent.type(screen.getByLabelText("Author"), "A. Person");
  await click("Continue");
  await click("stub label");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledWith({ code: "t7k2q9xzmb", title: "Home Made", authors: ["A. Person"] }));
});

test("a typed ISBN that is valid goes to the confirm step in 13-digit form", async () => {
  vi.mocked(api.lookupBook).mockResolvedValue({ book });
  show();
  await click("No barcode? Type it in");
  await userEvent.type(screen.getByLabelText("ISBN (optional)"), "0-00-000000-0");
  await click("Continue");
  await screen.findByText("Is this the book?");
  expect(api.lookupBook).toHaveBeenCalledWith("9780000000002");
});

test("a typed ISBN that is not an ISBN is an error beside the field", async () => {
  show();
  await click("No barcode? Type it in");
  await userEvent.type(screen.getByLabelText("ISBN (optional)"), "12345");
  await click("Continue");
  expect(screen.getByLabelText("ISBN (optional)")).toHaveAccessibleDescription("That isn't a book ISBN.");
  expect(api.lookupBook).not.toHaveBeenCalled();
});

test("typing needs a title when there is no ISBN", async () => {
  show();
  await click("No barcode? Type it in");
  await click("Continue");
  expect(screen.getByLabelText("Title")).toHaveAccessibleDescription("Type the title.");
});

test("?label= skips the label step and saves with the lowercase code", async () => {
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show("?label=T7K2Q9XZMB");
  await toConfirm();
  await click("Yes");
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/b/t7k2q9xzmb"));
  expect(api.addCopy).toHaveBeenCalledWith({ code: "t7k2q9xzmb", isbn: "9780000000002" });
});

test("a ?label= that does not parse does not skip the label step", async () => {
  show("?label=nonsense");
  await toConfirm();
  await click("Yes");
  expect(screen.getByText("Now scan a blank label.")).toBeInTheDocument();
});

test("a typed label code is accepted in any case and sent lowercase", async () => {
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show();
  await toConfirm();
  await click("Yes");
  await userEvent.type(screen.getByLabelText("Or type the code printed under it"), " T7K2Q9XZMB ");
  await click("Use this code");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledWith({ code: "t7k2q9xzmb", isbn: "9780000000002" }));
});

test("a typed label code that is not a label code is an error beside the field", async () => {
  show();
  await toConfirm();
  await click("Yes");
  await userEvent.type(screen.getByLabelText("Or type the code printed under it"), "nope");
  await click("Use this code");
  expect(screen.getByLabelText("Or type the code printed under it")).toHaveAccessibleDescription("That isn't a label code.");
  expect(api.addCopy).not.toHaveBeenCalled();
});

test("label-in-use returns to the label step with the book kept", async () => {
  vi.mocked(api.addCopy).mockRejectedValue(refuse(409, "label-in-use"));
  show("?label=T7K2Q9XZMB");
  await toConfirm();
  await click("Yes");
  expect(await screen.findByText("That label is already on a book. Use a blank one.")).toBeInTheDocument();
  expect(screen.getByText("Now scan a blank label.")).toBeInTheDocument();
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  await click("stub other label");
  await waitFor(() => expect(api.addCopy).toHaveBeenLastCalledWith({ code: "mmmmmmmmmm", isbn: "9780000000002" }));
  expect(api.addCopy).toHaveBeenCalledTimes(2);
});

test("label-unknown returns to the label step", async () => {
  vi.mocked(api.addCopy).mockRejectedValue(refuse(404, "label-unknown"));
  show();
  await toConfirm();
  await click("Yes");
  await click("stub label");
  expect(await screen.findByText("That isn't one of our labels.")).toBeInTheDocument();
  expect(screen.getByText("Now scan a blank label.")).toBeInTheDocument();
});

test("book-not-found goes to typing with the ISBN kept", async () => {
  vi.mocked(api.addCopy).mockRejectedValue(refuse(404, "book-not-found"));
  show();
  await toConfirm();
  await click("Yes");
  await click("stub label");
  const field = await screen.findByLabelText("ISBN (optional)");
  expect(field).toHaveValue("9780000000002");
  expect(screen.getByLabelText("Title")).toBeInTheDocument();
});

test("any other failure says so and keeps the data for another try", async () => {
  vi.mocked(api.addCopy).mockRejectedValueOnce(refuse(500, null));
  show("?label=T7K2Q9XZMB");
  await toConfirm();
  await click("Yes");
  expect(await screen.findByText("Something went wrong saving that. Try again.")).toBeInTheDocument();
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  await click("Try again");
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/b/t7k2q9xzmb"));
  expect(api.addCopy).toHaveBeenLastCalledWith({ code: "t7k2q9xzmb", isbn: "9780000000002" });
});

test("a lost session while saving shows the sign-in link", async () => {
  vi.mocked(api.addCopy).mockRejectedValue(refuse(401, null));
  show("?label=T7K2Q9XZMB");
  await toConfirm();
  await click("Yes");
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test.each([
  ["no-camera", "This device has no camera we can use."],
  ["denied", "Camera access was refused. You can allow it in your browser's settings, or type instead."],
  ["decoder-failed", "The scanner couldn't start. Type instead."],
])("barcode step: scanner problem %s shows its line and the typing fields", async (problem, text) => {
  show();
  await click(`stub ${problem}`);
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.queryByTestId("scanner")).not.toBeInTheDocument();
  expect(screen.getByLabelText("ISBN (optional)")).toBeInTheDocument();
});

test.each([
  ["no-camera", "This device has no camera we can use."],
  ["denied", "Camera access was refused. You can allow it in your browser's settings, or type instead."],
  ["decoder-failed", "The scanner couldn't start. Type instead."],
])("label step: scanner problem %s shows its line and the code field", async (problem, text) => {
  show();
  await toConfirm();
  await click("Yes");
  await click(`stub ${problem}`);
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.queryByTestId("scanner")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Or type the code printed under it")).toBeInTheDocument();
});

test("a double tap on the final step sends one request", async () => {
  let release: (c: CopyView) => void = () => {};
  vi.mocked(api.addCopy).mockReturnValue(new Promise((r) => (release = r)));
  show();
  await toConfirm();
  await click("Yes");
  await userEvent.type(screen.getByLabelText("Or type the code printed under it"), "t7k2q9xzmb");
  const use = screen.getByRole("button", { name: "Use this code" });
  await userEvent.dblClick(use);
  expect(api.addCopy).toHaveBeenCalledTimes(1);
  release(copy);
  await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
});

test("Start over is absent on step 1 and clears everything from step 2 on", async () => {
  show();
  expect(screen.queryByRole("button", { name: "Start over" })).not.toBeInTheDocument();
  await toConfirm();
  await click("Start over");
  expect(screen.getByText("Scan the barcode on the back of the book.")).toBeInTheDocument();
  await click("stub isbn");
  await click("Yes");
  await click("Start over");
  expect(screen.getByText("Scan the barcode on the back of the book.")).toBeInTheDocument();
  expect(api.addCopy).not.toHaveBeenCalled();
});

const LINKED = "?label=T7K2Q9XZMB";
const saved = () => vi.mocked(api.addCopy).mock.calls.map((c) => c[0]);

test("?label=: a first typed save sends the title just typed", async () => {
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show(LINKED);
  await click("No barcode? Type it in");
  await userEvent.type(screen.getByLabelText("Title"), "Home Made");
  await userEvent.type(screen.getByLabelText("Author"), "A. Person");
  await click("Continue");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(saved()).toStrictEqual([{ code: "t7k2q9xzmb", title: "Home Made", authors: ["A. Person"] }]);
});

test("?label=: a title typed with an empty author saves with no authors, which the server accepts", async () => {
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show(LINKED);
  await click("No barcode? Type it in");
  await userEvent.type(screen.getByLabelText("Title"), "Home Made");
  await click("Continue");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(saved()).toStrictEqual([{ code: "t7k2q9xzmb", title: "Home Made", authors: [] }]);
});

test("a miss then a title (ISBN still in the field) saves by title with one lookup", async () => {
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null });
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show(LINKED);
  await click("stub isbn");
  await click("Type the title");
  expect(screen.getByLabelText("ISBN (optional)")).toHaveValue("9780000000002");
  await userEvent.type(screen.getByLabelText("Title"), "Hom Made");
  await userEvent.type(screen.getByLabelText("Author"), "A. Person");
  await click("Continue");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(saved()).toStrictEqual([{ code: "t7k2q9xzmb", title: "Hom Made", authors: ["A. Person"] }]);
  expect(api.lookupBook).toHaveBeenCalledTimes(1);
});

test("a miss, a title, and without a linked label the title goes to the label step with no lookup", async () => {
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null });
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show();
  await click("stub isbn");
  await click("Type the title");
  await userEvent.type(screen.getByLabelText("Title"), "Home Made");
  await click("Continue");
  expect(screen.getByText("Now scan a blank label.")).toBeInTheDocument();
  await click("stub label");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(saved()).toStrictEqual([{ code: "t7k2q9xzmb", title: "Home Made", authors: [] }]);
  expect(api.lookupBook).toHaveBeenCalledTimes(1);
});

test("?label=: a title after book-not-found is saved by title, not the old ISBN", async () => {
  vi.mocked(api.addCopy).mockRejectedValueOnce(refuse(404, "book-not-found"));
  show(LINKED);
  await toConfirm();
  await click("Yes");
  await screen.findByLabelText("ISBN (optional)");
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  await userEvent.type(screen.getByLabelText("Title"), "Dune");
  await userEvent.clear(screen.getByLabelText("ISBN (optional)"));
  await click("Continue");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(saved()[1]).toStrictEqual({ code: "t7k2q9xzmb", title: "Dune", authors: [] });
  expect(api.lookupBook).toHaveBeenCalledTimes(1);
});

test("?label=: after book-not-found a title with the ISBN left in the field still saves by title", async () => {
  vi.mocked(api.addCopy).mockRejectedValueOnce(refuse(404, "book-not-found"));
  show(LINKED);
  await toConfirm();
  await click("Yes");
  await screen.findByLabelText("ISBN (optional)");
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  await userEvent.type(screen.getByLabelText("Title"), "Dune");
  await click("Continue");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(saved()[1]).toStrictEqual({ code: "t7k2q9xzmb", title: "Dune", authors: [] });
});

test("?label=: Try again after a failed typed save resends the typed title", async () => {
  vi.mocked(api.addCopy).mockRejectedValueOnce(refuse(500, null));
  show(LINKED);
  await click("No barcode? Type it in");
  await userEvent.type(screen.getByLabelText("Title"), "Home Made");
  await click("Continue");
  await screen.findByText("Something went wrong saving that. Try again.");
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  await click("Try again");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(saved()[1]).toStrictEqual({ code: "t7k2q9xzmb", title: "Home Made", authors: [] });
});

test("an ISBN that was never confirmed is never sent", async () => {
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null });
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show();
  await click("stub isbn");
  await click("Scan again");
  await click("No barcode? Type it in");
  await userEvent.type(screen.getByLabelText("Title"), "Home Made");
  await click("Continue");
  await click("stub label");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(saved()[0]).toStrictEqual({ code: "t7k2q9xzmb", title: "Home Made", authors: [] });
});

test("two submits in one tick send one request", async () => {
  vi.mocked(api.addCopy).mockReturnValue(new Promise(() => {}));
  show();
  await toConfirm();
  await click("Yes");
  await userEvent.type(screen.getByLabelText("Or type the code printed under it"), "t7k2q9xzmb");
  const form = screen.getByRole("button", { name: "Use this code" }).closest("form")!;
  // One act: React does not re-render between the two, as with two taps before a frame.
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(api.addCopy).toHaveBeenCalledTimes(1);
});

test("a lookup that comes back after Start over is ignored", async () => {
  let answer: (v: { book: BookInfo | null }) => void = () => {};
  vi.mocked(api.lookupBook).mockReturnValue(new Promise((r) => (answer = r)));
  show();
  await click("stub isbn");
  await screen.findByText("Looking that up…");
  await click("Start over");
  answer({ book });
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.getByText("Scan the barcode on the back of the book.")).toBeInTheDocument();
  expect(screen.queryByText("Is this the book?")).not.toBeInTheDocument();
});

test("Start over is not offered while saving", async () => {
  vi.mocked(api.addCopy).mockReturnValue(new Promise(() => {}));
  show(LINKED);
  await toConfirm();
  await click("Yes");
  await screen.findByText("Saving…");
  expect(screen.queryByRole("button", { name: "Start over" })).not.toBeInTheDocument();
});

test("a save that finishes after the page is gone does not navigate", async () => {
  let ok: (c: CopyView) => void = () => {};
  vi.mocked(api.addCopy).mockReturnValue(new Promise((r) => (ok = r)));
  const view = show(LINKED);
  await toConfirm();
  await click("Yes");
  view.unmount();
  ok(copy);
  await new Promise((r) => setTimeout(r, 20));
  expect(assign).not.toHaveBeenCalled();
});

test("a refused label still in front of the camera is not saved again, and the notice stays", async () => {
  vi.mocked(api.addCopy).mockRejectedValue(refuse(409, "label-in-use"));
  show();
  await toConfirm();
  await click("Yes");
  mockOnMount = { want: "label", reading: { kind: "label", code: "t7k2q9xzmb" } };
  await click("stub label");
  expect(await screen.findByText("That label is already on a book. Use a blank one.")).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 50));
  expect(api.addCopy).toHaveBeenCalledTimes(1);
  expect(screen.getByText("That label is already on a book. Use a blank one.")).toBeInTheDocument();
});

test("after a refusal a different label read is saved, and the same code typed is tried again", async () => {
  vi.mocked(api.addCopy).mockRejectedValueOnce(refuse(409, "label-in-use"));
  show();
  await toConfirm();
  await click("Yes");
  await click("stub label");
  await screen.findByText("That label is already on a book. Use a blank one.");
  vi.mocked(api.addCopy).mockRejectedValueOnce(refuse(409, "label-in-use"));
  await click("stub other label");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledTimes(2));
  expect(saved()[1]).toStrictEqual({ code: "mmmmmmmmmm", isbn: "9780000000002" });
  await screen.findByText("That label is already on a book. Use a blank one.");
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  await userEvent.type(screen.getByLabelText("Or type the code printed under it"), "mmmmmmmmmm");
  await click("Use this code");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledTimes(3));
});

test("the typing fields stop at the server's limits, so a long title cannot loop on a refusal", async () => {
  show();
  await click("No barcode? Type it in");
  expect(screen.getByLabelText("Title")).toHaveAttribute("maxlength", "300");
  expect(screen.getByLabelText("Author")).toHaveAttribute("maxlength", "200");
});

// ---- Task 10: collections, imported copies, labelling from the shelf ----

test("an imported copy with the same ISBN is shown even when the lookup misses, and saving sends no collection", async () => {
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null });
  vi.mocked(api.getCandidates).mockResolvedValue({ sameIsbn: item("c9", "Dune (imported)", "Imported"), similar: [] });
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  mineIs(two);
  show();
  await click("stub isbn");
  await screen.findByText("Is this the book?");
  expect(screen.getByText("Dune (imported)")).toBeInTheDocument();
  expect(para("From Imported")).toBeInTheDocument();
  expect(api.getCandidates).toHaveBeenCalledWith({ isbn: "9780000000002" });
  await click("Yes");
  expect(para("It stays in Imported.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Collection")).not.toBeInTheDocument();
  await click("stub label");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(api.addCopy).toHaveBeenCalledTimes(1);
  expect(api.addCopy).toHaveBeenCalledWith({ code: "t7k2q9xzmb", isbn: "9780000000002" });
});

test("a title match after a lookup offers the copies, and picking one labels that copy", async () => {
  vi.mocked(api.getCandidates).mockImplementation(async (q) => (q.title !== undefined ? { sameIsbn: null, similar: [item("c5", "Dune")] } : { sameIsbn: null, similar: [] }));
  vi.mocked(api.labelCopy).mockResolvedValue(copy);
  show();
  await toConfirm();
  await click("Yes");
  await screen.findByText("Is it one of these?");
  expect(api.getCandidates).toHaveBeenCalledWith({ title: "Dune" });
  await click(/^This one/);
  expect(para("It stays in Imported.")).toBeInTheDocument();
  await click("stub label");
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/b/t7k2q9xzmb"));
  expect(api.labelCopy).toHaveBeenCalledWith("c5", "t7k2q9xzmb");
  expect(api.addCopy).not.toHaveBeenCalled();
});

test("No, it's a different copy continues to a new copy", async () => {
  vi.mocked(api.getCandidates).mockImplementation(async (q) => (q.title !== undefined ? { sameIsbn: null, similar: [item("c5", "Dune")] } : { sameIsbn: null, similar: [] }));
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show();
  await toConfirm();
  await click("Yes");
  await screen.findByText("Is it one of these?");
  await click("No, it's a different copy");
  await click("stub label");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledWith({ code: "t7k2q9xzmb", isbn: "9780000000002" }));
  expect(api.labelCopy).not.toHaveBeenCalled();
});

test("a typed title also asks, and a candidates failure still lets a new copy be saved", async () => {
  vi.mocked(api.getCandidates).mockImplementation(async () => ({ sameIsbn: null, similar: [item("c5", "Home Made")] }));
  show();
  await click("No barcode? Type it in");
  await userEvent.type(screen.getByLabelText("Title"), "Home Made");
  await click("Continue");
  await screen.findByText("Is it one of these?");
  expect(api.getCandidates).toHaveBeenCalledWith({ title: "Home Made" });
});

test("a failed candidates request is no candidates, for the ISBN and the title", async () => {
  vi.mocked(api.getCandidates).mockRejectedValue(refuse(500, null));
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show();
  await toConfirm();
  await click("Yes");
  await click("stub label");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledWith({ code: "t7k2q9xzmb", isbn: "9780000000002" }));
});

test("a 401 from the candidates request shows sign-in with the way back", async () => {
  vi.mocked(api.lookupBook).mockResolvedValue({ book });
  vi.mocked(api.getCandidates).mockRejectedValue(refuse(401, "signed-out"));
  show("?label=T7K2Q9XZMB");
  await click("stub isbn");
  const link = await screen.findByRole("link", { name: "Sign in with Google" });
  expect(link).toHaveAttribute("href", "/auth/login?returnTo=%2Fpair%3Flabel%3DT7K2Q9XZMB");
});

test("/pair?copy= goes straight to the label step and labels that copy, never adding one", async () => {
  vi.mocked(api.getCopy).mockResolvedValue({ ...copy, code: null, book, actions: ["label"] } as CopyView);
  vi.mocked(api.labelCopy).mockResolvedValue(copy);
  show("?copy=c1");
  await screen.findByText("Now scan a blank label.");
  expect(api.getCopy).toHaveBeenCalledWith("c1");
  expect(screen.getByText("Dune")).toBeInTheDocument();
  await click("stub label");
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/b/t7k2q9xzmb"));
  expect(api.labelCopy).toHaveBeenCalledWith("c1", "t7k2q9xzmb");
  expect(api.addCopy).not.toHaveBeenCalled();
});

test("/pair?copy= with a code in the address labels without scanning", async () => {
  vi.mocked(api.getCopy).mockResolvedValue({ ...copy, code: null, book, actions: ["label"] } as CopyView);
  vi.mocked(api.labelCopy).mockResolvedValue(copy);
  show("?copy=c1&label=T7K2Q9XZMB");
  await waitFor(() => expect(api.labelCopy).toHaveBeenCalledWith("c1", "t7k2q9xzmb"));
  expect(api.addCopy).not.toHaveBeenCalled();
});

test("a double tap on a label sends one labelCopy", async () => {
  vi.mocked(api.getCopy).mockResolvedValue({ ...copy, code: null, book, actions: ["label"] } as CopyView);
  vi.mocked(api.labelCopy).mockReturnValue(new Promise(() => {}));
  show("?copy=c1");
  await screen.findByText("Now scan a blank label.");
  const b = screen.getByRole("button", { name: "stub label" });
  await act(async () => { b.click(); b.click(); });
  expect(api.labelCopy).toHaveBeenCalledTimes(1);
});

test.each([
  ["label-in-use", "That label is already on a book. Use a blank one."],
  ["label-unknown", "That isn't one of our labels."],
] as const)("/pair?copy= refused %s asks for another label and does not resend the same one", async (why, text) => {
  vi.mocked(api.getCopy).mockResolvedValue({ ...copy, code: null, book, actions: ["label"] } as CopyView);
  vi.mocked(api.labelCopy).mockRejectedValue(refuse(409, why));
  show("?copy=c1");
  await screen.findByText("Now scan a blank label.");
  await click("stub label");
  await screen.findByText(text);
  expect(wantOf()).toBe("label");
  await click("stub label");
  expect(api.labelCopy).toHaveBeenCalledTimes(1);
  await click("stub other label");
  await waitFor(() => expect(api.labelCopy).toHaveBeenCalledTimes(2));
  expect(api.labelCopy).toHaveBeenLastCalledWith("c1", "mmmmmmmmmm");
  expect(api.addCopy).not.toHaveBeenCalled();
});

test.each([
  ["gone", () => vi.mocked(api.getCopy).mockRejectedValue(refuse(404, "not-found"))],
  ["already labelled or not yours", () => vi.mocked(api.getCopy).mockResolvedValue({ ...copy, code: null, book, actions: [] } as CopyView)],
])("/pair?copy= for a copy that is %s can't take a label", async (_n, arrange) => {
  arrange();
  show("?copy=c1");
  await screen.findByText("That book can't take a label here.");
  expect(screen.getByRole("link", { name: "My books" })).toHaveAttribute("href", "/mine");
  expect(screen.queryByTestId("scanner")).not.toBeInTheDocument();
  expect(api.labelCopy).not.toHaveBeenCalled();
});

test("labelCopy refused not-allowed says the book has a label and goes back to the start", async () => {
  vi.mocked(api.getCopy).mockResolvedValue({ ...copy, code: null, book, actions: ["label"] } as CopyView);
  vi.mocked(api.labelCopy).mockRejectedValue(refuse(409, "not-allowed"));
  show("?copy=c1");
  await screen.findByText("Now scan a blank label.");
  await click("stub label");
  await screen.findByText("That book already has a label.");
  expect(wantOf()).toBe("isbn");
});

test("labelCopy refused not-found shows that the book can't take a label", async () => {
  vi.mocked(api.getCopy).mockResolvedValue({ ...copy, code: null, book, actions: ["label"] } as CopyView);
  vi.mocked(api.labelCopy).mockRejectedValue(refuse(404, "not-found"));
  show("?copy=c1");
  await screen.findByText("Now scan a blank label.");
  await click("stub label");
  await screen.findByText("That book can't take a label here.");
});

test("a lost session on /pair?copy= shows sign-in with the copy in the way back", async () => {
  vi.mocked(api.getCopy).mockRejectedValue(refuse(401, "signed-out"));
  show("?copy=c1");
  const link = await screen.findByRole("link", { name: "Sign in with Google" });
  expect(link).toHaveAttribute("href", "/auth/login?returnTo=%2Fpair%3Fcopy%3Dc1");
});

test("a lost session while labelling shows sign-in", async () => {
  vi.mocked(api.getCopy).mockResolvedValue({ ...copy, code: null, book, actions: ["label"] } as CopyView);
  vi.mocked(api.labelCopy).mockRejectedValue(refuse(401, "signed-out"));
  show("?copy=c1");
  await screen.findByText("Now scan a blank label.");
  await click("stub label");
  await screen.findByRole("link", { name: "Sign in with Google" });
});

test("the picker is absent with one collection and present with two", async () => {
  show();
  await toConfirm();
  await click("Yes");
  expect(screen.queryByLabelText("Collection")).not.toBeInTheDocument();
});

test("with two collections the picker lists them default first plus New collection, and the pick is sent and remembered", async () => {
  mineIs(two);
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show();
  await toConfirm();
  await click("Yes");
  const select = await screen.findByLabelText("Collection");
  expect(Array.from((select as HTMLSelectElement).options).map((o) => o.text)).toEqual(["Home library", "Garage", "New collection…"]);
  expect(select).toHaveValue("h");
  await userEvent.selectOptions(select, "g");
  await click("stub label");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledWith({ code: "t7k2q9xzmb", isbn: "9780000000002", collectionId: "g" }));
  expect(localStorage.getItem("nll.pair-collection.1")).toBe("g");
});

test("the stored pick is preselected", async () => {
  localStorage.setItem("nll.pair-collection.1", "g");
  mineIs(two);
  show();
  await toConfirm();
  await click("Yes");
  expect(await screen.findByLabelText("Collection")).toHaveValue("g");
  expect(screen.queryByText(/The collection you used last is gone/)).not.toBeInTheDocument();
});

test("a stored pick not in the list falls back to the default with a notice", async () => {
  localStorage.setItem("nll.pair-collection.1", "deleted");
  mineIs(two);
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show();
  await toConfirm();
  await click("Yes");
  expect(await screen.findByLabelText("Collection")).toHaveValue("h");
  expect(para("The collection you used last is gone, so this goes in Home library.")).toBeInTheDocument();
  await click("stub label");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledWith(expect.objectContaining({ collectionId: "h" })));
});

test("another member's stored pick is never read", async () => {
  localStorage.setItem("nll.pair-collection.2", "g");
  mineIs(two);
  show();
  await toConfirm();
  await click("Yes");
  expect(await screen.findByLabelText("Collection")).toHaveValue("h");
  expect(screen.queryByText(/The collection you used last is gone/)).not.toBeInTheDocument();
});

test("New collection… creates and selects", async () => {
  mineIs(two);
  vi.mocked(api.createCollection).mockResolvedValue(col("n", "Cabin"));
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show();
  await toConfirm();
  await click("Yes");
  await userEvent.selectOptions(await screen.findByLabelText("Collection"), "new");
  await userEvent.type(screen.getByLabelText("Name"), "Cabin");
  await click("Create");
  await waitFor(() => expect(api.createCollection).toHaveBeenCalledWith("Cabin"));
  await waitFor(() => expect(screen.getByLabelText("Collection")).toHaveValue("n"));
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  await click("stub label");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledWith(expect.objectContaining({ collectionId: "n" })));
});

test("a refused new collection name is shown and nothing is saved", async () => {
  mineIs(two);
  vi.mocked(api.createCollection).mockRejectedValue(refuse(409, "name-taken"));
  show();
  await toConfirm();
  await click("Yes");
  await userEvent.selectOptions(await screen.findByLabelText("Collection"), "new");
  await userEvent.type(screen.getByLabelText("Name"), "Garage");
  await click("Create");
  await screen.findByText("You already have a collection called that.");
  expect(api.addCopy).not.toHaveBeenCalled();
});

test("a save refused not-found refreshes the choices and asks again, keeping the label and book", async () => {
  mineIs(two);
  vi.mocked(api.addCopy).mockRejectedValueOnce(refuse(404, "not-found")).mockResolvedValue(copy);
  show();
  await toConfirm();
  await click("Yes");
  await userEvent.selectOptions(await screen.findByLabelText("Collection"), "g");
  mineIs([col("h", "Home library", true), col("k", "Kitchen")]);
  await click("stub label");
  await screen.findByText("That collection was just deleted. Pick another.");
  const select = await screen.findByLabelText("Collection");
  expect(Array.from((select as HTMLSelectElement).options).map((o) => o.text)).toEqual(["Home library", "Kitchen", "New collection…"]);
  expect(select).toHaveValue("h");
  await click("stub other label");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledTimes(2));
  expect(api.addCopy).toHaveBeenLastCalledWith({ code: "mmmmmmmmmm", isbn: "9780000000002", collectionId: "h" });
});

test("localStorage that throws still lets a book be saved", async () => {
  mineIs(two);
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  const boom = () => { throw new Error("denied"); };
  vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
  show();
  await toConfirm();
  await click("Yes");
  await screen.findByLabelText("Collection");
  await click("stub label");
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/b/t7k2q9xzmb"));
  expect(api.addCopy).toHaveBeenCalledWith({ code: "t7k2q9xzmb", isbn: "9780000000002", collectionId: "h" });
});

test("a lost session while the collections load shows sign-in", async () => {
  vi.mocked(api.myCollections).mockRejectedValue(refuse(401, "signed-out"));
  show("?label=T7K2Q9XZMB");
  await screen.findByRole("link", { name: "Sign in with Google" });
});

test("with two collections a code in the address still asks which collection", async () => {
  mineIs(two);
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show("?label=T7K2Q9XZMB");
  await toConfirm();
  await click("Yes");
  expect(await screen.findByLabelText("Collection")).toBeInTheDocument();
  expect(api.addCopy).not.toHaveBeenCalled();
  await click("Use this label");
  await waitFor(() => expect(api.addCopy).toHaveBeenCalledWith({ code: "t7k2q9xzmb", isbn: "9780000000002", collectionId: "h" }));
});
