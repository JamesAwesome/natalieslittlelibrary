import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import { Labels } from "./Labels";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, mintLabels: vi.fn() };
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

test("Print calls window.print", async () => {
  show();
  await make();
  await waitFor(() => expect(screen.getByRole("button", { name: "Print" })).toBeEnabled());
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
