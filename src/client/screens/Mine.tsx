import { useEffect, useId, useRef, useState } from "react";
import type { CollectionSummary, Member, ShelfItem } from "../../shared/types";
import { cleanCollectionName } from "../../shared/collectionName";
import { ApiError, approveRequest, createCollection, declineRequest, listRequests, myCollections } from "../api";
import { CoverWall } from "../wall/CoverWall";
import { loadShelves } from "../wall/load";
import { useWallPlace, wallKey } from "../wall/memory";
import { Name, personLabel } from "./BookCard";
import { APP_NAME } from "../shell";
import { SignIn } from "./SignIn";
import { SomeFailed, Trouble } from "./Trouble";
import { useGuard } from "./useGuard";
import { useLoaded } from "./useLoaded";

type Wall = { collections: CollectionSummary[]; items: ShelfItem[]; failed: number };

async function loadWall(): Promise<Wall> {
  const { collections } = await myCollections();
  return { collections, ...(await loadShelves(collections)) };
}

export function Mine({ member, returnTo }: { member: Member | null; returnTo: string }) {
  const { state, reload, lose, retry } = useLoaded(loadWall, member !== null);
  // Requests are their own read: if it fails the bar says so and the shelves stay.
  const requests = useLoaded(async () => (await listRequests()).requests, member !== null);
  // The covers wait for both reads. The requests bar sits above them, so arriving later it would push down a
  // wall whose scroll place had just been restored; nothing above the grid may change height after `ready`.
  const ready = state.status === "ok" && requests.state.status !== "loading";
  const [filter, setFilter] = useWallPlace(wallKey(), ready, state.status === "ok" ? state.data.collections.map((c) => c.id) : []);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const { busy, guard, live } = useGuard();
  // Each "New collection…" from the menu bumps this: the form shows, and the cursor goes to its name.
  const [createAsked, setCreateAsked] = useState(0);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (createAsked > 0) nameInput.current?.focus();
  }, [createAsked]);
  const [showRequests, setShowRequests] = useState(false);
  const requestsId = useId();

  function create(e: React.FormEvent) {
    e.preventDefault();
    void guard(async () => {
      setError(undefined);
      const clean = cleanCollectionName(name);
      if (clean === null) {
        setError("A collection name is 1 to 60 characters, with no control characters.");
        return;
      }
      try {
        await createCollection(clean.name);
        if (live.current) setName("");
      } catch (err) {
        if (!live.current) return;
        if (err instanceof ApiError && err.status === 401) {
          lose();
          return;
        }
        setError(err instanceof ApiError && err.rejected === "name-taken"
          ? "You already have a collection called that."
          : "Something went wrong. Try again.");
      }
      await reload();
    });
  }

  const [answerError, setAnswerError] = useState<string | undefined>(undefined);
  const [answered, setAnswered] = useState(false);
  // The request whose Approve is waiting for its confirmation.
  const [confirming, setConfirming] = useState<string | null>(null);
  // A 401 on the requests re-read means signed out: the whole screen goes to sign-in.
  useEffect(() => {
    if (requests.state.status === "lost") lose();
  }, [requests.state.status, lose]);

  function answer(copyId: string, send: (id: string) => Promise<unknown>, approving: boolean) {
    void guard(async () => {
      setAnswerError(undefined);
      setAnswered(true);
      setConfirming(null);
      try {
        await send(copyId);
      } catch (e) {
        if (!live.current) return;
        if (e instanceof ApiError && e.status === 401) {
          lose();
          return;
        }
        setAnswerError(e instanceof ApiError && e.rejected === "not-allowed"
          ? "That request was already answered or withdrawn."
          : "Something went wrong. Try again.");
        await requests.reload();
        return;
      }
      await Promise.all([requests.reload(), approving ? reload() : Promise.resolve()]);
    });
  }

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
        <h1>My books</h1>
        <Trouble onRetry={retry} />
      </div>
    );
  }

  const wall = state.status === "ok" ? state.data : null;
  const asks = requests.state.status === "ok" ? requests.state.data : [];
  const top = ready && wall && (
    <>
      {(answerError !== undefined || (answered && requests.state.status === "failed")) && (
        <p role="alert" className="refusal">{answerError ?? "Something went wrong. Try again."}</p>
      )}
      {wall.failed > 0 && <SomeFailed onRetry={retry} />}
      {(requests.state.status === "failed" || requests.state.status === "gone") && !answered && <p>Couldn't load requests.</p>}
      {asks.length > 0 && (
        <>
          <button type="button" className="wall-requests-bar" aria-expanded={showRequests}
            aria-controls={showRequests ? requestsId : undefined} onClick={() => setShowRequests((s) => !s)}>
            {asks.length === 1 ? "1 request" : `${asks.length} requests`}
            <svg className="chip-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
          </button>
          {showRequests && (
            <ul id={requestsId} className="plain-list wall-requests">
              {asks.map((r) => (
                <li key={r.copyId}>
                  <a href={`/copies/${encodeURIComponent(r.copyId)}`}><Name>{r.book.title}</Name></a>
                  {confirming === r.copyId ? (
                    <>
                      <p>Let <Name>{personLabel(r.by)}</Name> keep <Name>{r.book.title}</Name>?</p>
                      <button type="button" disabled={busy} onClick={() => answer(r.copyId, approveRequest, true)}>Approve</button>{" "}
                      <button type="button" onClick={() => setConfirming(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <p><Name>{personLabel(r.by)}</Name> asked to keep this</p>
                      <button type="button" disabled={busy} onClick={() => setConfirming(r.copyId)}>Approve</button>{" "}
                      <button type="button" disabled={busy} onClick={() => answer(r.copyId, declineRequest, false)}>Decline</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {createAsked > 0 && (
        <form className="new-collection" onSubmit={create}>
          <h2>New collection</h2>
          {error !== undefined && <p role="alert" className="refusal">{error}</p>}
          <label>
            Name
            <input ref={nameInput} type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>Create</button>
        </form>
      )}
    </>
  );

  return (
    <CoverWall
      kind="mine"
      title="My books"
      loading={!ready}
      items={wall?.items ?? []}
      collections={wall?.collections ?? []}
      incomplete={(wall?.failed ?? 0) > 0}
      top={top}
      onNewCollection={() => setCreateAsked((n) => n + 1)}
      filter={filter}
      onFilter={setFilter}
      // With a shelf missing, an empty wall doesn't mean no books: the alert above says what happened.
      empty={wall && wall.failed > 0 ? null : (
        <>
          <p>You haven’t added any books yet.</p>
          <ul className="plain-list">
            <li><a href="/pair">Pair a book</a></li>
            <li><a href="/import">Import from StoryGraph</a></li>
            <li><a href="/members">Friends</a></li>
            <li><a href="/holding">Holding</a></li>
          </ul>
        </>
      )}
    />
  );
}
