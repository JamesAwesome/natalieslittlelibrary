import type { ActionType, CopyView } from "../../shared/types";
import { matchRoute } from "../route";
import { personLabel } from "../screens/BookCard";
import { tabRoot, type Tab } from "../shell";

// Which allowed action gets the page's one main button, first match wins. Every other allowed action is a row.
// Approve comes before return: an open request always comes with return, and the request is what needs an answer.
export const MAIN_ORDER: ActionType[] = ["claim", "approve", "return", "adopt", "lend", "request", "withdraw"];

// Claim and take go through the label's code, so a copy reached by id (code null) never offers them.
export function mainAction(actions: ActionType[], code: string | null): ActionType | null {
  return MAIN_ORDER.find((a) => actions.includes(a) && !(code === null && (a === "claim" || a === "adopt"))) ?? null;
}

// Where the back link goes: the wall this visit came from, when the referrer says so; otherwise the root of the page's tab.
export function backFor(referrer: string, origin: string, copy: CopyView, tab: Tab): Back {
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

export type Back = { href: string; label: string };

// A way back saved with this history entry (so it outlives a reload, whose referrer is the page itself).
// Only a target backFor could have produced for this copy is taken; anything else is ignored.
export function storedBack(state: unknown, copy: CopyView | null): Back | null {
  if (typeof state !== "object" || state === null || !("back" in state)) return null;
  const back = (state as { back: unknown }).back;
  if (typeof back !== "object" || back === null) return null;
  const { href, label } = back as { href?: unknown; label?: unknown };
  if (typeof href !== "string" || typeof label !== "string") return null;
  const possible: Back[] = [tabRoot.books, tabRoot.holding, tabRoot.friends, { href: "/", label: "My books" }, { href: "/holding", label: "Holding" }];
  if (copy?.owner) possible.push({ href: `/members/${copy.owner.id}`, label: `${personLabel(copy.owner)}’s books` });
  if (copy?.collection) possible.push({ href: `/collections/${copy.collection.id}`, label: copy.collection.name });
  return possible.find((p) => p.href === href && p.label === label) ?? null;
}
