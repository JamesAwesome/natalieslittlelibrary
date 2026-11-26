import { expect, test } from "vitest";
import type { Member } from "../../shared/types";
import type { ActionType } from "../../shared/types";
import { availableActions, decide, type CopyState } from "./rules";

const member = (id: string): Member => ({ id, name: id, email: `${id}@example.com`, pictureUrl: null, isAdmin: false });

test.each([
  ["owner at home", { ownerId: "a", holderMemberId: "a", labelled: true }, "a", ["move"]],
  ["owner while the book is out", { ownerId: "a", holderMemberId: "b", labelled: true }, "a", ["return", "move"]],
  ["owner of a copy with no label", { ownerId: "a", holderMemberId: "a", labelled: false }, "a", ["move", "label"]],
  ["holder who is not the owner", { ownerId: "a", holderMemberId: "b", labelled: true }, "b", []],
  ["a third member, book at home", { ownerId: "a", holderMemberId: "a", labelled: true }, "c", ["claim"]],
  ["a third member, book out", { ownerId: "a", holderMemberId: "b", labelled: true }, "c", ["claim"]],
  ["a third member, copy with no label", { ownerId: "a", holderMemberId: "a", labelled: false }, "c", ["claim"]],
  ["a copy with no owner", { ownerId: null, holderMemberId: "b", labelled: true }, "c", []],
  ["a copy with no owner and no holder", { ownerId: null, holderMemberId: null, labelled: false }, "c", []],
] as const)("%s", (_name, state, viewer, expected) => {
  expect(availableActions(state, member(viewer), { labelInHand: true })).toEqual(expected);
});

test("claim is offered only when the label is in hand", () => {
  const state = { ownerId: "a", holderMemberId: "a", labelled: true };
  expect(availableActions(state, member("c"), { labelInHand: false })).toEqual([]);
  expect(availableActions(state, member("a"), { labelInHand: false })).toEqual(["move"]);
});

const OWNER = "a";
const HOLDER = "b";
const THIRD = "c";
const states = {
  home: { ownerId: OWNER, holderMemberId: OWNER, labelled: true },
  out: { ownerId: OWNER, holderMemberId: HOLDER, labelled: true },
  "no owner": { ownerId: null, holderMemberId: HOLDER, labelled: true },
  "home, no label": { ownerId: OWNER, holderMemberId: OWNER, labelled: false },
  "out, no label": { ownerId: OWNER, holderMemberId: HOLDER, labelled: false },
} as const satisfies Record<string, CopyState>;

test.each([
  // [who the viewer is, viewer id, copy state, action, outcome]
  ["a third member", THIRD, "home", "claim", "claimed"],
  ["a third member", THIRD, "out", "claim", "claimed"],
  ["the holder", HOLDER, "out", "claim", "not-allowed"],
  ["the owner", OWNER, "home", "claim", "not-allowed"],
  ["the owner", OWNER, "out", "claim", "not-allowed"],
  ["a third member", THIRD, "no owner", "claim", "not-allowed"],
  ["the owner", OWNER, "out", "return", "returned"],
  ["the owner", OWNER, "home", "return", "not-allowed"],
  ["the holder", HOLDER, "out", "return", "not-allowed"],
  ["a third member", THIRD, "out", "return", "not-allowed"],
  ["the owner", OWNER, "home", "move", "moved"],
  ["the owner", OWNER, "out", "move", "moved"],
  ["the holder", HOLDER, "out", "move", "not-allowed"],
  ["a third member", THIRD, "home", "move", "not-allowed"],
  ["a third member", THIRD, "no owner", "move", "not-allowed"],
  ["the owner", OWNER, "home, no label", "label", "labelled"],
  ["the owner", OWNER, "out, no label", "label", "labelled"],
  ["the owner", OWNER, "home", "label", "not-allowed"],
  ["the holder", HOLDER, "out, no label", "label", "not-allowed"],
  ["a third member", THIRD, "home, no label", "label", "not-allowed"],
] as const)("%s, copy %s, %s -> %s", (_who, viewer, state, action, outcome) => {
  const d = decide(states[state], member(viewer), action);
  const holder = states[state].holderMemberId;
  if (outcome === "not-allowed") expect(d).toEqual({ rejected: "not-allowed" });
  else if (outcome === "moved") expect(d).toEqual({ holderMemberId: holder, event: null });
  else if (outcome === "labelled") expect(d).toEqual({ holderMemberId: holder, event: "labelled" });
  else expect(d).toEqual({ holderMemberId: viewer, event: outcome });
});

test("an action is available exactly when decide allows it", () => {
  const ids = [OWNER, HOLDER, THIRD];
  const actions: ActionType[] = ["claim", "return", "move", "label"];
  for (const ownerId of [...ids, null]) {
    for (const holderMemberId of [...ids, null]) {
      for (const labelled of [true, false]) {
        for (const v of ids) {
          const state = { ownerId, holderMemberId, labelled };
          for (const labelInHand of [true, false]) {
            const available = availableActions(state, member(v), { labelInHand });
            for (const a of actions) {
              const allowed = !("rejected" in decide(state, member(v), a)) && (a !== "claim" || labelInHand);
              expect(available.includes(a), `${JSON.stringify(state)} viewer ${v} ${a} inHand ${labelInHand}`).toBe(allowed);
            }
          }
        }
      }
    }
  }
});
