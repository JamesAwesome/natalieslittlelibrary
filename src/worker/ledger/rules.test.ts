import { expect, test } from "vitest";
import type { ActionType, Member } from "../../shared/types";
import { availableActions, decide, type Action, type Change, type CopyState } from "./rules";

const member = (id: string): Member => ({ id, name: id, email: `${id}@example.com`, pictureUrl: null, isAdmin: false });

const base = {
  ownerId: "a",
  ownerRemoved: false,
  holderMemberId: "a",
  holderPersonId: null,
  requestedBy: null,
  requesterRemoved: false,
  labelled: true,
} as const satisfies CopyState;
const st = (over: Partial<CopyState> = {}): CopyState => ({ ...base, ...over });

test.each([
  ["owner at home", st(), "a", ["move", "relabel", "lend", "give", "release"]],
  ["owner, lent to a placeholder", st({ holderMemberId: null, holderPersonId: "p" }), "a", ["return", "move", "relabel", "lend", "give", "release"]],
  ["owner of a copy with no label", st({ labelled: false }), "a", ["move", "label", "lend", "give"]],
  ["owner while the book is out", st({ holderMemberId: "b" }), "a", ["return", "move", "relabel", "lend", "give", "release"]],
  [
    "owner, request open from holder b",
    st({ holderMemberId: "b", requestedBy: "b" }),
    "a",
    ["return", "move", "relabel", "lend", "give", "approve", "decline", "release"],
  ],
  ["owner, request from a removed asker", st({ holderMemberId: "b", requestedBy: "b", requesterRemoved: true }), "a", ["return", "move", "relabel", "lend", "give", "release"]],
  ["holder who is not the owner", st({ holderMemberId: "b" }), "b", ["request"]],
  ["holder who asked", st({ holderMemberId: "b", requestedBy: "b" }), "b", ["withdraw"]],
  ["a new holder, after a removed asker's stale request", st({ holderMemberId: "d", requestedBy: "b", requesterRemoved: true }), "d", ["request"]],
  ["a third member, book at home", st(), "c", ["claim"]],
  ["a third member, book out", st({ holderMemberId: "b" }), "c", ["claim"]],
  ["a third member, book held by a placeholder", st({ holderMemberId: null, holderPersonId: "p" }), "c", ["claim"]],
  ["a third member, copy with no label", st({ labelled: false }), "c", ["claim"]],
  ["any member, copy with no owner", st({ ownerId: null, holderMemberId: "b" }), "c", ["adopt"]],
  ["the holder of a copy with no owner", st({ ownerId: null, holderMemberId: "b" }), "b", ["adopt"]],
  ["a copy with no owner and no holder", st({ ownerId: null, holderMemberId: null, labelled: false }), "c", ["adopt"]],
  ["a third member, copy whose owner was removed", st({ ownerRemoved: true }), "c", ["adopt"]],
] as const)("%s", (_name, state, viewer, expected) => {
  expect(availableActions(state, member(viewer), { labelInHand: true })).toEqual(expected);
});

test("claim and adopt are offered only when the label is in hand", () => {
  expect(availableActions(st(), member("c"), { labelInHand: false })).toEqual([]);
  expect(availableActions(st({ ownerId: null }), member("c"), { labelInHand: false })).toEqual([]);
  expect(availableActions(st({ ownerRemoved: true }), member("c"), { labelInHand: false })).toEqual([]);
  expect(availableActions(st(), member("a"), { labelInHand: false })).toEqual(["move", "relabel", "lend", "give", "release"]);
});

const out = st({ holderMemberId: "b" });
const noChange = { ownerId: "a", holderMemberId: "a", holderPersonId: null, requestedBy: null, event: null, subject: null, ownerChanged: false } as const;

