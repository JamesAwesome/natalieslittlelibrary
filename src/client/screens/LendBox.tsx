import { useEffect, useState } from "react";
import type { LendTo, Person } from "../../shared/types";
import { listMembers, listPeople } from "../api";
import { cleanName } from "../../shared/name";
import { Name } from "./BookCard";

type Choice = { key: string; label: string; tag: string; to: LendTo };
type Loaded = { members: Person[]; unlinked: { id: string; name: string }[]; linked: { name: string; member: Person }[] };

const fold = (s: string) => s.normalize("NFC").toLowerCase();
const keyOf = (name: string) => cleanName(name)?.key ?? name.trim().normalize("NFC").toLowerCase();

// Who a book can be lent to: the owner's own people, the other members, or any name typed.
export function LendBox({ ownerId, onLend, busy }: { ownerId: string; onLend: (to: LendTo) => void; busy: boolean }) {
  const [typed, setTyped] = useState("");
  const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([listPeople(), listMembers()]).then(
      ([p, m]) => {
        if (!live) return;
        setLoaded({
          members: m.members.filter((x) => x.id !== ownerId && !x.removed),
          unlinked: p.people.filter((x) => x.linked === null).map((x) => ({ id: x.id, name: x.name })),
          linked: p.people.flatMap((x) => (x.linked === null ? [] : [{ name: x.name, member: x.linked }])),
        });
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [ownerId]);

  const clean = cleanName(typed);
  const needle = typed.trim().normalize("NFC").toLowerCase();
  const choices: Choice[] = [];
  if (loaded && needle !== "") {
    for (const m of loaded.members) if (fold(m.name).includes(needle)) choices.push({ key: `m${m.id}`, label: m.name, tag: "member", to: { member: m.id } });
    for (const p of loaded.unlinked) if (fold(p.name).includes(needle)) choices.push({ key: `p${p.id}`, label: p.name, tag: "lent before", to: { person: p.id } });
    // A typed name the server would resolve to a linked member offers that member, if they can still be lent to.
    const link = loaded.linked.find((l) => keyOf(l.name) === clean?.key);
    if (link && !link.member.removed && link.member.id !== ownerId && !choices.some((c) => c.key === `m${link.member.id}`)) {
      choices.push({ key: `m${link.member.id}`, label: link.member.name, tag: "member", to: { member: link.member.id } });
    }
  }
  const tooLong = clean === null && Array.from(typed.trim()).length > 60;
  const taken =
    clean !== null &&
    ((loaded?.members.some((m) => keyOf(m.name) === clean.key) ?? false) ||
      (loaded?.unlinked.some((p) => keyOf(p.name) === clean.key) ?? false) ||
      (loaded?.linked.some((l) => keyOf(l.name) === clean.key) ?? false));

  return (
    <div className="lend-box">
      <label>
        Lend to
        <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} dir="auto" autoComplete="off" />
      </label>
      {failed && <p>Couldn't load your people, but you can still type a name.</p>}
      {tooLong && <p>Names are up to 60 characters.</p>}
      <ul>
        {choices.map((c) => (
          <li key={c.key}><button type="button" disabled={busy} onClick={() => onLend(c.to)}><Name>{c.label}</Name> <span className="tag">{c.tag}</span></button></li>
        ))}
        {clean !== null && !taken && (
          <li><button type="button" disabled={busy} onClick={() => onLend({ name: clean.name })}>Lend to &quot;{clean.name}&quot;</button></li>
        )}
      </ul>
    </div>
  );
}
