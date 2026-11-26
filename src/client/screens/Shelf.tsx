import { useEffect, useRef, useState } from "react";
import type { Member, Shelf as ShelfData } from "../../shared/types";
import { cleanCollectionName } from "../../shared/collectionName";
import { ApiError, deleteCollection, getShelf, makeDefault, renameCollection } from "../api";
import { BackLink } from "./BackLink";
import { Name } from "./BookCard";
import { BookCount, ShelfList } from "./ShelfList";
import { SignIn } from "./SignIn";
import { Trouble } from "./Trouble";
import { useGuard } from "./useGuard";
import { useLoaded } from "./useLoaded";

type Props = { id: string; member: Member | null; returnTo: string };

// Keyed on the id so moving between shelves starts from nothing.
export function Shelf(props: Props) {
  return <Page key={props.id} {...props} />;
}

function Page({ id, member, returnTo }: Props) {
  const { state, reload, lose, retry } = useLoaded<ShelfData>(() => getShelf(id), member !== null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const { busy, guard, live } = useGuard();
  const heading = useRef<HTMLHeadingElement>(null);
  const [renamed, setRenamed] = useState(0);
  useEffect(() => {
    if (renamed > 0) heading.current?.focus();
  }, [renamed]);

  // Runs one change. Any refusal shows its words and re-reads the shelf, so the screen shows the truth.
  function change(send: () => Promise<unknown>, refusals: Partial<Record<string, string>>, done?: () => void) {
    void guard(async () => {
      setNotice(undefined);
      try {
        await send();
        if (!live.current) return;
        done?.();
      } catch (e) {
        if (!live.current) return;
        if (e instanceof ApiError && e.status === 401) {
          lose();
          return;
        }
        setConfirming(false);
        setNotice((e instanceof ApiError && e.rejected !== null && refusals[e.rejected]) || "Something went wrong. Try again.");
      }
      await reload();
    });
  }

  function rename(e: React.FormEvent) {
    e.preventDefault();
    const clean = cleanCollectionName(name);
    if (clean === null) {
      setNotice("A collection name is 1 to 60 characters, with no control characters.");
      return;
    }
    change(() => renameCollection(id, clean.name), { "name-taken": "You already have a collection called that." }, () => { setRenaming(false); setRenamed((n) => n + 1); });
  }

  const body = () => {
    if (member === null || state.status === "lost") return <SignIn returnTo={returnTo} />;
    if (state.status === "gone") return deleted ? <p ref={(el) => el?.focus()} tabIndex={-1}>Deleted. <a href="/mine">Back to my books</a></p> : <><p>That collection isn't here.</p><BackLink /></>;
    if (state.status === "failed") return <Trouble onRetry={retry} />;
    if (state.status !== "ok") return null;
    const { collection, owner, items } = state.data;
    const isOwner = owner.id === member.id;
    const canDelete = isOwner && !collection.isDefault && collection.count === 0 && items.length === 0;
    return (
      <>
        {notice !== undefined && <p role="alert" className="refusal">{notice}</p>}
        <h2 ref={heading} tabIndex={-1}><Name>{collection.name}</Name></h2>
        <p>Owned by <Name>{owner.name}</Name> &middot; <BookCount n={collection.count} /></p>
        {isOwner && !renaming && !confirming && (
          <p className="controls">
            <button type="button" disabled={busy} onClick={() => { setName(collection.name); setRenaming(true); setNotice(undefined); }}>Rename</button>
            {!collection.isDefault && (
              <button type="button" disabled={busy} onClick={() => change(() => makeDefault(id), { "not-allowed": "That collection can't be made the default." })}>Make this the default</button>
            )}
            {canDelete && <button type="button" disabled={busy} onClick={() => setConfirming(true)}>Delete</button>}
          </p>
        )}
        {isOwner && renaming && (
          <form onSubmit={rename}>
            <label>
              New name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" disabled={busy}>Save</button>
            <button type="button" disabled={busy} onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        )}
        {isOwner && confirming && (
          <div>
            <p>Delete <Name>{collection.name}</Name>?</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => change(
                () => deleteCollection(id),
                { "not-allowed": "That collection can't be deleted: it has books in it, or it's your default." },
                () => setDeleted(true),
              )}
            >Yes, delete it</button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        )}
        {items.length === 0 ? <p>No books here yet.</p> : <ShelfList items={items} viewerId={member.id} />}
      </>
    );
  };

  return (
    <div className="shelf-page">
      <h1>Natalie's Little Library</h1>
      {body()}
    </div>
  );
}
