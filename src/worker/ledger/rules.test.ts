import { expect, test } from "vitest";
import type { Member } from "../../shared/types";
import { availableActions } from "./rules";

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
