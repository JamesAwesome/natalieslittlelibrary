import { useState } from "react";
import type { CollectionSummary, Member, Shelf } from "../../shared/types";
import { cleanCollectionName } from "../../shared/collectionName";
import { ApiError, createCollection, getShelf, myCollections } from "../api";
import { Name } from "./BookCard";
import { BookCount, ShelfList } from "./ShelfList";
import { SignIn } from "./SignIn";
import { Trouble } from "./Trouble";
import { useGuard } from "./useGuard";
import { useLoaded } from "./useLoaded";

type Group = { collection: CollectionSummary; shelf: Shelf };

async function loadGroups(): Promise<Group[]> {
  const { collections } = await myCollections();
  const shelves = await Promise.all(
    collections.map(async (collection) => {
      try {
        return { collection, shelf: await getShelf(collection.id) };
      } catch (e) {
        // Deleted between the two reads: it is simply not there any more.
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    }),
  );
  return shelves.filter((g): g is Group => g !== null);
}

export function Mine({ member, returnTo }: { member: Member | null; returnTo: string }) {
  const { state, reload, lose, retry } = useLoaded(loadGroups, member !== null);
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

  return (
    <div className="shelf-page">
      <h1>Natalie's Little Library</h1>
      {member === null || state.status === "lost" ? (
        <SignIn returnTo={returnTo} />
      ) : state.status === "failed" ? (
        <Trouble onRetry={retry} />
      ) : state.status === "ok" || state.status === "gone" ? (
        <>
          <h2>My books</h2>
          {state.status === "gone" || state.data.length === 0 ? (
            <p>
              No books yet. <a href="/pair">Pair a book</a> or <a href="/import">import from StoryGraph</a>.
            </p>
          ) : (
            <>
              <label className="toggle">
                <input type="checkbox" checked={onlyUnlabelled} onChange={(e) => setOnlyUnlabelled(e.target.checked)} />
                Show only books without a label
              </label>
              {state.data.map(({ collection, shelf }) => {
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
