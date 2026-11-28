import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadPlace, savePlace, useWallPlace, WALL_ANCHOR } from "./memory";
import { ALL } from "./model";

const KEY = "wall:/shelf";

const scrollYOwn = Object.getOwnPropertyDescriptor(window, "scrollY");

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (scrollYOwn) Object.defineProperty(window, "scrollY", scrollYOwn);
  else Reflect.deleteProperty(window, "scrollY");
  Reflect.deleteProperty(document, "visibilityState");
  document.querySelectorAll(`[${WALL_ANCHOR}]`).forEach((el) => el.remove());
});

const setScrollY = (y: number) => Object.defineProperty(window, "scrollY", { value: y, configurable: true });

// A stand-in for CoverWall's anchor, whose page top is `top()` whatever the scroll.
function anchorAt(top: () => number) {
  const el = document.createElement("div");
  el.setAttribute(WALL_ANCHOR, "");
  document.body.append(el);
  vi.spyOn(el, "getBoundingClientRect").mockImplementation(() => ({ top: top() - window.scrollY }) as DOMRect);
  return el;
}

test("round trips a place", () => {
  savePlace(KEY, { filter: { status: "out", collectionId: "c1" }, scrollY: 120 });
  expect(loadPlace(KEY)).toEqual({ filter: { status: "out", collectionId: "c1" }, scrollY: 120 });
});

test("round trips what was typed in the find box; a place saved before the box has none", () => {
  savePlace(KEY, { filter: { status: "all", collectionId: null, q: "hobbit" }, scrollY: 0 });
  expect(loadPlace(KEY)?.filter).toEqual({ status: "all", collectionId: null, q: "hobbit" });
  sessionStorage.setItem(KEY, JSON.stringify({ filter: { status: "home", collectionId: null }, scrollY: 5 }));
  expect(loadPlace(KEY)).toEqual({ filter: { status: "home", collectionId: null }, scrollY: 5 });
});

test("a missing, corrupt or wrongly shaped value gives null", () => {
  expect(loadPlace(KEY)).toBeNull();
  sessionStorage.setItem(KEY, "{nope");
  expect(loadPlace(KEY)).toBeNull();
  for (const bad of [
    { filter: 5 },
    { filter: { status: "sideways", collectionId: null }, scrollY: 0 },
    { filter: { status: "all", collectionId: 7 }, scrollY: 0 },
    { filter: { status: "all", collectionId: null }, scrollY: -1 },
    { filter: { status: "all", collectionId: null }, scrollY: "9" },
    { filter: { status: "all", collectionId: null }, scrollY: null },
    { filter: { status: "all", collectionId: null }, scrollY: 0, anchor: "9" },
    { filter: { status: "all", collectionId: null }, scrollY: 0, anchor: null },
    { filter: { status: "all", collectionId: null, q: 5 }, scrollY: 0 },
    { filter: { status: "all", collectionId: null, q: null }, scrollY: 0 },
    null,
    [],
  ]) {
    sessionStorage.setItem(KEY, JSON.stringify(bad));
    expect(loadPlace(KEY)).toBeNull();
  }
});

test("storage that throws gives null and does not throw on save", () => {
  savePlace(KEY, { filter: ALL, scrollY: 10 });
  expect(loadPlace(KEY)).not.toBeNull();
  vi.stubGlobal("sessionStorage", {
    getItem() { throw new DOMException("denied", "SecurityError"); },
    setItem() { throw new DOMException("full", "QuotaExceededError"); },
  });
  expect(loadPlace(KEY)).toBeNull();
  expect(() => savePlace(KEY, { filter: ALL, scrollY: 0 })).not.toThrow();
});

test("the hook starts from the saved filter", () => {
  savePlace(KEY, { filter: { status: "home", collectionId: "c1" }, scrollY: 0 });
  const { result } = renderHook(() => useWallPlace(KEY, true, ["c1", "c2"]));
  expect(result.current[0]).toEqual({ status: "home", collectionId: "c1" });
});

