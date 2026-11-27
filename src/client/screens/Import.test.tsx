import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CollectionSummary } from "../../shared/types";
import * as api from "../api";
import { DATE_READ, FIXTURE, FIXTURE_LINES, RATING, REVIEW_SENTINEL } from "../storygraph/fixture";
import { Import } from "./Import";
import { me, summary } from "./shelfFixtures";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, myCollections: vi.fn(), createCollection: vi.fn(), importRows: vi.fn() };
});

const home = summary({ id: "k1", name: "Home library", isDefault: true });
const beach = summary({ id: "k2", name: "Beach house" });
const owner = { id: "1", name: "Natalie", pictureUrl: null };

function collections(list: CollectionSummary[]) {
  vi.mocked(api.myCollections).mockResolvedValue({ owner, collections: list });
}
// Fixture rows plus `extra` more owned paperbacks, so a run needs several chunks.
const bigExport = (extra: number) =>
  FIXTURE.trimEnd() + "\r\n" + Array.from({ length: extra }, (_, i) => `Extra ${i},Ex Author,,,paperback,read,Yes,${RATING},,${DATE_READ}`).join("\r\n") + "\r\n";

const setupUser = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
async function choose(user: ReturnType<typeof setupUser>, text: BlobPart = FIXTURE) {
  await user.upload(screen.getByLabelText(/StoryGraph export/), new File([text], "export.csv", { type: "text/csv" }));
}
const show = () => render(<Import member={me} returnTo="/import" />);
const ok = (added: number, skipped = 0) => ({ added, skipped });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

test("choosing the fixture shows the count and sends nothing until Import is pressed", async () => {
  collections([home]);
  const user = setupUser();
  show();
  await choose(user);
  expect(await screen.findByText("6 books to import.")).toBeInTheDocument();
  expect(screen.getByText("2 digital or audio skipped.")).toBeInTheDocument();
  expect(api.importRows).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
});

test("Import sends each chunk once, in order, about a second apart, and no request body contains the review sentinel", async () => {
  collections([home]);
  const stamps: number[] = [];
  vi.mocked(api.importRows).mockImplementation(async (_id, rows) => {
    stamps.push(Date.now());
    return ok(rows.length);
  });
  const user = setupUser();
  show();
  await choose(user, bigExport(45));
  expect(await screen.findByText("51 books to import.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Import" }));
  await waitFor(() => expect(screen.getByText(/^Added 51\./)).toBeInTheDocument(), { timeout: 5000 });
  const calls = vi.mocked(api.importRows).mock.calls;
  expect(calls.map((c) => c[1].length)).toEqual([20, 20, 11]);
  expect(calls[0][1][0].title).toBe("Hardcover Book");
  for (let i = 1; i < stamps.length; i++) expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(1000);
  const sent = JSON.stringify(calls);
  for (const s of [REVIEW_SENTINEL, RATING, DATE_READ, "Translator", "hardcover"]) expect(sent).not.toContain(s);
  for (const [, rows] of calls) for (const r of rows) expect(Object.keys(r).sort()).toEqual(["authors", "isbn", "title"]);
  expect(screen.getByText(/0 were already in your books/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Home library/ })).toHaveAttribute("href", "/collections/k1");
});

test("rows listed twice in the file are counted apart from books already held", async () => {
  collections([home]);
  vi.mocked(api.importRows).mockResolvedValue(ok(4, 3)); // 7 rows sent: the fixture already lists one ISBN twice, and the file repeats it again; one more is held
  const user = setupUser();
  show();
  await choose(user, FIXTURE.trimEnd() + "\r\n" + FIXTURE_LINES[1] + "\r\n");
  expect(await screen.findByText("7 books to import.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Import" }));
  expect(await screen.findByText("Added 4. 1 were already in your books. 2 listed twice in the file.")).toBeInTheDocument();
});

