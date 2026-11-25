import { expect, test } from "vitest";
import type { Member } from "../../shared/types";
import type { ActionType } from "../../shared/types";
import { availableActions, decide, type CopyState } from "./rules";

const member = (id: string): Member => ({ id, name: id, email: `${id}@example.com`, pictureUrl: null, isAdmin: false });

test.each([
  ["owner at home", { ownerId: "a", holderMemberId: "a" }, "a", []],
  ["owner while the book is out", { ownerId: "a", holderMemberId: "b" }, "a", ["return"]],
  ["holder who is not the owner", { ownerId: "a", holderMemberId: "b" }, "b", []],
  ["a third member, book at home", { ownerId: "a", holderMemberId: "a" }, "c", ["claim"]],
  ["a third member, book out", { ownerId: "a", holderMemberId: "b" }, "c", ["claim"]],
  ["a copy with no owner", { ownerId: null, holderMemberId: "b" }, "c", []],
  ["a copy with no owner and no holder", { ownerId: null, holderMemberId: null }, "c", []],
] as const)("%s", (_name, state, viewer, expected) => {
  expect(availableActions(state, member(viewer))).toEqual(expected);
});

const OWNER = "a";
const HOLDER = "b";
const THIRD = "c";
const states = {
  home: { ownerId: OWNER, holderMemberId: OWNER },
  out: { ownerId: OWNER, holderMemberId: HOLDER },
  "no owner": { ownerId: null, holderMemberId: HOLDER },
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
] as const)("%s, copy %s, %s -> %s", (_who, viewer, state, action, outcome) => {
  const d = decide(states[state], member(viewer), action);
  if (outcome === "not-allowed") expect(d).toEqual({ rejected: "not-allowed" });
  else expect(d).toEqual({ holderMemberId: viewer, event: outcome });
});

test("an action is available exactly when decide allows it", () => {
  const ids = [OWNER, HOLDER, THIRD];
  const owners = [...ids, null];
  const holders = [...ids, null];
  const actions: ActionType[] = ["claim", "return"];
  for (const ownerId of owners) {
    for (const holderMemberId of holders) {
      for (const v of ids) {
        const state = { ownerId, holderMemberId };
        const available = availableActions(state, member(v));
        for (const a of actions) {
          expect(available.includes(a), `${JSON.stringify(state)} viewer ${v} ${a}`).toBe(!("rejected" in decide(state, member(v), a)));
        }
      }
    }
  }
});
