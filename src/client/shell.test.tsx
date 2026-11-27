import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Route } from "./route";
import { ShellContext, tabFor, useTab, type Tab } from "./shell";

test.each<[Route, Tab | null]>([
  [{ name: "home" }, "books"],
  [{ name: "mine" }, "books"],
  [{ name: "holding" }, "holding"],
  [{ name: "members" }, "friends"],
  [{ name: "member", id: "m1" }, "friends"],
  [{ name: "more" }, "more"],
  [{ name: "pair" }, "pair"],
  [{ name: "labels" }, "more"],
  [{ name: "import" }, "more"],
  [{ name: "people" }, "more"],
  [{ name: "copy", code: "abc" }, null],
  [{ name: "copy-by-id", id: "c1" }, null],
  [{ name: "shelf", id: "c1" }, null],
  [{ name: "not-found" }, null],
])("tabFor(%j) is %s", (route, tab) => {
  expect(tabFor(route)).toBe(tab);
});

function Probe({ tab }: { tab: Tab | null | undefined }) {
  useTab(tab);
  return null;
}

test("useTab calls setTab once, with the first defined value, across re-renders", () => {
  const setTab = vi.fn();
  const setSignedOut = vi.fn();
  const ui = (tab: Tab | null | undefined) => (
    <ShellContext.Provider value={{ setTab, setSignedOut }}>
      <Probe tab={tab} />
    </ShellContext.Provider>
  );
  const { rerender } = render(ui(undefined));
  expect(setTab).not.toHaveBeenCalled();
  rerender(ui("books"));
  rerender(ui("friends"));
  expect(setTab).toHaveBeenCalledOnce();
  expect(setTab).toHaveBeenCalledWith("books");
});

test("useTab treats null as a value and calls setTab(null) once", () => {
  const setTab = vi.fn();
  const setSignedOut = vi.fn();
  const ui = (tab: Tab | null | undefined) => (
    <ShellContext.Provider value={{ setTab, setSignedOut }}>
      <Probe tab={tab} />
    </ShellContext.Provider>
  );
  const { rerender } = render(ui(null));
  rerender(ui("more"));
  expect(setTab).toHaveBeenCalledOnce();
  expect(setTab).toHaveBeenCalledWith(null);
});
