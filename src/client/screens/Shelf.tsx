import { useEffect, useRef, useState } from "react";
import type { Member, Shelf as ShelfData } from "../../shared/types";
import { cleanCollectionName } from "../../shared/collectionName";
import { ApiError, deleteCollection, getShelf, makeDefault, renameCollection } from "../api";
import { BackLink } from "./BackLink";
import { CoverWall } from "../wall/CoverWall";
import { useWallPlace, wallKey } from "../wall/memory";
import { Name, personLabel } from "./BookCard";
import { APP_NAME, useTab } from "../shell";
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
  useTab(member !== null && state.status === "ok" ? (state.data.owner.id === member.id ? "books" : "friends") : undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const [renamed, setRenamed] = useState(0);
  const ready = member !== null && state.status === "ok";
  const [filter, setFilter] = useWallPlace(wallKey(), ready, []);
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

  // The collection's name once known, kept through a failed read and Try again, so the h1 never flickers back.
  // Until it is known, the app name, as before.
  const shelfName = state.status === "ok" ? state.data.collection.name : null;
  const [known, setKnown] = useState<string | null>(null);
  if (shelfName !== null && shelfName !== known) setKnown(shelfName);
  const title = shelfName ?? known ?? APP_NAME;

  // Not the wall: the page as it was, under the collection's name (or the app name when signed out).
  const page = (children: React.ReactNode, heading = title) => (
    <div className="shelf-page">
      <h1><Name>{heading}</Name></h1>
      {children}
    </div>
  );
  if (member === null || state.status === "lost") return page(<SignIn returnTo={returnTo} />, APP_NAME);
  if (state.status === "gone") return page(deleted ? <p ref={(el) => el?.focus()} tabIndex={-1}>Deleted. <a href="/">Back to my books</a></p> : <><p>That collection isn't here.</p><BackLink /></>);
  if (state.status === "failed") return page(<Trouble onRetry={retry} />);

  const shelf = state.status === "ok" ? state.data : null;
  const isOwner = shelf !== null && shelf.owner.id === member.id;
  const top = shelf && (() => {
    const { collection, owner, items } = shelf;
    const canDelete = isOwner && !collection.isDefault && collection.count === 0 && items.length === 0;
    return (
      <>
        {notice !== undefined && <p role="alert" className="refusal">{notice}</p>}
        <p>Owned by <Name>{personLabel(owner)}</Name></p>
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
      </>
    );
  })();

  // Loading and loaded are the same wall, so the h1 (and its ref) stays one element as the name arrives.
  return (
    <CoverWall
      kind={isOwner ? "my-collection" : "friend-collection"}
      title={title}
      headingRef={heading}
      loading={!ready}
      items={shelf?.items ?? []}
      top={top}
      filter={filter}
      onFilter={setFilter}
      empty={<p>No books here yet.</p>}
    />
  );
}
