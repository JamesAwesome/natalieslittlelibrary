import type { Member } from "../../shared/types";
import { getHolding } from "../api";
import { ShelfList } from "./ShelfList";
import { SignIn } from "./SignIn";
import { Trouble } from "./Trouble";
import { useLoaded } from "./useLoaded";

export function Holding({ member, returnTo }: { member: Member | null; returnTo: string }) {
  const { state, retry } = useLoaded(async () => (await getHolding()).items, member !== null);
  return (
    <div className="shelf-page">
      <h1>Natalie's Little Library</h1>
      {member === null || state.status === "lost" ? (
        <SignIn returnTo={returnTo} />
      ) : state.status === "failed" ? (
        <Trouble onRetry={retry} />
      ) : state.status === "ok" ? (
        <>
          <h2>What I'm holding</h2>
          {state.data.length === 0 ? <p>You're not holding anyone else's books.</p> : <ShelfList items={state.data} viewerId={member.id} showOwner />}
        </>
      ) : null}
    </div>
  );
}
