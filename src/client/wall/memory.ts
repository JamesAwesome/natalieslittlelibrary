import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ALL, type WallFilter } from "./model";

/**
 * `scrollY` is the page offset, kept as the fallback. `anchor`, when the wall's anchor was on the page, is the
 * offset from the top of its chips row (negative above it): what sits above the chips (the requests list, the
 * create form, a request answered elsewhere) can be taller or shorter next visit, and the covers move with it.
 */
export type WallPlace = { filter: WallFilter; scrollY: number; anchor?: number };

/** The attribute CoverWall puts on the element that marks where its chips row (or grid) starts. */
export const WALL_ANCHOR = "data-wall-anchor";

/** The anchor's top in page coordinates, or null when no wall is on the page. */
export function anchorTop(): number | null {
  const el = typeof document === "undefined" ? null : document.querySelector(`[${WALL_ANCHOR}]`);
  return el ? el.getBoundingClientRect().top + window.scrollY : null;
}

const STATUSES = ["all", "home", "out", "unlabelled"];

/** What the screens pass as the key: one place per path. */
export const wallKey = (): string => `wall:${location.pathname}`;

function parse(raw: string | null): WallPlace | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { filter, scrollY, anchor } = v as { filter?: unknown; scrollY?: unknown; anchor?: unknown };
    if (typeof filter !== "object" || filter === null) return null;
    const { status, collectionId, q } = filter as { status?: unknown; collectionId?: unknown; q?: unknown };
    if (typeof status !== "string" || !STATUSES.includes(status)) return null;
    if (collectionId !== null && typeof collectionId !== "string") return null;
    // Absent in places saved before the find box.
    if (q !== undefined && typeof q !== "string") return null;
    if (typeof scrollY !== "number" || !Number.isFinite(scrollY) || scrollY < 0) return null;
    if (anchor !== undefined && (typeof anchor !== "number" || !Number.isFinite(anchor))) return null;
    const place: WallPlace = { filter: { status: status as WallFilter["status"], collectionId }, scrollY };
    if (q !== undefined) place.filter.q = q;
    if (anchor !== undefined) place.anchor = anchor;
    return place;
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
  const droppedAtInit = useRef(false);
  const [filter, setFilterState] = useState<WallFilter>(() => {
    const f = saved?.filter ?? ALL;
    // Until the list is known, hold the collection; the ready effect settles it.
    if (f.collectionId !== null && collectionIds.length > 0 && !collectionIds.includes(f.collectionId)) {
      droppedAtInit.current = true;
      return { ...f, collectionId: null };
    }
    return f;
  });

  const latest = useRef({ filter });
  latest.current = { filter };
  // Once the wall has rendered, a later refetch flipping `ready` back must not stop saves.
  const everReady = useRef(false);
  if (ready) everReady.current = true;
  // The DOM is gone by the time an unmount cleanup runs, so window.scrollY would read clamped; track it as it moves.
  const lastScroll = useRef(typeof window === "undefined" ? 0 : window.scrollY);
  const lastAnchor = useRef<number | null>(null);

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
    if (id !== null && !collectionIds.includes(id)) {
      // The saved offset belonged to a different list: land at the top.
      setFilterState({ ...filter, collectionId: null });
      return;
    }
    if (saved && !droppedAtInit.current) {
      // Against the chips row where it is now, when you left at or below it. Left above it (at the top, say), the
      // page offset stands: whatever new appeared above the chips (a request, an alert) must stay in view.
      // With no anchor to measure from, the page offset too.
      const top = saved.anchor === undefined || saved.anchor < 0 ? null : anchorTop();
      const y = top === null ? saved.scrollY : Math.max(0, Math.round(top + (saved.anchor ?? 0)));
      if (top !== null) lastAnchor.current = saved.anchor ?? null;
      if (y > 0) {
        lastScroll.current = y;
        window.scrollTo(0, y);
      }
    }
    // Runs once, the first time the wall is ready.
  }, [ready]);

  useEffect(() => {
    const save = () => {
      // Before the wall has rendered, scrollY is 0 and would clobber the real place.
      if (!everReady.current) return;
      const place: WallPlace = { filter: latest.current.filter, scrollY: lastScroll.current };
      // On pagehide and hidden the wall is still on the page; on unmount it is gone, so the last measure stands.
      const top = anchorTop();
      if (top !== null) lastAnchor.current = lastScroll.current - top;
      if (lastAnchor.current !== null) place.anchor = Math.round(lastAnchor.current);
      savePlace(key, place);
    };
    const onScroll = () => {
      lastScroll.current = window.scrollY;
      // Kept as it moves too, for an unmount save, when the wall (and its anchor) has already gone.
      const top = anchorTop();
      if (top !== null) lastAnchor.current = lastScroll.current - top;
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHidden);
      save();
    };
  }, [key]);

  const setFilter = useCallback((f: WallFilter) => setFilterState(f), []);
  return [filter, setFilter];
}
