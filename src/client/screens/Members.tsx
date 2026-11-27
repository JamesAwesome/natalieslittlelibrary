import type { Member, Person } from "../../shared/types";
import { listMembers, memberCollections } from "../api";
import { CoverWall } from "../wall/CoverWall";
import { loadShelves } from "../wall/load";
import { useWallPlace, wallKey } from "../wall/memory";
import { BackLink } from "./BackLink";
import { Name, personLabel } from "./BookCard";
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

function List({ member, returnTo }: Omit<Props, "id">) {
  const { state, retry } = useLoaded(async () => (await listMembers()).members, member !== null);
  return (
    <div className="shelf-page">
      <h1>{member === null || state.status === "lost" ? APP_NAME : "Friends"}</h1>
      {member === null || state.status === "lost" ? (
        <SignIn returnTo={returnTo} />
      ) : state.status === "gone" ? (
        <><p>That member isn't here.</p><BackLink /></>
      ) : state.status === "failed" ? (
        <Trouble onRetry={retry} />
      ) : state.status === "ok" ? (
        others(state.data, member.id).length === 0 ? (
          <p>No one else is here yet.</p>
        ) : (
          <ul className="plain-list">
            {others(state.data, member.id).map((p) => (
              <li key={p.id}><a href={`/members/${encodeURIComponent(p.id)}`}><Name>{p.name}</Name></a></li>
            ))}
          </ul>
        )
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
