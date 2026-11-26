import type { Member, Rejection, SheetSummary } from "../../shared/types";

// Labels minted before sheet ids existed are grouped by member and the second they were minted.
export const SHEET_KEY = "coalesce(l.sheet_id, 'old-' || l.minted_by || '-' || (l.minted_at / 1000))";

const MAX_SHEET_ID = 200;

export function createSheetReads(db: D1Database, siteUrl: string) {
  async function sheets(member: Member): Promise<SheetSummary[]> {
    const { results } = await db
      .prepare(
        `select ${SHEET_KEY} as sheet_key, min(l.minted_at) as at, count(*) as total,
           sum(l.copy_id is null) as blank,
           sum(l.copy_id is not null and l.retired_at is null and c.owner_id = ?1) as mine
         from labels l left join copies c on c.id = l.copy_id
         where l.minted_by = ?1
         group by sheet_key order by at desc, max(l.rowid) desc`,
      )
      .bind(member.id)
      .all<Omit<SheetSummary, "id"> & { sheet_key: string }>();
    return results.map(({ sheet_key, ...rest }) => ({ id: sheet_key, ...rest }));
  }

  async function sheetCodes(
    member: Member,
    sheetId: string,
    opts: { includeMine: boolean },
  ): Promise<{ code: string; url: string }[] | Rejection> {
    if (typeof sheetId !== "string" || sheetId.length > MAX_SHEET_ID) return { rejected: "not-found" };
    const { results } = await db
      .prepare(
        `select l.code as code, l.copy_id is null as blank,
           (l.copy_id is not null and l.retired_at is null and c.owner_id = ?1) as mine
         from labels l left join copies c on c.id = l.copy_id
         where l.minted_by = ?1 and ${SHEET_KEY} = ?2
         order by l.rowid`,
      )
      .bind(member.id, sheetId)
      .all<{ code: string; blank: number; mine: number }>();
    if (results.length === 0) return { rejected: "not-found" };
    return results
      .filter((r) => r.blank === 1 || (opts.includeMine && r.mine === 1))
      .map((r) => ({ code: r.code, url: new URL("/b/" + r.code, siteUrl).toString() }));
  }

  return { sheets, sheetCodes };
}
