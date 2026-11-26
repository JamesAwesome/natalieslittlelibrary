import { useEffect, useState } from "react";
import type { CollectionSummary, Member, Shelf } from "../../shared/types";
import { cleanCollectionName } from "../../shared/collectionName";
import { ApiError, approveRequest, createCollection, declineRequest, getShelf, listRequests, myCollections } from "../api";
import { Name, personLabel } from "./BookCard";
import { BookCount, ShelfList } from "./ShelfList";
import { SignIn } from "./SignIn";
import { Trouble } from "./Trouble";
import { useGuard } from "./useGuard";
import { useLoaded } from "./useLoaded";

// shelf is null when that one read failed: its group shows trouble and the others stay.
type Group = { collection: CollectionSummary; shelf: Shelf | null };

async function loadGroups(): Promise<Group[]> {
  const { collections } = await myCollections();
  const shelves = await Promise.all(
    collections.map(async (collection) => {
      try {
        return { collection, shelf: await getShelf(collection.id) };
      } catch (e) {
        // Deleted between the two reads: it is simply not there any more.
        if (e instanceof ApiError && e.status === 404) return null;
        if (e instanceof ApiError && e.status === 401) throw e;
        return { collection, shelf: null };
      }
    }),
  );
  return shelves.filter((g) => g !== null);
}

export function Mine({ member, returnTo }: { member: Member | null; returnTo: string }) {
  const { state, reload, lose, retry } = useLoaded(loadGroups, member !== null);
  // Requests are their own read: if it fails the section says so and the shelves stay.
  const requests = useLoaded(async () => (await listRequests()).requests, member !== null);
  const [onlyUnlabelled, setOnlyUnlabelled] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const { busy, guard, live } = useGuard();

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

  return (
    <div className="shelf-page">
      <h1>Natalie's Little Library</h1>
      {member === null || state.status === "lost" ? (
        <SignIn returnTo={returnTo} />
      ) : state.status === "failed" || state.status === "gone" ? (
        <Trouble onRetry={retry} />
      ) : state.status === "ok" ? (
        <>
          {(answerError !== undefined || (answered && requests.state.status === "failed")) && (
            <p role="alert" className="refusal">{answerError ?? "Something went wrong. Try again."}</p>
          )}
          {(requests.state.status === "failed" || requests.state.status === "gone") && !answered && <p>Couldn't load requests.</p>}
          {requests.state.status === "ok" && requests.state.data.length > 0 && (
            <section className="requests">
              <h2>Requests</h2>
              <ul className="plain-list">
                {requests.state.data.map((r) => (
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
            </section>
          )}
          <h2>My books</h2>
          {state.data.length === 0 ? (
            <p>
              No books yet. <a href="/pair">Pair a book</a> or <a href="/import">import from StoryGraph</a>.
            </p>
          ) : (
            <>
              <label className="toggle">
                <input type="checkbox" checked={onlyUnlabelled} onChange={(e) => setOnlyUnlabelled(e.target.checked)} />
                Show only books without a label
              </label>
              {state.data.map(({ collection: listed, shelf }) => {
                if (shelf === null) {
                  return (
                    <section key={listed.id} className="group">
                      <h3><Name>{listed.name}</Name></h3>
                      <Trouble onRetry={retry} />
                    </section>
                  );
                }
                // The heading and count come from the same read as the rows, so they always agree.
                const collection = shelf.collection;
                const items = onlyUnlabelled ? shelf.items.filter((i) => !i.labelled) : shelf.items;
                return (
                  <section key={collection.id} className="group">
                    <h3><a href={`/collections/${encodeURIComponent(collection.id)}`}><Name>{collection.name}</Name></a></h3>
                    <p>
                      <BookCount n={collection.count} />
                      {collection.unlabelled > 0 && <> &middot; <span className="count">{collection.unlabelled} without a label</span></>}
                    </p>
                    <ShelfList items={items} viewerId={member.id} />
                  </section>
                );
              })}
            </>
          )}
          <form className="new-collection" onSubmit={create}>
            <h3>New collection</h3>
            {error !== undefined && <p role="alert" className="refusal">{error}</p>}
            <label>
              Name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" disabled={busy}>Create</button>
          </form>
        </>
      ) : null}
    </div>
  );
}
