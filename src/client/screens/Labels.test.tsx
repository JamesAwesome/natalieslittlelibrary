import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import { Labels } from "./Labels";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, mintLabels: vi.fn(), listSheets: vi.fn(), sheetLabels: vi.fn() };
});

const me = { id: "1", name: "Natalie", email: "n@example.com", pictureUrl: null, isAdmin: true };
let serial = 0;
const fakeMint = async (count: number) => ({
  labels: Array.from({ length: count }, () => {
    const code = `c${String(++serial).padStart(9, "0")}`;
    return { code, url: `https://lib.test/b/${code}` };
  }),
});
const print = vi.fn();
// This runtime's own localStorage is absent or unusable, so each test gets a plain in-memory one.
const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
};

beforeEach(() => {
  serial = 0;
  vi.resetAllMocks();
  vi.mocked(api.mintLabels).mockImplementation(fakeMint);
  vi.mocked(api.listSheets).mockResolvedValue({ sheets: [] });
  vi.stubGlobal("print", print);
  vi.stubGlobal("localStorage", memory());
});
afterEach(() => vi.unstubAllGlobals());

const show = () => render(<Labels member={me} returnTo="/labels" />);
const picker = () => screen.getByLabelText("Label sheet") as HTMLSelectElement;
const make = () => userEvent.click(screen.getByRole("button", { name: "Make labels" }));
const codes = () => [...document.querySelectorAll<HTMLElement>(".sheet-label[data-code]")].map((e) => e.dataset.code);

test("signed out shows only the sign-in link back to /labels", () => {
  render(<Labels member={null} returnTo="/labels" />);
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Flabels");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("the default sheet is preselected and the instructions are shown", () => {
  show();
  expect(picker().value).toBe("avery-94103");
  expect(within(picker()).getByRole("option", { name: "Avery 94103 · 1 × 1 in square · 48 per sheet" })).toBeInTheDocument();
  expect(within(picker()).getByRole("option", { name: "Custom sheet" })).toBeInTheDocument();
  expect(screen.getByText('Print from a computer, at 100%, not "fit to page", on Letter paper.')).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
});

test("making labels says they exist and shows them", async () => {
  show();
  await make();
  expect(await screen.findByText("These labels now exist. If you don't print them, they simply go unused.")).toBeInTheDocument();
  expect(codes()).toHaveLength(48);
  expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
});

test("two sheets of the default mint 48 twice, one request per sheet", async () => {
  show();
  await userEvent.selectOptions(screen.getByLabelText("How many sheets?"), "2");
  await make();
  await waitFor(() => expect(codes()).toHaveLength(96));
  expect(api.mintLabels).toHaveBeenCalledTimes(2);
  expect(api.mintLabels).toHaveBeenNthCalledWith(1, 48);
  expect(api.mintLabels).toHaveBeenNthCalledWith(2, 48);
  expect(new Set(codes()).size).toBe(96);
  expect(document.querySelectorAll(".sheet-page")).toHaveLength(2);
});

test("changing the sheet afterwards mints nothing and re-lays-out the same codes", async () => {
  show();
  await make();
  await waitFor(() => expect(codes()).toHaveLength(48));
  const before = codes();
  await userEvent.selectOptions(picker(), "avery-22806");
  expect(api.mintLabels).toHaveBeenCalledTimes(1);
  expect(codes()).toEqual(before);
  expect(document.querySelectorAll(".sheet-page")).toHaveLength(4); // 48 labels, 12 to a sheet
});

test("a double press mints once", async () => {
  let release!: () => void;
  vi.mocked(api.mintLabels).mockImplementation(async (n) => {
    await new Promise<void>((r) => (release = r));
    return fakeMint(n);
  });
  show();
  const button = screen.getByRole("button", { name: "Make labels" });
  fireEvent.click(button);
  fireEvent.click(button);
  release();
  await waitFor(() => expect(codes()).toHaveLength(48));
  expect(api.mintLabels).toHaveBeenCalledTimes(1);
});

test("two clicks inside one act mint once (the guard is the ref, not the disabled button)", async () => {
  show();
  const button = screen.getByRole("button", { name: "Make labels" });
  await act(async () => {
    button.click();
    button.click();
  });
  await waitFor(() => expect(codes()).toHaveLength(48));
  expect(api.mintLabels).toHaveBeenCalledTimes(1);
});

