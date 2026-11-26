import type { ActionType, Member, Rejection } from "../../shared/types";

// `labelled`: the copy has a label bound to it. `ownerRemoved` and `requesterRemoved` come from the same read as the row.
export type CopyState = {
  ownerId: string | null;
  ownerRemoved: boolean;
  holderMemberId: string | null;
  holderPersonId: string | null;
  requestedBy: string | null;
  requesterRemoved: boolean;
  labelled: boolean;
};
export type Target = { member: string } | { person: string };
export type Action =
  | { type: "claim" | "return" | "move" | "label" | "relabel" | "request" | "withdraw" | "approve" | "decline" | "release" | "adopt" }
  | { type: "lend"; to: Target }
  | { type: "give"; to: string };
export type EventType =
  | "claimed" | "returned" | "labelled" | "relabelled" | "lent" | "given"
  | "requested" | "withdrawn" | "approved" | "declined" | "released" | "adopted";
// The copy's whole next state. `ownerChanged`: ownership moved, to a member (give, approve, adopt) or to nobody (release);
// the write sets the collection from the new owner, null for none.
export type Change = {
  ownerId: string | null;
  holderMemberId: string | null;
  holderPersonId: string | null;
  requestedBy: string | null;
  event: EventType | null;
  subject: Target | null;
  ownerChanged: boolean;
};

const ACTIONS: ActionType[] = [
  "claim", "return", "move", "label", "relabel", "lend", "give", "request", "withdraw", "approve", "decline", "release", "adopt",
];

const requestOpen = (s: CopyState): boolean => s.requestedBy !== null && !s.requesterRemoved;
const takeable = (s: CopyState): boolean => s.ownerId === null || s.ownerRemoved;

// Who may do what, and when; the target of a lend or give is checked by decide.
function allows(s: CopyState, viewer: Member, type: ActionType): boolean {
  const isOwner = s.ownerId !== null && s.ownerId === viewer.id;
  const isHolder = s.holderMemberId === viewer.id;
  switch (type) {
    case "claim": return s.ownerId !== null && !s.ownerRemoved && !isOwner && !isHolder;
    case "return": return isOwner && !isHolder;
    case "move": case "lend": case "give": return isOwner;
    case "label": return isOwner && !s.labelled;
    case "relabel": case "release": return isOwner && s.labelled;
    case "request": return isHolder && !isOwner && s.ownerId !== null && !s.ownerRemoved && !requestOpen(s);
    case "withdraw": return requestOpen(s) && s.requestedBy === viewer.id;
    case "approve": case "decline": return isOwner && requestOpen(s);
    case "adopt": return takeable(s);
  }
}

// The one place that says who may do what. Both the write and the list of buttons come from here.
export function decide(state: CopyState, viewer: Member, action: Action): Change | Rejection {
  if (!allows(state, viewer, action.type)) return { rejected: "not-allowed" };
  const keep = {
    ownerId: state.ownerId,
    holderMemberId: state.holderMemberId,
    holderPersonId: state.holderPersonId,
    requestedBy: state.requestedBy,
    event: null,
    subject: null,
    ownerChanged: false,
  } satisfies Change;
  // A change of owner or either holder clears the open request; a removed asker's stale request is cleared by any write.
  const next = (c: Partial<Change>): Change => {
    const n = { ...keep, ...c };
    const moved = n.ownerId !== state.ownerId || n.holderMemberId !== state.holderMemberId || n.holderPersonId !== state.holderPersonId;
    // A request the action itself sets (a new one over a stale one) stands.
    return (moved || state.requesterRemoved) && !("requestedBy" in c) ? { ...n, requestedBy: null } : n;
  };
  const asker = state.requestedBy;
  switch (action.type) {
    case "claim": return next({ holderMemberId: viewer.id, holderPersonId: null, event: "claimed" });
    case "return": return next({ holderMemberId: viewer.id, holderPersonId: null, event: "returned" });
    // Moving between one's own collections changes neither holder nor history.
    case "move": return next({});
    case "label": return next({ event: "labelled" });
    // Replacing swaps the label on a copy that has one; it changes neither holder nor collection.
    case "relabel": return next({ event: "relabelled" });
    case "lend": {
      const to = action.to;
      if ("member" in to) {
        if (to.member === state.ownerId || to.member === state.holderMemberId) return { rejected: "not-allowed" };
        return next({ holderMemberId: to.member, holderPersonId: null, event: "lent", subject: to });
      }
      if (to.person === state.holderPersonId) return { rejected: "not-allowed" };
      return next({ holderMemberId: null, holderPersonId: to.person, event: "lent", subject: to });
    }
    case "give": {
      if (action.to === state.ownerId) return { rejected: "not-allowed" };
      const home = state.holderMemberId === state.ownerId;
      return next({
        ownerId: action.to,
        ...(home ? { holderMemberId: action.to, holderPersonId: null } : {}),
        event: "given",
        subject: { member: action.to },
        ownerChanged: true,
      });
    }
    case "request": return next({ requestedBy: viewer.id, event: "requested" });
    case "withdraw": return next({ requestedBy: null, event: "withdrawn" });
    // allows() has checked that a request is open, so `asker` is set.
    case "approve": return next({ ownerId: asker, requestedBy: null, event: "approved", subject: { member: asker! }, ownerChanged: true });
    case "decline": return next({ requestedBy: null, event: "declined", subject: { member: asker! } });
    case "release": return next({ ownerId: null, event: "released", ownerChanged: true });
    case "adopt": return next({ ownerId: viewer.id, holderMemberId: viewer.id, holderPersonId: null, event: "adopted", ownerChanged: true });
  }
}

// Claim and adopt are the proof of having the book in hand, so they are offered only when the label was read to get here.
export function availableActions(state: CopyState, viewer: Member, opts: { labelInHand: boolean }): ActionType[] {
  return ACTIONS.filter((a) => ((a !== "claim" && a !== "adopt") || opts.labelInHand) && allows(state, viewer, a));
}
