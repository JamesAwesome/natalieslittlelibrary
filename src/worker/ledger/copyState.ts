import type { CopyState } from "./rules";

// 1 when the member is removed, else 0 (none counts as not removed).
const removed = (memberColumn: string): string =>
  `coalesce((select removed_at is not null from members where id = ${memberColumn}), 0)`;

// The columns the rules need of a copy, read in the same statement as the copy row. `copy` is the copies table's alias.
export const stateColumns = (copy: string): string =>
  `${copy}.owner_id, ${copy}.holder_member_id, ${copy}.holder_person_id, ${copy}.requested_by,
    ${removed(`${copy}.owner_id`)} as owner_removed,
    ${removed(`${copy}.requested_by`)} as requester_removed`;

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

// A where-fragment true only while every column of `row` still reads as it did, so a write decided against
// `stateOf(row, …)` touches nothing if any of it changed since. (`labelled` needs no guard: a copy never loses its label.)
export function stateGuard(copy: string, row: StateColumns): { sql: string; binds: unknown[] } {
  return {
    sql: `${copy}.owner_id is ? and ${copy}.holder_member_id is ? and ${copy}.holder_person_id is ? and ${copy}.requested_by is ?
      and ${removed(`${copy}.owner_id`)} = ? and ${removed(`${copy}.requested_by`)} = ?`,
    binds: [row.owner_id, row.holder_member_id, row.holder_person_id, row.requested_by, row.owner_removed, row.requester_removed],
  };
}
