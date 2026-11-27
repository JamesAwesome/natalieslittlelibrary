import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ALL, type WallFilter } from "./model";

export type WallPlace = { filter: WallFilter; scrollY: number };

const STATUSES = ["all", "home", "out", "unlabelled"];

/** What the screens pass as the key: one place per path. */
export const wallKey = (): string => `wall:${location.pathname}`;

function parse(raw: string | null): WallPlace | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { filter, scrollY } = v as { filter?: unknown; scrollY?: unknown };
    if (typeof filter !== "object" || filter === null) return null;
    const { status, collectionId } = filter as { status?: unknown; collectionId?: unknown };
    if (typeof status !== "string" || !STATUSES.includes(status)) return null;
    if (collectionId !== null && typeof collectionId !== "string") return null;
    if (typeof scrollY !== "number" || !Number.isFinite(scrollY) || scrollY < 0) return null;
    return { filter: { status: status as WallFilter["status"], collectionId }, scrollY };
  } catch {
    return null;
  }
}

export function loadPlace(key: string): WallPlace | null {
  try {
    return parse(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

export function savePlace(key: string, place: WallPlace): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(place));
  } catch {
    // Private mode or a full store: the wall just starts at the top next time.
  }
}

export function useWallPlace(
  key: string,
  ready: boolean,
  collectionIds: string[],
): [WallFilter, (f: WallFilter) => void] {
  const [saved] = useState(() => loadPlace(key));
  const [filter, setFilterState] = useState<WallFilter>(() => {
    const f = saved?.filter ?? ALL;
    // Until the list is known, hold the collection; the ready effect settles it.
    return f.collectionId !== null && collectionIds.length > 0 && !collectionIds.includes(f.collectionId)
      ? { ...f, collectionId: null }
      : f;
  });

  const latest = useRef({ filter, ready });
  latest.current = { filter, ready };

  useEffect(() => {
    try {
      history.scrollRestoration = "manual";
    } catch {
      // Some browsers refuse; ours then just runs alongside theirs.
    }
  }, []);

  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const id = filter.collectionId;
    if (id !== null && !collectionIds.includes(id)) setFilterState({ ...filter, collectionId: null });
    if (saved && saved.scrollY > 0) window.scrollTo(0, saved.scrollY);
    // Runs once, the first time the wall is ready.
  }, [ready]);

  useEffect(() => {
    const save = () => {
      // Before the wall has rendered, scrollY is 0 and would clobber the real place.
      if (!latest.current.ready) return;
      savePlace(key, { filter: latest.current.filter, scrollY: window.scrollY });
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHidden);
      save();
    };
  }, [key]);

  const setFilter = useCallback((f: WallFilter) => setFilterState(f), []);
  return [filter, setFilter];
}