test("the hook shows All when nothing or garbage is saved", () => {
  expect(renderHook(() => useWallPlace(KEY, true, [])).result.current[0]).toEqual(ALL);
  sessionStorage.setItem(KEY, "{nope");
  expect(renderHook(() => useWallPlace(KEY, true, [])).result.current[0]).toEqual(ALL);
});

test("the hook drops an unknown collectionId but keeps the status", () => {
  savePlace(KEY, { filter: { status: "out", collectionId: "gone" }, scrollY: 0 });
  const { result } = renderHook(() => useWallPlace(KEY, true, ["c1"]));
  expect(result.current[0]).toEqual({ status: "out", collectionId: null });
});

test("a collectionId is held while the list is unknown, then dropped once ready if absent", () => {
  savePlace(KEY, { filter: { status: "all", collectionId: "c9" }, scrollY: 0 });
  const { result, rerender } = renderHook(({ ready, ids }) => useWallPlace(KEY, ready, ids), {
    initialProps: { ready: false, ids: [] as string[] },
  });
  expect(result.current[0].collectionId).toBe("c9");
  rerender({ ready: true, ids: ["c1"] });
  expect(result.current[0].collectionId).toBeNull();
});

test("a collectionId that arrives with the list is kept", () => {
  savePlace(KEY, { filter: { status: "all", collectionId: "c1" }, scrollY: 0 });
  const { result, rerender } = renderHook(({ ready, ids }) => useWallPlace(KEY, ready, ids), {
    initialProps: { ready: false, ids: [] as string[] },
  });
  rerender({ ready: true, ids: ["c1"] });
  expect(result.current[0].collectionId).toBe("c1");
});

test("scrolls to the saved position only once the wall is ready, and only once", () => {
  savePlace(KEY, { filter: ALL, scrollY: 840 });
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const { rerender } = renderHook(({ ready }) => useWallPlace(KEY, ready, []), { initialProps: { ready: false } });
  expect(scrollTo).not.toHaveBeenCalled();
  rerender({ ready: true });
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollTo).toHaveBeenCalledWith(0, 840);
  rerender({ ready: false });
  rerender({ ready: true });
  expect(scrollTo).toHaveBeenCalledTimes(1);
});

test("does not scroll when there is nothing saved", () => {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  renderHook(() => useWallPlace(KEY, true, []));
  expect(scrollTo).not.toHaveBeenCalled();
});

test("takes manual control of scroll restoration, and survives it throwing", () => {
  renderHook(() => useWallPlace(KEY, true, []));
  expect(history.scrollRestoration).toBe("manual");
  const spy = vi.spyOn(history, "scrollRestoration", "set").mockImplementation(() => { throw new Error("no"); });
  expect(() => renderHook(() => useWallPlace(KEY, true, []))).not.toThrow();
  spy.mockRestore();
});

test("saves the filter and scroll on pagehide, on hidden, and on unmount", () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const { result, unmount } = renderHook(() => useWallPlace(KEY, true, ["c1"]));
  act(() => result.current[1]({ status: "out", collectionId: "c1" }));
  Object.defineProperty(window, "scrollY", { value: 300, configurable: true });
  window.dispatchEvent(new Event("scroll"));

  window.dispatchEvent(new Event("pagehide"));
  expect(loadPlace(KEY)).toEqual({ filter: { status: "out", collectionId: "c1" }, scrollY: 300 });

  sessionStorage.clear();
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(loadPlace(KEY)?.scrollY).toBe(300);

  sessionStorage.clear();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(loadPlace(KEY)).toBeNull();

  // React has removed the DOM by unmount, so the page reads 0; the last real position must win.
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  unmount();
  expect(loadPlace(KEY)?.scrollY).toBe(300);
});

