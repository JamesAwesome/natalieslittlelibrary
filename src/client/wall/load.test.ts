import { beforeEach, expect, test, vi } from "vitest";
import * as api from "../api";
import { item, shelfOf, summary } from "../screens/shelfFixtures";
import { loadShelves } from "./load";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, getShelf: vi.fn() };
});
beforeEach(() => vi.resetAllMocks());

const k1 = summary({ id: "k1", name: "Home library" });
const k2 = summary({ id: "k2", name: "Beach house" });
const a = item({ copyId: "a" });
const b = item({ copyId: "b", collection: { id: "k2", name: "Beach house" } });

function shelves(answers: Record<string, () => Promise<ReturnType<typeof shelfOf>>>) {
  vi.mocked(api.getShelf).mockImplementation((id) => answers[id]());
}

test("all succeed: every collection's items, merged in collection order", async () => {
  shelves({ k1: async () => shelfOf(k1, [a]), k2: async () => shelfOf(k2, [b]) });
  expect(await loadShelves([k1, k2])).toEqual({ items: [a, b], failed: 0 });
  expect(api.getShelf).toHaveBeenCalledTimes(2);
});

test("a 404 (deleted between the reads) is skipped, not a failure", async () => {
  shelves({ k1: async () => shelfOf(k1, [a]), k2: async () => { throw new api.ApiError(404, null); } });
  expect(await loadShelves([k1, k2])).toEqual({ items: [a], failed: 0 });
});

test("a 500 on one shelf counts as one failed and keeps the rest", async () => {
  shelves({ k1: async () => shelfOf(k1, [a]), k2: async () => { throw new api.ApiError(500, null); } });
  expect(await loadShelves([k1, k2])).toEqual({ items: [a], failed: 1 });
});

test("a non-API error counts as failed too", async () => {
  shelves({ k1: async () => shelfOf(k1, [a]), k2: async () => { throw new TypeError("network"); } });
  expect(await loadShelves([k1, k2])).toEqual({ items: [a], failed: 1 });
});

test("every read failing rejects with a plain error", async () => {
  shelves({ k1: async () => { throw new api.ApiError(500, null); }, k2: async () => { throw new api.ApiError(502, null); } });
  const e = await loadShelves([k1, k2]).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(Error);
  expect(e).not.toBeInstanceOf(api.ApiError);
  expect((e as Error).message).toBe("all failed");
});

test("a 401 on any shelf rejects with that ApiError, even beside a success", async () => {
  const lost = new api.ApiError(401, null);
  shelves({ k1: async () => shelfOf(k1, [a]), k2: async () => { throw lost; } });
  await expect(loadShelves([k1, k2])).rejects.toBe(lost);
});

test("no collections is an empty wall, not a failure", async () => {
  expect(await loadShelves([])).toEqual({ items: [], failed: 0 });
  expect(api.getShelf).not.toHaveBeenCalled();
});

test("every shelf gone (all 404) is an empty wall, not a failure", async () => {
  shelves({ k1: async () => { throw new api.ApiError(404, null); } });
  expect(await loadShelves([k1])).toEqual({ items: [], failed: 0 });
});
