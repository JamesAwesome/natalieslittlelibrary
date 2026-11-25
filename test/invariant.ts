// The collections invariant, as three queries; one string per violating copy or member. Empty means it holds.
export async function invariantViolations(db: D1Database): Promise<string[]> {
  const [mismatch, wrongOwner, defaults] = await db.batch<{ id: string; n?: number }>([
    db.prepare(
      "select id from copies where (owner_id is null) <> (collection_id is null)",
    ),
    db.prepare(
      `select c.id from copies c join collections k on k.id = c.collection_id where k.owner_id <> c.owner_id`,
    ),
    db.prepare(
      `select m.id, (select count(*) from collections k where k.owner_id = m.id and k.is_default = 1) as n
       from members m
       where exists (select 1 from copies c where c.owner_id = m.id)
         and (select count(*) from collections k where k.owner_id = m.id and k.is_default = 1) <> 1`,
    ),
  ]);
  return [
    ...mismatch.results.map((r) => `copy ${r.id}: owner and collection are not both null or both set`),
    ...wrongOwner.results.map((r) => `copy ${r.id}: its collection belongs to someone else`),
    ...defaults.results.map((r) => `member ${r.id}: owns a copy and has ${r.n} default collections`),
  ];
}