test("a refetch flipping ready back to false does not stop the pagehide save", () => {
  const { result, rerender } = renderHook(({ ready }) => useWallPlace(KEY, ready, []), { initialProps: { ready: true } });
  act(() => result.current[1]({ status: "home", collectionId: null }));
  rerender({ ready: false });
  window.dispatchEvent(new Event("pagehide"));
  expect(loadPlace(KEY)?.filter.status).toBe("home");
});

test("a dropped collection keeps the status chip and lands at the top without scrolling", () => {
  savePlace(KEY, { filter: { status: "out", collectionId: "gone" }, scrollY: 700 });
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const { result } = renderHook(() => useWallPlace(KEY, true, ["c1"]));
  expect(result.current[0]).toEqual({ status: "out", collectionId: null });
  expect(scrollTo).not.toHaveBeenCalled();
});

test("does not overwrite a saved place before the wall is ready", () => {
  savePlace(KEY, { filter: { status: "home", collectionId: null }, scrollY: 500 });
  renderHook(() => useWallPlace(KEY, false, []));
  window.dispatchEvent(new Event("pagehide"));
  expect(loadPlace(KEY)?.scrollY).toBe(500);
});

test("an anchor offset round trips, negative too", () => {
  savePlace(KEY, { filter: ALL, scrollY: 10, anchor: -40 });
  expect(loadPlace(KEY)).toEqual({ filter: ALL, scrollY: 10, anchor: -40 });
});

// The area above the chips differs between visits; the covers you were looking at must come back.
test.each([
  ["the requests list was open when leaving", 600, 280],
  ["the create form was open when leaving", 495, 280],
  ["a request was answered elsewhere, so the bar is gone", 324, 280],
])("saves against the chips row and restores against where it is now: %s", (_name, before, after) => {
  let chipsTop = before;
  anchorAt(() => chipsTop);
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const first = renderHook(() => useWallPlace(KEY, true, []));
  setScrollY(before + 400);
  window.dispatchEvent(new Event("scroll"));
  window.dispatchEvent(new Event("pagehide"));
  expect(loadPlace(KEY)).toEqual({ filter: ALL, scrollY: before + 400, anchor: 400 });
  first.unmount();

  setScrollY(0);
  chipsTop = after;
  renderHook(() => useWallPlace(KEY, true, []));
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, after + 400);
});

test("left from the top, it comes back at the top even with more above the chips now", () => {
  let chipsTop = 97;
  anchorAt(() => chipsTop);
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const first = renderHook(() => useWallPlace(KEY, true, []));
  setScrollY(0);
  window.dispatchEvent(new Event("pagehide"));
  expect(loadPlace(KEY)).toEqual({ filter: ALL, scrollY: 0, anchor: -97 });
  first.unmount();
  // A request (or an alert) now sits above the chips.
  chipsTop = 190;
  renderHook(() => useWallPlace(KEY, true, []));
  expect(scrollTo).not.toHaveBeenCalled();
});

test("left above the chips row but scrolled, it returns to that page offset, not one measured from the chips", () => {
  savePlace(KEY, { filter: ALL, scrollY: 60, anchor: -37 });
  anchorAt(() => 190);
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  renderHook(() => useWallPlace(KEY, true, []));
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 60);
});

test("with no anchor on the page, the saved page offset is the fallback", () => {
  savePlace(KEY, { filter: ALL, scrollY: 900, anchor: 400 });
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  renderHook(() => useWallPlace(KEY, true, []));
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 900);
});

test("an unmount save, with the wall already gone, keeps the anchor offset last measured", () => {
  const el = anchorAt(() => 300);
  const { unmount } = renderHook(() => useWallPlace(KEY, true, []));
  setScrollY(800);
  window.dispatchEvent(new Event("scroll"));
  el.remove();
  setScrollY(0);
  unmount();
  expect(loadPlace(KEY)).toEqual({ filter: ALL, scrollY: 800, anchor: 500 });
});
