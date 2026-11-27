import type { Member } from "../../shared/types";
import { getHolding } from "../api";
import { CoverWall } from "../wall/CoverWall";
import { useWallPlace, wallKey } from "../wall/memory";
import { APP_NAME } from "../shell";
import { SignIn } from "./SignIn";
import { Trouble } from "./Trouble";
import { useLoaded } from "./useLoaded";

export function Holding({ member, returnTo }: { member: Member | null; returnTo: string }) {
  const { state, retry } = useLoaded(async () => (await getHolding()).items, member !== null);
  const ready = state.status === "ok";
  const [filter, setFilter] = useWallPlace(wallKey(), ready, []);
  if (member === null || state.status === "lost") {
    return (
      <div className="shelf-page">
        <h1>{APP_NAME}</h1>
        <SignIn returnTo={returnTo} />
      </div>
    );
  }
  if (state.status === "failed" || state.status === "gone") {
    return (
      <div className="shelf-page">
        <h1>Holding</h1>
        <Trouble onRetry={retry} />
      </div>
    );
  }
  return (
    <CoverWall
      kind="holding"
      title="Holding"
      loading={!ready}
      items={ready ? state.data : []}
      filter={filter}
      onFilter={setFilter}
      empty={<p>You aren’t holding anyone’s books.</p>}
    />
  );
}