test("a failure after some sheets keeps and shows them, says how many, and Try again mints only the rest", async () => {
  vi.mocked(api.mintLabels)
    .mockImplementationOnce(fakeMint)
    .mockRejectedValueOnce(new api.ApiError(500, null));
  show();
  await userEvent.selectOptions(screen.getByLabelText("How many sheets?"), "3");
  await make();
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't make labels. Try again.");
  expect(codes()).toHaveLength(48);
  expect(screen.getByText("These labels now exist. If you don't print them, they simply go unused.")).toBeInTheDocument();
  expect(screen.getByText("1 of 3 sheets was made.")).toBeInTheDocument();
  const first = codes();
  await make();
  await waitFor(() => expect(codes()).toHaveLength(144));
  expect(api.mintLabels).toHaveBeenCalledTimes(4); // 1 made, 1 failed, 2 more
  expect(codes().slice(0, 48)).toEqual(first);
  expect(new Set(codes()).size).toBe(144);
  expect(screen.queryByText(/sheets? was made|sheets were made/)).not.toBeInTheDocument();
});

test("changing how many sheets after a partial failure starts afresh", async () => {
  vi.mocked(api.mintLabels).mockImplementationOnce(fakeMint).mockRejectedValueOnce(new api.ApiError(500, null));
  show();
  await userEvent.selectOptions(screen.getByLabelText("How many sheets?"), "3");
  await make();
  await screen.findByRole("alert");
  await userEvent.selectOptions(screen.getByLabelText("How many sheets?"), "2");
  await make();
  await waitFor(() => expect(codes()).toHaveLength(96));
});

test("Print is disabled while the layout has problems", async () => {
  show();
  await make();
  await waitFor(() => expect(screen.getByRole("button", { name: "Print" })).toBeEnabled());
  await userEvent.selectOptions(picker(), "custom");
  fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
});

test("a saved custom value that is not a number loads safely and is refused with a reason", () => {
  localStorage.setItem("labels.settings", JSON.stringify({ sheetId: "custom", custom: { columns: "abc", labelW: "1e999", rows: 5, shape: "oval" } }));
  show();
  expect(picker().value).toBe("custom");
  expect(screen.getByRole("button", { name: "Make labels" })).toBeDisabled();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

test("Print calls window.print", async () => {
  show();
  await make();
  await waitFor(() => expect(screen.getByRole("button", { name: "Print" })).toBeEnabled());
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1)); // Make labels already printed once
  print.mockClear();
  await userEvent.click(screen.getByRole("button", { name: "Print" }));
  expect(print).toHaveBeenCalledTimes(1);
});

test("the alignment test prints outlines and no codes, then puts the sheets back", async () => {
  show();
  await make();
  await waitFor(() => expect(codes()).toHaveLength(48));
  let during: { outlines: number; svgs: number; coded: number; align: boolean } | null = null;
  print.mockImplementation(() => {
    during = {
      outlines: document.querySelectorAll(".sheet-label").length,
      svgs: document.querySelectorAll("svg").length,
      coded: document.querySelectorAll(".sheet-label[data-code]").length,
      align: document.querySelector(".sheets--align") !== null,
    };
  });
  await userEvent.click(screen.getByRole("button", { name: "Print an alignment test" }));
  expect(during).toEqual({ outlines: 48, svgs: 0, coded: 0, align: true });
  expect(codes()).toHaveLength(48);
  expect(api.mintLabels).toHaveBeenCalledTimes(1);
});