test("progress reads Added <a> of <n> while running", async () => {
  collections([home]);
  let release: (v: { added: number; skipped: number }) => void = () => {};
  vi.mocked(api.importRows).mockImplementationOnce(() => new Promise((r) => (release = r)));
  vi.mocked(api.importRows).mockResolvedValue(ok(11));
  const user = setupUser();
  show();
  await choose(user, bigExport(45));
  await user.click(await screen.findByRole("button", { name: "Import" }));
  expect(await screen.findByText("Added 0 of 51…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  await act(async () => release(ok(18, 2)));
  expect(await screen.findByText("Added 18 of 51…")).toBeInTheDocument();
});

test("a double press runs one import", async () => {
  collections([home]);
  vi.mocked(api.importRows).mockImplementation(() => new Promise(() => {}));
  const user = setupUser();
  show();
  await choose(user);
  const button = await screen.findByRole("button", { name: "Import" });
  await user.dblClick(button);
  await act(async () => {});
  expect(api.importRows).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
});

test("a failed chunk stops and says how to carry on", async () => {
  collections([home]);
  vi.mocked(api.importRows).mockResolvedValueOnce(ok(20)).mockRejectedValueOnce(new api.ApiError(500, null));
  const user = setupUser();
  show();
  await choose(user, bigExport(45));
  await user.click(await screen.findByRole("button", { name: "Import" }));
  expect(await screen.findByText(
    "Stopped after 20 of 51. Import the same file again to carry on; books already added are skipped.",
  )).toBeInTheDocument();
  expect(api.importRows).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
});

test("an unavailable chunk is retried after a wait, then carries on", async () => {
  collections([home]);
  vi.mocked(api.importRows)
    .mockRejectedValueOnce(new api.ApiError(503, "unavailable"))
    .mockResolvedValue(ok(6));
  const user = setupUser();
  show();
  await choose(user);
  const t0 = Date.now();
  await user.click(await screen.findByRole("button", { name: "Import" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(await screen.findByText(/^Added 6\./)).toBeInTheDocument();
  expect(api.importRows).toHaveBeenCalledTimes(2);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(2000);
});

test("a chunk that stays unavailable stops the run after a few tries", async () => {
  collections([home]);
  vi.mocked(api.importRows).mockRejectedValue(new api.ApiError(503, "unavailable"));
  const user = setupUser();
  show();
  await choose(user);
  await user.click(await screen.findByRole("button", { name: "Import" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(25000);
  });
  expect(await screen.findByText(/^Stopped after 0 of 6\./)).toBeInTheDocument();
  expect(api.importRows).toHaveBeenCalledTimes(4);
});

test("the import goes into the chosen collection; with none, collectionId is null", async () => {
  collections([home, beach]);
  vi.mocked(api.importRows).mockResolvedValue(ok(6));
  const user = setupUser();
  const first = show();
  await choose(user);
  await user.selectOptions(await screen.findByLabelText("Into"), "k2");
  await user.click(screen.getByRole("button", { name: "Import" }));
  await waitFor(() => expect(screen.getByText(/^Added 6\./)).toBeInTheDocument());
  expect(vi.mocked(api.importRows).mock.calls[0][0]).toBe("k2");
  expect(screen.getByRole("link", { name: /Beach house/ })).toHaveAttribute("href", "/collections/k2");
  first.unmount();

  vi.mocked(api.importRows).mockClear();
  collections([]);
  show();
  await choose(user);
  expect(screen.queryByLabelText("Into")).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Import" }));
  await waitFor(() => expect(api.importRows).toHaveBeenCalled());
  expect(vi.mocked(api.importRows).mock.calls[0][0]).toBeNull();
});

test("a collection deleted since the list was read sends nothing and asks again", async () => {
  collections([home, beach]);
  const user = setupUser();
  show();
  await choose(user);
  await user.selectOptions(await screen.findByLabelText("Into"), "k2");
  collections([home]);
  await user.click(screen.getByRole("button", { name: "Import" }));
  expect(await screen.findByText(/That collection is gone/)).toBeInTheDocument();
  expect(api.importRows).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
});

test("when the collections can't be read there is no Import, only Try again", async () => {
  vi.mocked(api.myCollections).mockRejectedValue(new api.ApiError(500, null));
  const user = setupUser();
  show();
  await choose(user);
  expect(await screen.findByText("We couldn't load your collections.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  collections([home]);
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Import" })).toBeInTheDocument();
});

test("a file that isn't an export names the missing columns and offers no Import", async () => {
  collections([home]);
  const user = setupUser();
  show();
  await choose(user, "Name,Age\r\nx,1\r\n");
  expect(await screen.findByText(
    "This doesn't look like a StoryGraph export. Missing: Title, Authors, ISBN/UID, Format, Owned?.",
  )).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
});

test("a lost session mid-run shows sign-in for /import and no buttons", async () => {
  collections([home]);
  vi.mocked(api.importRows).mockRejectedValue(new api.ApiError(401, "signed-out"));
  const user = setupUser();
  show();
  await choose(user);
  await user.click(await screen.findByRole("button", { name: "Import" }));
  const link = await screen.findByRole("link", { name: "Sign in with Google" });
  expect(link).toHaveAttribute("href", "/auth/login?returnTo=%2Fimport");
  expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
});

test("leaving the page mid-run sends nothing more", async () => {
  collections([home]);
  vi.mocked(api.importRows).mockResolvedValue(ok(20));
  const user = setupUser();
  const view = show();
  await choose(user, bigExport(45));
  await user.click(await screen.findByRole("button", { name: "Import" }));
  await waitFor(() => expect(api.importRows).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(api.importRows).toHaveBeenCalledTimes(1);
});

// Real-like stores: the client test environment has no localStorage of its own, so a spy would watch nothing.
function fakeStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

test("neither the file nor its rows are written to storage or the console", async () => {
  collections([home]);
  vi.mocked(api.importRows).mockResolvedValue(ok(6));
  const local = fakeStore();
  const session = fakeStore();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  // The stubs are reachable the way the app would reach them.
  localStorage.setItem("probe", "1");
  sessionStorage.setItem("probe", "1");
  expect(local.data.get("probe")).toBe("1");
  expect(session.data.get("probe")).toBe("1");
  local.clear();
  session.clear();
  const logs = (["log", "debug", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  const user = setupUser();
  show();
  await choose(user);
  await user.click(await screen.findByRole("button", { name: "Import" }));
  await waitFor(() => expect(screen.getByText(/^Added 6\./)).toBeInTheDocument());
  expect(local.data.size).toBe(0);
  expect(session.data.size).toBe(0);
  const printed = JSON.stringify(logs.flatMap((l) => l.mock.calls));
  for (const s of [REVIEW_SENTINEL, "Hardcover Book", RATING, DATE_READ]) expect(printed).not.toContain(s);
  vi.unstubAllGlobals();
});

test("a member with no collections who re-runs after a stop still sends null, never an empty id", async () => {
  collections([]);
  vi.mocked(api.importRows)
    .mockResolvedValueOnce(ok(20))
    .mockRejectedValueOnce(new api.ApiError(500, null))
    .mockResolvedValue(ok(1));
  const user = setupUser();
  show();
  await choose(user, bigExport(45));
  await user.click(await screen.findByRole("button", { name: "Import" }));
  expect(await screen.findByText(/^Stopped after 20 of 51/)).toBeInTheDocument();
  collections([home]); // the server made the default while chunk 1 ran
  await user.click(screen.getByRole("button", { name: "Import" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  const ids = vi.mocked(api.importRows).mock.calls.map((c) => c[0]);
  expect(ids).not.toContain("");
  expect(ids.slice(2).every((id) => id === "k1")).toBe(true);
});

test("a wrong Owned? value does not read as a bare zero: the skipped counts are shown", async () => {
  collections([home]);
  const user = setupUser();
  show();
  await choose(user);
  expect(await screen.findByText("1 not marked owned.")).toBeInTheDocument();
  expect(screen.getByText("2 digital or audio skipped.")).toBeInTheDocument();
});

test("one book reads in the singular", async () => {
  collections([home]);
  const user = setupUser();
  show();
  await choose(user, FIXTURE.split("\r\n").slice(0, 2).join("\r\n") + "\r\n");
  expect(await screen.findByText("1 book to import.")).toBeInTheDocument();
});

test("a file that isn't UTF-8 says it may be garbled", async () => {
  collections([home]);
  const user = setupUser();
  show();
  const [before, after] = FIXTURE.split("Hardcover Book");
  const enc = new TextEncoder();
  // "Hardcover B\u00E9" in Latin-1: 0xE9 alone is not valid UTF-8.
  const latin1 = new Uint8Array([...enc.encode(before + "Hardcover B"), 0xe9, ...enc.encode("ok" + after)]);
  await choose(user, latin1);
  expect(await screen.findByText("This file doesn't look like UTF-8; some titles may be garbled.")).toBeInTheDocument();
  cleanup();
  show();
  // A replacement character already in a valid UTF-8 export (StoryGraph's own data has them) is not a warning.
  await choose(user, FIXTURE.replace("Hardcover Book", "Hardcover B\uFFFDok"));
  await screen.findByText("6 books to import.");
  expect(screen.queryByText(/UTF-8/)).not.toBeInTheDocument();
  cleanup();
  show();
  await choose(user);
  await screen.findByText("6 books to import.");
  expect(screen.queryByText(/UTF-8/)).not.toBeInTheDocument();
});

test("the waits before asking an unavailable chunk again are 2, 5 and 12 seconds, with a notice while waiting", async () => {
  collections([home]);
  vi.mocked(api.importRows).mockRejectedValue(new api.ApiError(503, "unavailable"));
  const user = setupUser();
  show();
  await choose(user);
  await user.click(await screen.findByRole("button", { name: "Import" }));
  const calls = () => vi.mocked(api.importRows).mock.calls.length;
  expect(calls()).toBe(1);
  expect(await screen.findByText("Waiting to try again…")).toBeInTheDocument();
  const step = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  await step(1800);
  expect(calls()).toBe(1);
  await step(400);
  expect(calls()).toBe(2);
  await step(4600);
  expect(calls()).toBe(2);
  await step(400);
  expect(calls()).toBe(3);
  await step(11600);
  expect(calls()).toBe(3);
  await step(400);
  expect(calls()).toBe(4);
  expect(await screen.findByText(/^Stopped after 0 of 6\./)).toBeInTheDocument();
  expect(screen.queryByText("Waiting to try again…")).not.toBeInTheDocument();
});

test("a 503 that is not 'unavailable' is not retried", async () => {
  collections([home]);
  vi.mocked(api.importRows).mockRejectedValue(new api.ApiError(503, null));
  const user = setupUser();
  show();
  await choose(user);
  await user.click(await screen.findByRole("button", { name: "Import" }));
  expect(await screen.findByText(/^Stopped after 0 of 6\./)).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(api.importRows).toHaveBeenCalledTimes(1);
});

test("a chunk with no answer for 60 seconds is cut off and retried like an unavailable one", async () => {
  collections([home]);
  const signals: AbortSignal[] = [];
  vi.mocked(api.importRows).mockImplementation((_id, _rows, signal) => {
    if (signal) signals.push(signal);
    if (signals.length > 1) return Promise.resolve(ok(6));
    return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  });
  const user = setupUser();
  show();
  await choose(user);
  await user.click(await screen.findByRole("button", { name: "Import" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(59000);
  });
  expect(signals[0].aborted).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(signals[0].aborted).toBe(true);
  expect(await screen.findByText(/^Added 6\./)).toBeInTheDocument();
  expect(api.importRows).toHaveBeenCalledTimes(2);
});

test("a session already lost shows sign-in", () => {
  render(<Import member={null} returnTo="/import" />);
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});

test("signed out, the h1 is the app name, not the import title", () => {
  render(<Import member={null} returnTo="/import" />);
  expect(screen.getByRole("heading", { level: 1, name: "Natalie's Little Library" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Import from StoryGraph" })).not.toBeInTheDocument();
});

test("the new collection name field is invalid only while its error shows, and the slot is always there", async () => {
  collections([home]);
  const user = setupUser();
  show();
  await choose(user);
  await user.selectOptions(await screen.findByLabelText("Into"), "new");
  const name = screen.getByLabelText("Name");
  expect(name).not.toHaveAttribute("aria-invalid");
  expect(document.getElementById(name.getAttribute("aria-describedby") ?? "")).toHaveTextContent("");
  await user.click(screen.getByRole("button", { name: "Create" }));
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription("A collection name is 1 to 60 characters, with no control characters.");
});