test.each([
  ["claim from a third member", st(), "c", { type: "claim" }, { ...noChange, holderMemberId: "c", event: "claimed" }],
  ["claim from a placeholder holder", st({ holderMemberId: null, holderPersonId: "p" }), "c", { type: "claim" }, { ...noChange, holderMemberId: "c", event: "claimed" }],
  ["claim clears a request", st({ holderMemberId: "b", requestedBy: "b" }), "c", { type: "claim" }, { ...noChange, holderMemberId: "c", event: "claimed" }],
  ["return from a member holder", out, "a", { type: "return" }, { ...noChange, event: "returned" }],
  ["return from a placeholder holder", st({ holderMemberId: null, holderPersonId: "p" }), "a", { type: "return" }, { ...noChange, event: "returned" }],
  ["move", out, "a", { type: "move" }, { ...noChange, holderMemberId: "b" }],
  ["move keeps a request", st({ holderMemberId: "b", requestedBy: "b" }), "a", { type: "move" }, { ...noChange, holderMemberId: "b", requestedBy: "b" }],
  ["label", st({ labelled: false }), "a", { type: "label" }, { ...noChange, event: "labelled" }],
  ["relabel", st(), "a", { type: "relabel" }, { ...noChange, event: "relabelled" }],
  [
    "lend to a member, out with b",
    st({ holderMemberId: "b", requestedBy: "b" }),
    "a",
    { type: "lend", to: { member: "c" } },
    { ...noChange, holderMemberId: "c", event: "lent", subject: { member: "c" } },
  ],
  [
    "lend to a placeholder",
    st({ holderMemberId: "b", requestedBy: "b" }),
    "a",
    { type: "lend", to: { person: "p" } },
    { ...noChange, holderMemberId: null, holderPersonId: "p", event: "lent", subject: { person: "p" } },
  ],
  [
    "give when home",
    st({ requestedBy: "b" }),
    "a",
    { type: "give", to: "c" },
    { ...noChange, ownerId: "c", holderMemberId: "c", event: "given", subject: { member: "c" }, ownerChanged: true },
  ],
  [
    "give when out with b",
    st({ holderMemberId: "b" }),
    "a",
    { type: "give", to: "c" },
    { ...noChange, ownerId: "c", holderMemberId: "b", event: "given", subject: { member: "c" }, ownerChanged: true },
  ],
  [
    "give when out with a placeholder",
    st({ holderMemberId: null, holderPersonId: "p" }),
    "a",
    { type: "give", to: "c" },
    { ...noChange, ownerId: "c", holderMemberId: null, holderPersonId: "p", event: "given", subject: { member: "c" }, ownerChanged: true },
  ],
  ["request", out, "b", { type: "request" }, { ...noChange, holderMemberId: "b", requestedBy: "b", event: "requested" }],
  ["withdraw", st({ holderMemberId: "b", requestedBy: "b" }), "b", { type: "withdraw" }, { ...noChange, holderMemberId: "b", event: "withdrawn" }],
  [
    "approve",
    st({ holderMemberId: "b", requestedBy: "b" }),
    "a",
    { type: "approve" },
    { ...noChange, ownerId: "b", holderMemberId: "b", event: "approved", subject: { member: "b" }, ownerChanged: true },
  ],
  [
    "decline",
    st({ holderMemberId: "b", requestedBy: "b" }),
    "a",
    { type: "decline" },
    { ...noChange, holderMemberId: "b", event: "declined", subject: { member: "b" } },
  ],
  ["release", st({ holderMemberId: "b", requestedBy: "b" }), "a", { type: "release" }, { ...noChange, ownerId: null, holderMemberId: "b", event: "released", ownerChanged: true }],
  ...(["move", "label", "relabel"] as const).map((type) => [
    `${type} clears a removed asker's request`,
    st({ holderMemberId: "c", requestedBy: "c", requesterRemoved: true, labelled: type === "relabel" }),
    "a",
    { type },
    { ...noChange, holderMemberId: "c", event: type === "move" ? null : type === "label" ? "labelled" : "relabelled" },
  ] as [string, CopyState, string, Action, Change]),
  [
    "request overwrites a removed asker's",
    st({ holderMemberId: "d", requestedBy: "b", requesterRemoved: true }),
    "d",
    { type: "request" },
    { ...noChange, holderMemberId: "d", requestedBy: "d", event: "requested" },
  ],
  [
    "adopt an ownerless copy",
    st({ ownerId: null, holderMemberId: "b", holderPersonId: null, requestedBy: "b" }),
    "c",
    { type: "adopt" },
    { ...noChange, ownerId: "c", holderMemberId: "c", event: "adopted", ownerChanged: true },
  ],
  [
    "adopt a removed owner's copy held by a placeholder",
    st({ ownerRemoved: true, holderMemberId: null, holderPersonId: "p" }),
    "c",
    { type: "adopt" },
    { ...noChange, ownerId: "c", holderMemberId: "c", event: "adopted", ownerChanged: true },
  ],
] satisfies [string, CopyState, string, Action, Change][])("decide: %s", (_name, state, viewer, action, expected) => {
  expect(decide(state, member(viewer), action)).toEqual(expected);
});

