import type { CollectionSummary, Member, Person } from "../../shared/types";
import { listMembers, memberCollections } from "../api";
import { BackLink } from "./BackLink";
import { Name } from "./BookCard";
import { BookCount } from "./ShelfList";
import { APP_NAME } from "../shell";
import { SignIn } from "./SignIn";
import { Trouble } from "./Trouble";
import { useLoaded } from "./useLoaded";

const others = (people: Person[], selfId: string) => people.filter((p) => p.id !== selfId);

type Props = { member: Member | null; returnTo: string; id?: string };

// Keyed on the id so moving between members starts from nothing.
export function Members(props: Props) {
  return <Page key={props.id ?? ""} {...props} />;
}

function Page({ member, returnTo, id }: Props) {
  const { state, retry } = useLoaded<{ owner: Person | null; people: Person[]; collections: CollectionSummary[] }>(
    async () => {
      if (id === undefined) return { owner: null, people: (await listMembers()).members, collections: [] };
      const r = await memberCollections(id);
      return { owner: r.owner, people: [], collections: r.collections };
    },
    member !== null,
  );
  return (
    <div className="shelf-page">
      <h1>
        {member === null || state.status === "lost" ? APP_NAME
          : state.status === "ok" && state.data.owner !== null ? <Name>{state.data.owner.name}</Name>
          : id === undefined ? "Friends"
          : APP_NAME}
      </h1>
      {member === null || state.status === "lost" ? (
        <SignIn returnTo={returnTo} />
      ) : state.status === "gone" ? (
        <><p>That member isn't here.</p><BackLink /></>
      ) : state.status === "failed" ? (
        <Trouble onRetry={retry} />
      ) : state.status === "ok" ? (
        state.data.owner === null ? (
          <>
            {others(state.data.people, member.id).length === 0 ? (
              <p>No one else is here yet.</p>
            ) : (
              <ul className="plain-list">
                {others(state.data.people, member.id).map((p) => (
                  <li key={p.id}><a href={`/members/${encodeURIComponent(p.id)}`}><Name>{p.name}</Name></a></li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {state.data.collections.length === 0 ? (
              <p>No collections yet.</p>
            ) : (
              <ul className="plain-list">
                {state.data.collections.map((c) => (
                  <li key={c.id}>
                    <a href={`/collections/${encodeURIComponent(c.id)}`}><Name>{c.name}</Name></a>{" "}
                    <BookCount n={c.count} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      ) : null}
    </div>
  );
}