test("an invalid custom sheet disables Make labels and says why", async () => {
  show();
  await userEvent.selectOptions(picker(), "custom");
  expect(screen.getByRole("button", { name: "Make labels" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: "Make labels" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Print an alignment test" })).toBeDisabled();
  expect(screen.getByText("There must be at least one column and one row of labels.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Label width"), { target: { value: "0.5" } });
  fireEvent.change(screen.getByLabelText("Label height"), { target: { value: "0.5" } });
  expect(screen.getByText("Labels this small can't carry a code that scans reliably.")).toBeInTheDocument();
  expect(api.mintLabels).not.toHaveBeenCalled();
});

test("a valid custom sheet mints its own count", async () => {
  show();
  await userEvent.selectOptions(picker(), "custom");
  fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Rows"), { target: { value: "3" } });
  await make();
  await waitFor(() => expect(codes()).toHaveLength(6));
  expect(api.mintLabels).toHaveBeenCalledWith(6);
});

test("a failed mint says so and can be tried again", async () => {
  vi.mocked(api.mintLabels).mockRejectedValueOnce(new api.ApiError(500, null));
  show();
  await make();
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't make labels. Try again.");
  expect(codes()).toHaveLength(0);
  await make();
  await waitFor(() => expect(codes()).toHaveLength(48));
  expect(screen.queryByText("Couldn't make labels. Try again.")).not.toBeInTheDocument();
});

test("a lost session shows the sign-in link", async () => {
  vi.mocked(api.mintLabels).mockRejectedValue(new api.ApiError(401, null));
  show();
  await make();
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/auth/login?returnTo=%2Flabels");
});

test("the chosen sheet and nudge survive a remount", async () => {
  const first = show();
  await userEvent.selectOptions(picker(), "avery-6450");
  await userEvent.selectOptions(screen.getByLabelText("Nudge right/left"), "1.5");
  await userEvent.selectOptions(screen.getByLabelText("Nudge down/up"), "-2");
  first.unmount();
  show();
  expect(picker().value).toBe("avery-6450");
  expect((screen.getByLabelText("Nudge right/left") as HTMLSelectElement).value).toBe("1.5");
  expect((screen.getByLabelText("Nudge down/up") as HTMLSelectElement).value).toBe("-2");
});

test("the nudge reaches the labels", async () => {
  show();
  await userEvent.selectOptions(screen.getByLabelText("Nudge right/left"), "5");
  await make();
  await waitFor(() => expect(codes()).toHaveLength(48));
  const first = document.querySelector<HTMLElement>(".sheet-label")!;
  expect(Number.parseFloat(first.style.left)).toBeCloseTo(0.625 + 5 / 25.4, 3);
});

test("the page still works when localStorage throws", async () => {
  const boom = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom, clear: boom });
  show();
  expect(picker().value).toBe("avery-94103");
  await userEvent.selectOptions(picker(), "avery-22807");
  await make();
  await waitFor(() => expect(codes()).toHaveLength(12));
});

test("bad saved values fall back to the defaults", () => {
  localStorage.setItem("labels.settings", JSON.stringify({ sheetId: "nope", nudge: { xMm: 99, yMm: "x" } }));
  show();
  expect(picker().value).toBe("avery-94103");
  expect((screen.getByLabelText("Nudge right/left") as HTMLSelectElement).value).toBe("0");
});

const dayOf = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const T2 = Date.UTC(2026, 10, 20, 12);
const T1 = Date.UTC(2026, 10, 10, 12);
const twoSheets = {
  sheets: [
    { id: "s2", at: T2, total: 48, blank: 40, mine: 8 },
    { id: "s1", at: T1, total: 12, blank: 12, mine: 0 },
  ],
};
const stored = [
  { code: "r000000001", url: "https://lib.test/b/r000000001" },
  { code: "r000000002", url: "https://lib.test/b/r000000002" },
];
const rows = async () => (await screen.findAllByRole("listitem")).map((li) => li.textContent);

test("Make labels opens the print dialog once, after the labels are on the page", async () => {
  const seen: number[] = [];
  print.mockImplementation(() => void seen.push(codes().length));
  show();
  await make();
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  expect(seen).toEqual([48]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a run of two sheets prints once, after both", async () => {
  const seen: number[] = [];
  print.mockImplementation(() => void seen.push(codes().length));
  show();
  await userEvent.selectOptions(screen.getByLabelText("How many sheets?"), "2");
  await make();
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  expect(seen).toEqual([96]);
  expect(codes()).toHaveLength(96);
});

test("a run that fails part way does not print; Try again prints once it completes", async () => {
  vi.mocked(api.mintLabels).mockImplementationOnce(fakeMint).mockRejectedValueOnce(new api.ApiError(500, null));
  show();
  await userEvent.selectOptions(screen.getByLabelText("How many sheets?"), "2");
  await make();
  await screen.findByRole("alert");
  expect(print).not.toHaveBeenCalled();
  await make();
  await waitFor(() => expect(codes()).toHaveLength(96));
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
});

test("previous sheets are listed newest first with their counts", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  show();
  expect(await screen.findByRole("heading", { name: "Previous sheets" })).toBeInTheDocument();
  expect(await rows()).toEqual([
    expect.stringContaining(`${dayOf(T2)} · 48 labels, 40 blank, 8 on your books`),
    expect.stringContaining(`${dayOf(T1)} · 12 labels, 12 blank, 0 on your books`),
  ]);
});

test("Print again prints that sheet's blank labels and makes none", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  vi.mocked(api.sheetLabels).mockResolvedValue({ labels: stored });
  const seen: (string | undefined)[][] = [];
  print.mockImplementation(() => void seen.push(codes()));
  show();
  const [first] = await screen.findAllByRole("button", { name: "Print again" });
  await userEvent.click(first!);
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  expect(api.sheetLabels).toHaveBeenCalledWith("s2", false);
  expect(seen).toEqual([["r000000001", "r000000002"]]);
  expect(codes()).toEqual(["r000000001", "r000000002"]);
  expect(api.mintLabels).not.toHaveBeenCalled();
  expect(screen.queryByText(/These labels now exist/)).not.toBeInTheDocument();
});

