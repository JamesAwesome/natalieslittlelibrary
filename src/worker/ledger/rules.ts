import type { ActionType, Member, Rejection } from "../../shared/types";

// `labelled`: the copy has a label bound to it.
export type CopyState = { ownerId: string | null; holderMemberId: string | null; labelled: boolean };

const ACTIONS: ActionType[] = ["claim", "return", "move", "label", "relabel"];

// The one place that says who may do what. Both the write and the list of buttons come from here.
export function decide(
  state: CopyState,
  viewer: Member,
  action: ActionType,
): { holderMemberId: string | null; event: "claimed" | "returned" | "labelled" | "relabelled" | null } | Rejection {
  const isOwner = state.ownerId !== null && state.ownerId === viewer.id;
  const isHolder = state.holderMemberId === viewer.id;
  if (action === "claim" && state.ownerId !== null && !isOwner && !isHolder) {
    return { holderMemberId: viewer.id, event: "claimed" };
  }
  if (action === "return" && isOwner && !isHolder) return { holderMemberId: viewer.id, event: "returned" };
  // Moving between one's own collections changes neither holder nor history.
  if (action === "move" && isOwner) return { holderMemberId: state.holderMemberId, event: null };
  if (action === "label" && isOwner && !state.labelled) return { holderMemberId: state.holderMemberId, event: "labelled" };
  // Replacing swaps the label on a copy that has one; it changes neither holder nor collection.
  if (action === "relabel" && isOwner && state.labelled) return { holderMemberId: state.holderMemberId, event: "relabelled" };
  return { rejected: "not-allowed" };
}

// A claim is the proof of having the book in hand, so it is offered only when the label was read to get here.
export function availableActions(state: CopyState, viewer: Member, opts: { labelInHand: boolean }): ActionType[] {
  return ACTIONS.filter((a) => (a !== "claim" || opts.labelInHand) && !("rejected" in decide(state, viewer, a)));
}
