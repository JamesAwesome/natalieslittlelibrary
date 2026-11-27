import type { ActionType, CopyView } from "../../shared/types";
import { matchRoute } from "../route";
import { personLabel } from "../screens/BookCard";
import { tabRoot, type Tab } from "../shell";

// Which allowed action gets the page's one main button, first match wins. Every other allowed action is a row.
export const MAIN_ORDER: ActionType[] = ["claim", "return", "adopt", "approve", "lend", "request", "withdraw"];

// Claim and take go through the label's code, so a copy reached by id (code null) never offers them.
export function mainAction(actions: ActionType[], code: string | null): ActionType | null {
  return MAIN_ORDER.find((a) => actions.includes(a) && !(code === null && (a === "claim" || a === "adopt"))) ?? null;
}

// Where the back link goes: the wall this visit came from, when the referrer says so; otherwise the root of the page's tab.
export function backFor(referrer: string, origin: string, copy: CopyView, tab: Tab): { href: string; label: string } {
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return tabRoot[tab];
  }
  if (url.origin !== origin) return tabRoot[tab];
  const route = matchRoute(url.pathname);
  switch (route.name) {
    case "home":
    case "mine":
      return { href: "/", label: "My books" };
    case "holding":
      return { href: "/holding", label: "Holding" };
    case "member":
      if (copy.owner !== null && route.id === copy.owner.id) return { href: `/members/${route.id}`, label: `${personLabel(copy.owner)}’s books` };
      break;
    case "shelf":
      if (copy.collection !== null && route.id === copy.collection.id) return { href: `/collections/${route.id}`, label: copy.collection.name };
      break;
  }
  return tabRoot[tab];
}