test.each([
  ["lend to the owner", out, "a", { type: "lend", to: { member: "a" } }],
  ["lend to the current holder member", out, "a", { type: "lend", to: { member: "b" } }],
  ["lend to the current placeholder", st({ holderMemberId: null, holderPersonId: "p" }), "a", { type: "lend", to: { person: "p" } }],
  ["lend by a non-owner", out, "b", { type: "lend", to: { member: "c" } }],
  ["give to the owner", out, "a", { type: "give", to: "a" }],
  ["give by a non-owner", out, "b", { type: "give", to: "c" }],
  ["request when one is open", st({ holderMemberId: "b", requestedBy: "b" }), "b", { type: "request" }],
  ["request by the owner of a placeholder-held copy", st({ holderMemberId: null, holderPersonId: "p" }), "a", { type: "request" }],
  ["request on an ownerless copy", st({ ownerId: null, holderMemberId: "b" }), "b", { type: "request" }],
  ["request on a removed owner's copy", st({ ownerRemoved: true, holderMemberId: "b" }), "b", { type: "request" }],
  ["withdraw by someone not the asker", st({ holderMemberId: "b", requestedBy: "b" }), "c", { type: "withdraw" }],
  ["withdraw a removed asker's request", st({ holderMemberId: "b", requestedBy: "c", requesterRemoved: true }), "c", { type: "withdraw" }],
  ["approve with no request", out, "a", { type: "approve" }],
  ["decline with no request", out, "a", { type: "decline" }],
  ["approve a removed asker", st({ holderMemberId: "b", requestedBy: "b", requesterRemoved: true }), "a", { type: "approve" }],
  ["release unlabelled", st({ labelled: false }), "a", { type: "release" }],
  ["adopt an owned copy", st(), "c", { type: "adopt" }],
  ["claim an ownerless copy", st({ ownerId: null, holderMemberId: "b" }), "c", { type: "claim" }],
  ["claim a removed owner's copy", st({ ownerRemoved: true }), "c", { type: "claim" }],
  ["claim by the holder", out, "b", { type: "claim" }],
  ["claim by the owner", st(), "a", { type: "claim" }],
  ["return by the holder", out, "b", { type: "return" }],
  ["return when home", st(), "a", { type: "return" }],
  ["move by the holder", out, "b", { type: "move" }],
  ["label an already labelled copy", st(), "a", { type: "label" }],
  ["relabel an unlabelled copy", st({ labelled: false }), "a", { type: "relabel" }],
] satisfies [string, CopyState, string, Action][])("decide refuses: %s", (_name, state, viewer, action) => {
  expect(decide(state, member(viewer), action)).toEqual({ rejected: "not-allowed" });
});

test("an action is available exactly when decide allows it", () => {
  const ids = ["a", "b", "c"];
  const targeted = (type: ActionType): Action | null =>
    type === "lend" ? { type, to: { person: "q" } } : type === "give" ? { type, to: "c" } : { type } as Action;
  const types: ActionType[] = [
    "claim", "return", "move", "label", "relabel", "lend", "give", "request", "withdraw", "approve", "decline", "release", "adopt",
  ];
  for (const ownerId of [...ids, null]) for (const ownerRemoved of [true, false])
  for (const holderMemberId of [...ids, null]) for (const holderPersonId of [null, "p"])
  for (const requestedBy of [...ids, null]) for (const requesterRemoved of [true, false])
  for (const labelled of [true, false]) {
    if (holderMemberId !== null && holderPersonId !== null) continue;
    const state: CopyState = { ownerId, ownerRemoved, holderMemberId, holderPersonId, requestedBy, requesterRemoved, labelled };
    for (const v of ids) for (const labelInHand of [true, false]) {
      const available = availableActions(state, member(v), { labelInHand });
      for (const a of types) {
        // A give to the owner is refused on its target alone; no other target here can be refused.
        const d = decide(state, member(v), targeted(a)!);
        const targetRefused = a === "give" && ownerId === "c";
        const allowed = !("rejected" in d) && ((a !== "claim" && a !== "adopt") || labelInHand);
        if (targetRefused) continue;
        expect(available.includes(a), `${JSON.stringify(state)} viewer ${v} ${a} inHand ${labelInHand}`).toBe(allowed);
      }
    }
  }
});

test("every change that moves the owner or a holder clears the request", () => {
  const ids = ["a", "b", "c"];
  for (const holderMemberId of [...ids, null]) for (const requestedBy of ids) for (const v of ids) {
    const state = st({ holderMemberId, holderPersonId: holderMemberId === null ? "p" : null, requestedBy });
    const actions: Action[] = [
      { type: "claim" }, { type: "return" }, { type: "release" }, { type: "adopt" }, { type: "approve" },
      { type: "lend", to: { member: "c" } }, { type: "lend", to: { person: "q" } }, { type: "give", to: "c" },
    ];
    for (const a of actions) {
      const d = decide(state, member(v), a);
      if ("rejected" in d) continue;
      expect(d.requestedBy, `${JSON.stringify(state)} viewer ${v} ${a.type}`).toBeNull();
    }
  }
});
