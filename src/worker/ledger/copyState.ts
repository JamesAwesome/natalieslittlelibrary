import type { CopyState } from "./rules";

// The columns the rules need of a copy, read in the same statement as the copy row. `copy` is the copies table's alias.
export const stateColumns = (copy: string): string =>
  `${copy}.owner_id, ${copy}.holder_member_id, ${copy}.holder_person_id, ${copy}.requested_by,
    coalesce((select removed_at is not null from members where id = ${copy}.owner_id), 0) as owner_removed,
    coalesce((select removed_at is not null from members where id = ${copy}.requested_by), 0) as requester_removed`;

export type StateColumns = {
  owner_id: string | null;
  holder_member_id: string | null;
  holder_person_id: string | null;
  requested_by: string | null;
  owner_removed: number;
  requester_removed: number;
};

export function stateOf(row: StateColumns, labelled: boolean): CopyState {
  return {
    ownerId: row.owner_id,
    ownerRemoved: row.owner_removed === 1,
    holderMemberId: row.holder_member_id,
    holderPersonId: row.holder_person_id,
    requestedBy: row.requested_by,
    requesterRemoved: row.requester_removed === 1,
    labelled,
  };
}
