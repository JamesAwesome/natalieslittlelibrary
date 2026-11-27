import { createContext, useContext, useEffect, useRef } from "react";
import type { Route } from "./route";

export type Tab = "books" | "holding" | "pair" | "friends" | "more";

export const APP_NAME = "Natalie's Little Library";

export const tabRoot: Record<Tab, { href: string; label: string }> = {
  books: { href: "/", label: "My books" },
  holding: { href: "/holding", label: "Holding" },
  pair: { href: "/pair", label: "Pair a book" },
  friends: { href: "/members", label: "Friends" },
  more: { href: "/more", label: "More" },
};

// Data-dependent routes (a copy, a shelf) have no tab of their own.
export function tabFor(route: Route): Tab | null {
  switch (route.name) {
    case "home":
    case "mine":
      return "books";
    case "holding":
      return "holding";
    case "members":
    case "member":
      return "friends";
    case "pair":
      return "pair";
    case "more":
    case "labels":
    case "import":
    case "people":
      return "more";
    case "copy":
    case "copy-by-id":
    case "shelf":
    case "not-found":
      return null;
  }
}

export const ShellContext = createContext<{
  setTab(tab: Tab | null): void;
  setSignedOut(on: boolean): void;
}>({
  setTab() {},
  setSignedOut() {},
});

// Reports the active tab to the shell once per mount. undefined means "not decided yet".
export function useTab(tab: Tab | null | undefined): void {
  const { setTab } = useContext(ShellContext);
  const sent = useRef(false);
  useEffect(() => {
    if (tab === undefined || sent.current) return;
    sent.current = true;
    setTab(tab);
  }, [tab, setTab]);
}
