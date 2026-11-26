import { parseLabelLink } from "../../shared/labelCode";
import type { CopyView, Member, Rejection } from "../../shared/types";
import { ACTIVE } from "./collections";
import { decide } from "./rules";
import { BLANK } from "./unlabelled";

export function createRelabel(
  db: D1Database,
  now: () => number,
  // The copy as the owner sees it with the new label in hand.
  render: (copyId: string, viewer: Member, code: string) => Promise<CopyView | null>,
) {
  // Retires the copy's label and binds a blank one in its place. The batch carries the whole state the decision was made
  // against, so a stale, raced or repeated replace matches none of its statements and writes nothing.
  async function replaceLabel(owner: Member, copyId: string, input: { code: string; replacing: string }): Promise<CopyView | Rejection> {
    if (typeof copyId !== "string" || typeof input !== "object" || input === null) return { rejected: "invalid" };
    const { code: rawCode, replacing: rawReplacing } = input as { code: unknown; replacing: unknown };
    if (typeof rawCode !== "string" || typeof rawReplacing !== "string") return { rejected: "invalid" };

    const code = parseLabelLink(rawCode);
    if (code === null) return { rejected: "label-unknown" };
    const label = await db.prepare("select copy_id from labels where code = ?").bind(code).first<{ copy_id: string | null }>();
    if (!label) return { rejected: "label-unknown" };
    // A retired label keeps its copy, so it is in use too.
    if (label.copy_id !== null) return { rejected: "label-in-use" };

    const copy = await db
      .prepare(
        `select owner_id, holder_member_id, holder_person_id, requested_by,
           coalesce((select removed_at is not null from members where id = copies.owner_id), 0) as owner_removed,
           coalesce((select removed_at is not null from members where id = copies.requested_by), 0) as requester_removed,
           (select code from labels where copy_id = copies.id and retired_at is null) as code
         from copies where id = ?`,
      )
      .bind(copyId)
      .first<{
        owner_id: string | null;
        holder_member_id: string | null;
        holder_person_id: string | null;
        requested_by: string | null;
        owner_removed: number;
        requester_removed: number;
        code: string | null;
      }>();
    if (!copy) return { rejected: "not-found" };
    const decision = decide(
      {
        ownerId: copy.owner_id,
        ownerRemoved: copy.owner_removed === 1,
        holderMemberId: copy.holder_member_id,
        holderPersonId: copy.holder_person_id,
        requestedBy: copy.requested_by,
        requesterRemoved: copy.requester_removed === 1,
        labelled: copy.code !== null,
      },
      owner,
      { type: "relabel" },
    );
    if ("rejected" in decision) return decision;
    const replacing = parseLabelLink(rawReplacing);
    if (replacing === null || replacing !== copy.code) return { rejected: "not-allowed" };

    // G, the whole pre-state: the old label live on this copy, the new one blank, the copy the actor's, the actor active.
    const oldLive = "exists (select 1 from labels where code = ? and copy_id = ? and retired_at is null)";
    const rest = `exists ${BLANK} and exists (select 1 from copies where id = ? and owner_id = ?) and ${ACTIVE}`;
    const restBinds = [code, copyId, owner.id, owner.id];
    const at = now();
    const results = await db.batch([
      db
        .prepare(`insert into events (copy_id, at, actor_id, type) select ?, ?, ?, 'relabelled' where ${oldLive} and ${rest}`)
        .bind(copyId, at, owner.id, replacing, copyId, ...restBinds),
      // Retire before binding, so the copy never has two live labels, even inside the batch.
      db
        .prepare(`update labels set retired_at = ? where code = ? and copy_id = ? and retired_at is null and ${rest}`)
        .bind(at, replacing, copyId, ...restBinds),
      // Binds only right after this batch's retire: the copy has no live label, and the old one is retired. Not compared
      // with `at`, which two batches can share.
      db
        .prepare(
          `update labels set copy_id = ?, bound_at = ? where code = ? and copy_id is null
             and not exists (select 1 from labels where copy_id = ? and retired_at is null)
             and exists (select 1 from labels where code = ? and copy_id = ? and retired_at is not null)`,
        )
        .bind(copyId, at, code, copyId, replacing, copyId),
    ]);
    // The bind is last; its change count says whether the batch applied.
    if (results[2].meta.changes === 0) {
      const fresh = await db.prepare("select copy_id from labels where code = ?").bind(code).first<{ copy_id: string | null }>();
      return fresh?.copy_id != null ? { rejected: "label-in-use" } : { rejected: "not-allowed" };
    }
    const v = await render(copyId, owner, code);
    if (v === null) throw new Error("a copy just relabelled has vanished");
    return v;
  }

  return { replaceLabel };
}
