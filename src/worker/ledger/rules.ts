import type { ActionType, Member, Rejection } from "../../shared/types";

export type CopyState = { ownerId: string | null; holderMemberId: string | null };

const ACTIONS: ActionType[] = ["claim", "return"];

// The one place that says who may do what. Both the write and the list of buttons come from here.
export function decide(
  state: CopyState,
  viewer: Member,
  action: ActionType,
): { holderMemberId: string; event: "claimed" | "returned" } | Rejection {
  const isOwner = state.ownerId === viewer.id;
  const isHolder = state.holderMemberId === viewer.id;
  if (action === "claim" && state.ownerId !== null && !isOwner && !isHolder) {
    return { holderMemberId: viewer.id, event: "claimed" };
  }
  if (action === "return" && isOwner && !isHolder) return { holderMemberId: viewer.id, event: "returned" };
  return { rejected: "not-allowed" };
}

export function availableActions(state: CopyState, viewer: Member): ActionType[] {
  return ACTIONS.filter((a) => !("rejected" in decide(state, viewer, a)));
}
