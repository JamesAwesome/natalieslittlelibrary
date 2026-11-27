import type { CollectionSummary, ShelfItem } from "../../shared/types";
import { ApiError, getShelf } from "../api";

/**
 * Reads every collection's shelf and merges the items, in collection order. A 404 (deleted between the two
 * reads) is skipped, a 401 is rethrown so the screen goes to sign-in, and anything else counts toward `failed`
 * so the wall can show what did load. Only when every read failed is it an error.
 */
export async function loadShelves(collections: CollectionSummary[]): Promise<{ items: ShelfItem[]; failed: number }> {
  let failed = 0;
  const shelves = await Promise.all(
    collections.map(async (c) => {
      try {
        return (await getShelf(c.id)).items;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) throw e;
        if (!(e instanceof ApiError && e.status === 404)) failed++;
        return [];
      }
    }),
  );
  if (collections.length > 0 && failed === collections.length) throw new Error("all failed");
  return { items: shelves.flat(), failed };
}