test("the checkbox asks for the labels already on my books", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  vi.mocked(api.sheetLabels).mockResolvedValue({ labels: stored });
  show();
  await userEvent.click(await screen.findByLabelText("Also print labels already on my books"));
  await userEvent.click((await screen.findAllByRole("button", { name: "Print again" }))[0]!);
  await waitFor(() => expect(api.sheetLabels).toHaveBeenCalledWith("s2", true));
});

test("a sheet with nothing to print says so and does not print", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  vi.mocked(api.sheetLabels).mockResolvedValue({ labels: [] });
  show();
  await userEvent.click((await screen.findAllByRole("button", { name: "Print again" }))[0]!);
  expect(await screen.findByText("Every label on that sheet is already on a book.")).toBeInTheDocument();
  expect(print).not.toHaveBeenCalled();
});

const HINT = "Tick 'Also print labels already on my books' to print those.";

test("an empty reprint of a sheet with labels on books hints at the checkbox, only while it is unticked", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  vi.mocked(api.sheetLabels).mockResolvedValue({ labels: [] });
  show();
  const again = await screen.findAllByRole("button", { name: "Print again" });
  await userEvent.click(again[1]!); // the older sheet has none on books
  expect(await screen.findByText("Every label on that sheet is already on a book.")).toBeInTheDocument();
  expect(screen.queryByText(HINT)).toBeNull();
  await userEvent.click(again[0]!);
  expect(await screen.findByText(HINT)).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Also print labels already on my books"));
  expect(screen.queryByText(HINT)).toBeNull();
});

test("Print again after a failed partial run, then Make labels, starts a fresh run", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  vi.mocked(api.sheetLabels).mockResolvedValue({ labels: stored });
  vi.mocked(api.mintLabels).mockImplementationOnce(fakeMint).mockRejectedValueOnce(new api.ApiError(500, null));
  show();
  await userEvent.selectOptions(screen.getByLabelText("How many sheets?"), "2");
  await make();
  await screen.findByText("1 of 2 sheets was made.");
  await userEvent.click((await screen.findAllByRole("button", { name: "Print again" }))[0]!);
  await waitFor(() => expect(codes()).toEqual(["r000000001", "r000000002"]));
  expect(screen.queryByText("1 of 2 sheets was made.")).not.toBeInTheDocument();
  await make();
  await waitFor(() => expect(codes()).toHaveLength(96));
  expect(api.mintLabels).toHaveBeenCalledTimes(4); // 1 made, 1 failed, 2 fresh
  expect(api.mintLabels).toHaveBeenNthCalledWith(3, 48);
  expect(api.mintLabels).toHaveBeenNthCalledWith(4, 48);
  expect(codes()).not.toContain("r000000001");
  expect(screen.getByText(/These labels now exist/)).toBeInTheDocument();
});

test("making labels refreshes the list of previous sheets", async () => {
  show();
  await waitFor(() => expect(api.listSheets).toHaveBeenCalledTimes(1));
  await make();
  await waitFor(() => expect(api.listSheets).toHaveBeenCalledTimes(2));
});

test("a list that fails to load says so and the page still makes labels", async () => {
  vi.mocked(api.listSheets).mockRejectedValue(new api.ApiError(500, null));
  show();
  expect(await screen.findByText("Couldn't load your previous sheets.")).toBeInTheDocument();
  await make();
  await waitFor(() => expect(codes()).toHaveLength(48));
});

