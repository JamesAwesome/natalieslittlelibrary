import { describe, expect, test } from "vitest";
import type { CopyView } from "../../shared/types";
import { tabRoot } from "../shell";
import { backFor, MAIN_ORDER, mainAction, storedBack } from "./model";

describe("mainAction", () => {
  test("the order is claim, approve, return, take, lend, ask, withdraw", () => {
    expect(MAIN_ORDER).toEqual(["claim", "approve", "return", "adopt", "lend", "request", "withdraw"]);
  });
  test("an open request is answered first: Approve beats Mark as returned", () => {
    expect(mainAction(["return", "lend", "approve", "decline"], "c")).toBe("approve");
    expect(mainAction(["return", "approve", "claim"], "c")).toBe("claim");
  });
  test("picks the first allowed in that order", () => {
    expect(mainAction(["lend", "give"], "c")).toBe("lend");
    expect(mainAction(["withdraw", "return", "claim"], "c")).toBe("claim");
    expect(mainAction(["decline", "approve"], "c")).toBe("approve");
  });
  test("claim and take need the label's code", () => {
    expect(mainAction(["claim", "request"], null)).toBe("request");
    expect(mainAction(["adopt"], null)).toBeNull();
    expect(mainAction(["adopt"], "c")).toBe("adopt");
  });
  test("none of them allowed means no main action", () => {
    expect(mainAction(["give", "move"], "c")).toBeNull();
    expect(mainAction([], "c")).toBeNull();
  });
});

const origin = "https://library.test";
const ann = { id: "2", name: "Ann", pictureUrl: null };
const copy = (over: Partial<CopyView> = {}): CopyView => ({
  copyId: "c1", code: "abc", ownerCode: null, book: { isbn: null, title: "Dune", authors: [], coverUrl: null },
  owner: ann, holder: null, request: null, home: true, collection: { id: "k1", name: "Home library" }, history: [], actions: [], ...over,
});

describe("backFor", () => {
  test("a wall on this site goes back to that wall", () => {
    expect(backFor(`${origin}/`, origin, copy(), "friends")).toEqual({ href: "/", label: "My books" });
    expect(backFor(`${origin}/mine`, origin, copy(), "friends")).toEqual({ href: "/", label: "My books" });
    expect(backFor(`${origin}/holding`, origin, copy(), "books")).toEqual({ href: "/holding", label: "Holding" });
    expect(backFor(`${origin}/members/2`, origin, copy(), "friends")).toEqual({ href: "/members/2", label: "Ann’s books" });
    expect(backFor(`${origin}/collections/k1`, origin, copy(), "books")).toEqual({ href: "/collections/k1", label: "Home library" });
  });
  test("a query, hash or trailing slash on the wall's address doesn't matter", () => {
    expect(backFor(`${origin}/holding/?x=1#y`, origin, copy(), "books")).toEqual({ href: "/holding", label: "Holding" });
  });
  test("a removed owner's wall reads through personLabel", () => {
    const c = copy({ owner: { ...ann, removed: true } });
    expect(backFor(`${origin}/members/2`, origin, c, "friends")).toEqual({ href: "/members/2", label: "Ann (no longer a member)’s books" });
  });
  test("anything else goes to the tab's root", () => {
    expect(backFor("https://elsewhere.test/holding", origin, copy(), "friends")).toEqual(tabRoot.friends);
    expect(backFor("", origin, copy(), "books")).toEqual(tabRoot.books);
    expect(backFor("not a url", origin, copy(), "holding")).toEqual(tabRoot.holding);
    expect(backFor(`${origin}/members/9`, origin, copy(), "friends")).toEqual(tabRoot.friends);
    expect(backFor(`${origin}/members/2`, origin, copy({ owner: null }), "friends")).toEqual(tabRoot.friends);
    expect(backFor(`${origin}/collections/k9`, origin, copy(), "books")).toEqual(tabRoot.books);
    expect(backFor(`${origin}/collections/k1`, origin, copy({ collection: null }), "books")).toEqual(tabRoot.books);
    expect(backFor(`${origin}/b/abc`, origin, copy(), "books")).toEqual(tabRoot.books);
    expect(backFor(`${origin}/pair?copy=c1`, origin, copy(), "books")).toEqual(tabRoot.books);
    expect(backFor(`${origin}/members`, origin, copy(), "more")).toEqual(tabRoot.more);
  });
});

describe("storedBack", () => {
  test("takes a target backFor could have produced for this copy", () => {
    expect(storedBack({ back: { href: "/members/2", label: "Ann’s books" } }, copy())).toEqual({ href: "/members/2", label: "Ann’s books" });
    expect(storedBack({ other: 1, back: { href: "/collections/k1", label: "Home library" } }, copy())).toEqual({ href: "/collections/k1", label: "Home library" });
    expect(storedBack({ back: { href: "/holding", label: "Holding" } }, copy())).toEqual({ href: "/holding", label: "Holding" });
    expect(storedBack({ back: tabRoot.friends }, null)).toEqual(tabRoot.friends);
  });
  test("ignores anything else", () => {
    expect(storedBack(null, copy())).toBeNull();
    expect(storedBack("x", copy())).toBeNull();
    expect(storedBack({}, copy())).toBeNull();
    expect(storedBack({ back: null }, copy())).toBeNull();
    expect(storedBack({ back: { href: 1, label: "My books" } }, copy())).toBeNull();
    expect(storedBack({ back: { href: "https://elsewhere.test/", label: "My books" } }, copy())).toBeNull();
    expect(storedBack({ back: { href: "/", label: "<b>Hi</b>" } }, copy())).toBeNull();
    expect(storedBack({ back: { href: "/members/9", label: "Ann’s books" } }, copy())).toBeNull();
    expect(storedBack({ back: { href: "/members/2", label: "Ann’s books" } }, copy({ owner: null }))).toBeNull();
    expect(storedBack({ back: { href: "/collections/k1", label: "Home library" } }, null)).toBeNull();
    expect(storedBack({ back: tabRoot.more }, copy())).toBeNull();
  });
});
