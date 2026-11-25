import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BookInfo, CopyView } from "../../shared/types";
import * as api from "../api";
import { Pair } from "./Pair";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, lookupBook: vi.fn(), addCopy: vi.fn() };
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

beforeEach(() => {
  vi.resetAllMocks();
  mockOnMount = null;
  vi.stubGlobal("location", { ...window.location, assign, search: "" });
});
afterEach(() => vi.unstubAllGlobals());

const show = (search = "", member: typeof me | null = me) => {
  vi.stubGlobal("location", { ...window.location, assign, search });
  return render(<Pair member={member} returnTo={`/pair${search}`} />);
};
const click = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));
const wantOf = () => screen.getByTestId("scanner").dataset.want;
const refuse = (status: number, rejected: api.ApiError["rejected"]) => new api.ApiError(status, rejected);

async function toConfirm() {
  vi.mocked(api.lookupBook).mockResolvedValue({ book, suggestion: null });
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
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null, suggestion: null });
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
  vi.mocked(api.lookupBook).mockResolvedValue({ book, suggestion: null });
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
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null, suggestion: null });
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
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null, suggestion: null });
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
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null, suggestion: null });
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
  let answer: (v: { book: BookInfo | null; suggestion: null }) => void = () => {};
  vi.mocked(api.lookupBook).mockReturnValue(new Promise((r) => (answer = r)));
  show();
  await click("stub isbn");
  await screen.findByText("Looking that up…");
  await click("Start over");
  answer({ book, suggestion: null });
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

const SUGGESTION = { title: "Guessed Title", authors: ["G. Author", "Second"], link: "https://books.google.com/books/about/x.html?id=abc" };

async function missWithSuggestion() {
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null, suggestion: SUGGESTION });
  vi.mocked(api.addCopy).mockResolvedValue(copy);
  show(LINKED);
  await click("stub isbn");
  await screen.findByText("We couldn't find that book.");
  await click("Type the title");
}

test("a suggestion pre-fills the typing form and credits Google Books with a link", async () => {
  await missWithSuggestion();
  expect(screen.getByLabelText("Title")).toHaveValue("Guessed Title");
  expect(screen.getByLabelText("Author")).toHaveValue("G. Author");
  const link = screen.getByRole("link", { name: /Google Books/ });
  expect(link).toHaveAttribute("href", SUGGESTION.link);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
  expect(link.getAttribute("rel")).toContain("noreferrer");
});

test("saving a suggestion sends the title and first author", async () => {
  await missWithSuggestion();
  await click("Continue");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(saved()).toStrictEqual([{ code: "t7k2q9xzmb", title: "Guessed Title", authors: ["G. Author"] }]);
});

test("an edited suggestion is sent as edited", async () => {
  await missWithSuggestion();
  await userEvent.clear(screen.getByLabelText("Title"));
  await userEvent.type(screen.getByLabelText("Title"), "My Title");
  await click("Continue");
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(saved()).toStrictEqual([{ code: "t7k2q9xzmb", title: "My Title", authors: ["G. Author"] }]);
});

test("with no suggestion the form is empty and has no Google link", async () => {
  vi.mocked(api.lookupBook).mockResolvedValue({ book: null, suggestion: null });
  show();
  await click("stub isbn");
  await click("Type the title");
  expect(screen.getByLabelText("Title")).toHaveValue("");
  expect(screen.queryByRole("link", { name: /Google Books/ })).toBeNull();
});

describe("Google text never outlives its suggestion", () => {
  const missWith = (s: typeof SUGGESTION | null) => vi.mocked(api.lookupBook).mockResolvedValueOnce({ book: null, suggestion: s });

  test("Scan again, then No barcode? Type it in, is empty with no Google line", async () => {
    missWith(SUGGESTION);
    show();
    await click("stub isbn");
    await screen.findByText("We couldn't find that book.");
    await click("Scan again");
    await click("No barcode? Type it in");
    expect(screen.queryByRole("link", { name: /Google Books/ })).toBeNull();
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Author")).toHaveValue("");
  });

  test("a later miss without a suggestion opens an empty form", async () => {
    missWith(SUGGESTION);
    missWith(null);
    show();
    await click("stub isbn");
    await screen.findByText("We couldn't find that book.");
    await click("Scan again");
    await click("stub isbn");
    await screen.findByText("We couldn't find that book.");
    await click("Type the title");
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.queryByRole("link", { name: /Google Books/ })).toBeNull();
  });

  test("a later failed lookup opens an empty form", async () => {
    missWith(SUGGESTION);
    vi.mocked(api.lookupBook).mockRejectedValueOnce(refuse(503, null));
    show();
    await click("stub isbn");
    await screen.findByText("We couldn't find that book.");
    await click("Scan again");
    await click("stub isbn");
    await screen.findByText("We couldn't find that book.");
    await click("Type the title");
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  test("with the camera unavailable after a suggested miss, the form is empty", async () => {
    missWith(SUGGESTION);
    show();
    await click("stub isbn");
    await screen.findByText("We couldn't find that book.");
    await click("Scan again");
    await click("stub no-camera");
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.queryByRole("link", { name: /Google Books/ })).toBeNull();
  });

  test("Start over clears it", async () => {
    missWith(SUGGESTION);
    show();
    await click("stub isbn");
    await screen.findByText("We couldn't find that book.");
    await click("Type the title");
    await click("Start over");
    await click("No barcode? Type it in");
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.queryByRole("link", { name: /Google Books/ })).toBeNull();
  });
});
