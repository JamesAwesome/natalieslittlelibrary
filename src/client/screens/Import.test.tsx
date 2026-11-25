import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CollectionSummary } from "../../shared/types";
import * as api from "../api";
import { DATE_READ, FIXTURE, RATING, REVIEW_SENTINEL } from "../storygraph/fixture";
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
async function choose(user: ReturnType<typeof setupUser>, text = FIXTURE) {
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
  expect(screen.getByText(/0 were already in your collection/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Home library/ })).toHaveAttribute("href", "/collections/k1");
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

test("neither the file nor its rows are written to storage", async () => {
  collections([home]);
  vi.mocked(api.importRows).mockResolvedValue(ok(6));
  const set = vi.spyOn(Storage.prototype, "setItem");
  const user = setupUser();
  show();
  await choose(user);
  await user.click(await screen.findByRole("button", { name: "Import" }));
  await waitFor(() => expect(screen.getByText(/^Added 6\./)).toBeInTheDocument());
  expect(set).not.toHaveBeenCalled();
});

test("a session already lost shows sign-in", () => {
  render(<Import member={null} returnTo="/import" />);
  expect(screen.getByRole("link", { name: "Sign in with Google" })).toBeInTheDocument();
});
