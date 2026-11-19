import type { ActionType, Member } from "../../shared/types";

export type CopyState = { ownerId: string | null; holderMemberId: string | null };

export function availableActions(state: CopyState, viewer: Member): ActionType[] {
  const isOwner = state.ownerId === viewer.id;
  if (isOwner && state.holderMemberId !== viewer.id) return ["return"];
  if (state.ownerId !== null && !isOwner && state.holderMemberId !== viewer.id) return ["claim"];
  return [];
}
