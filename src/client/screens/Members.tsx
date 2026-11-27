import { useEffect, useId, useState } from "react";
import type { Member, Person } from "../../shared/types";
import { ApiError, listMembers, memberCollections } from "../api";
import { CoverWall } from "../wall/CoverWall";
import { loadShelves } from "../wall/load";
import { useWallPlace, wallKey } from "../wall/memory";
import { Avatar } from "./Avatar";
import { BackLink } from "./BackLink";
import { BookCount, Name, personLabel } from "./BookCard";
import { APP_NAME } from "../shell";
import { SignIn } from "./SignIn";
import { SomeFailed, Trouble } from "./Trouble";
import { useLoaded } from "./useLoaded";

const others = (people: Person[], selfId: string) => people.filter((p) => p.id !== selfId);

type Props = { member: Member | null; returnTo: string; id?: string };

// Keyed on the id so moving between members starts from nothing. The list and a friend's wall are separate
// components, so only the wall keeps a place (and takes over scroll restoration).
export function Members(props: Props) {
  return props.id === undefined
    ? <List member={props.member} returnTo={props.returnTo} />
    : <FriendWall key={props.id} id={props.id} member={props.member} returnTo={props.returnTo} />;
}

// Rows show at once; each count arrives on its own, and a read that fails leaves that row without one.
// People with no entry yet, or a failed read, are simply absent from the map.
export function FriendRows({ people, counts }: { people: Person[]; counts: Record<string, number> }) {
  return (
    <ul className="friend-list">
      {people.map((p) => <FriendRow key={p.id} person={p} count={counts[p.id]} />)}
    </ul>
  );
}

function FriendRow({ person, count }: { person: Person; count: number | undefined }) {
  const countId = useId();
  return (
    <li>
      <a className="friend-row" href={`/members/${encodeURIComponent(person.id)}`} aria-describedby={count === undefined ? undefined : countId}>
        <Avatar person={person} size={40} />
        <span className="friend-name">
          <span className="friend-name-text"><Name>{person.name}</Name></span>
          {person.removed && <>{" "}<span className="friend-name-note">(no longer a member)</span></>}
        </span>
        {count !== undefined && <span id={countId} aria-hidden="true"><BookCount n={count} /></span>}
      </a>
    </li>
  );
}

function List({ member, returnTo }: Omit<Props, "id">) {
  const { state, retry, lose } = useLoaded(async () => (await listMembers()).members, member !== null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const people = state.status === "ok" && member !== null ? others(state.data, member.id) : null;
  const key = people?.map((p) => p.id).join("\n");

  useEffect(() => {
    if (people === null) return;
    let live = true;
    setCounts({});
    for (const p of people) {
      memberCollections(p.id).then(
        ({ collections }) => { if (live) setCounts((c) => ({ ...c, [p.id]: collections.reduce((n, k) => n + k.count, 0) })); },
        (e: unknown) => { if (live && e instanceof ApiError && e.status === 401) lose(); },
      );
    }
    return () => { live = false; };
    // Reads start when the set of people changes, not on every render.
  }, [key]);

  return (
    <div className="shelf-page">
      <h1>{member === null || state.status === "lost" ? APP_NAME : "Friends"}</h1>
      {member === null || state.status === "lost" ? (
        <SignIn returnTo={returnTo} />
      ) : state.status === "gone" ? (
        <><p>That member isn't here.</p><BackLink /></>
      ) : state.status === "failed" ? (
        <Trouble onRetry={retry} />
      ) : people ? (
        people.length === 0 ? <p>No one else is here yet.</p> : <FriendRows people={people} counts={counts} />
      ) : null}
    </div>
  );
}

function FriendWall({ id, member, returnTo }: Props & { id: string }) {
  const { state, retry } = useLoaded(async () => {
    const { owner, collections } = await memberCollections(id);
    return { owner, collections, ...(await loadShelves(collections)) };
  }, member !== null);
  const ready = state.status === "ok";
  const [filter, setFilter] = useWallPlace(wallKey(), ready, ready ? state.data.collections.map((c) => c.id) : []);

  if (member === null || state.status === "lost" || state.status === "gone" || state.status === "failed") {
    return (
      <div className="shelf-page">
        <h1>{APP_NAME}</h1>
        {member === null || state.status === "lost" ? <SignIn returnTo={returnTo} />
          : state.status === "gone" ? <><p>That member isn't here.</p><BackLink /></>
          : <Trouble onRetry={retry} />}
      </div>
    );
  }
  const wall = ready ? state.data : null;
  const failed = wall?.failed ?? 0;
  return (
    <CoverWall
      kind="friend"
      title={wall ? personLabel(wall.owner) : APP_NAME}
      loading={!ready}
      items={wall?.items ?? []}
      collections={wall?.collections ?? []}
      incomplete={failed > 0}
      top={failed > 0 && <SomeFailed onRetry={retry} />}
      filter={filter}
      onFilter={setFilter}
      empty={failed > 0 ? null : <p>No books here yet.</p>}
    />
  );
}