test("a lost session while loading the list shows the sign-in link", async () => {
  vi.mocked(api.listSheets).mockRejectedValue(new api.ApiError(401, null));
  show();
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("a reprint is laid out on the chosen sheet type and paginates", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  const many = Array.from({ length: 30 }, (_, i) => ({ code: `r${String(i).padStart(9, "0")}`, url: `https://lib.test/b/${i}` }));
  vi.mocked(api.sheetLabels).mockResolvedValue({ labels: many });
  show();
  await userEvent.selectOptions(picker(), "avery-22806"); // 12 to a sheet
  await userEvent.click((await screen.findAllByRole("button", { name: "Print again" }))[0]!);
  await waitFor(() => expect(codes()).toHaveLength(30));
  expect(document.querySelectorAll(".sheet-page")).toHaveLength(3);
});

test("a sheet that fails to load says so and does not print", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  vi.mocked(api.sheetLabels).mockRejectedValue(new api.ApiError(500, null));
  show();
  await userEvent.click((await screen.findAllByRole("button", { name: "Print again" }))[0]!);
  expect(await screen.findByText("Couldn't load that sheet. Try again.")).toBeInTheDocument();
  expect(print).not.toHaveBeenCalled();
});

test("a lost session while printing again shows the sign-in link", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  vi.mocked(api.sheetLabels).mockRejectedValue(new api.ApiError(401, null));
  show();
  await userEvent.click((await screen.findAllByRole("button", { name: "Print again" }))[0]!);
  expect(await screen.findByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("after Print again, a Make labels that fails at once keeps the reprinted codes without the 'now exist' line", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  vi.mocked(api.sheetLabels).mockResolvedValue({ labels: stored });
  vi.mocked(api.mintLabels).mockRejectedValue(new api.ApiError(500, null));
  show();
  await userEvent.click((await screen.findAllByRole("button", { name: "Print again" }))[0]!);
  await waitFor(() => expect(codes()).toEqual(["r000000001", "r000000002"]));
  await make();
  await screen.findByText("Couldn't make labels. Try again.");
  expect(codes()).toEqual(["r000000001", "r000000002"]);
  expect(screen.queryByText(/These labels now exist/)).not.toBeInTheDocument();
});

test("each run prints exactly once, with all of that run's codes on the page", async () => {
  const slow = (n: number) => new Promise<Awaited<ReturnType<typeof fakeMint>>>((r) => setTimeout(() => r(fakeMint(n)), 20));
  vi.mocked(api.mintLabels).mockImplementation(slow);
  const seen: number[] = [];
  print.mockImplementation(() => void seen.push(codes().length));
  show();
  await userEvent.selectOptions(screen.getByLabelText("How many sheets?"), "2");
  await make();
  await waitFor(() => expect(codes()).toHaveLength(96));
  await new Promise((r) => setTimeout(r, 60));
  expect(seen).toEqual([96]);
  await make();
  await waitFor(() => expect(seen).toHaveLength(2));
  await new Promise((r) => setTimeout(r, 60));
  expect(seen).toEqual([96, 96]);
});

test("a layout that goes invalid while a reprint is loading drops the print, and it never fires later", async () => {
  vi.mocked(api.listSheets).mockResolvedValue(twoSheets);
  let release!: () => void;
  vi.mocked(api.sheetLabels).mockImplementation(async () => {
    await new Promise<void>((r) => (release = r));
    return { labels: stored };
  });
  show();
  await userEvent.click((await screen.findAllByRole("button", { name: "Print again" }))[0]!);
  await userEvent.selectOptions(picker(), "custom");
  fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "0" } });
  await act(async () => release());
  await new Promise((r) => setTimeout(r, 30));
  expect(print).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "2" } });
  await new Promise((r) => setTimeout(r, 30));
  expect(print).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Print" }));
  expect(print).toHaveBeenCalledTimes(1);
});

test("the h1 is Print labels, or the app name when signed out", () => {
  const { unmount } = show();
  expect(screen.getByRole("heading", { level: 1, name: "Print labels" })).toBeInTheDocument();
  unmount();
  render(<Labels member={null} returnTo="/labels" />);
  expect(screen.getByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
});
