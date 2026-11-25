// Empties every table in the test database, children before parents, so no foreign key is ever violated.
// The order comes from the schema, so a new table needs no change here.
export async function resetDatabase(db: D1Database): Promise<void> {
  const { results: tables } = await db
    .prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like 'd1_%' and name not like '_cf_%'",
    )
    .all<{ name: string }>();
  const names = tables.map((t) => t.name);

  const children = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));
  for (const child of names) {
    const { results: fks } = await db
      .prepare('select "table" as parent from pragma_foreign_key_list(?)')
      .bind(child)
      .all<{ parent: string }>();
    for (const { parent } of fks) if (parent !== child) children.get(parent)?.add(child);
  }

  // A table can be emptied once everything that references it has been.
  const order: string[] = [];
  const remaining = new Set(names);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((t) => [...children.get(t)!].every((c) => !remaining.has(c)));
    if (ready.length === 0) throw new Error(`foreign keys form a cycle among: ${[...remaining].join(", ")}`);
    for (const t of ready) {
      order.push(t);
      remaining.delete(t);
    }
  }

  if (order.length > 0) await db.batch(order.map((t) => db.prepare(`delete from "${t}"`)));
}
