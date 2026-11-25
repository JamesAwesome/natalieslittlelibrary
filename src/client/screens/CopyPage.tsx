import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionType, CollectionSummary, CopyView, HistoryEntry, LabelView, Member } from "../../shared/types";
import { ApiError, claim, getCopy, getLabel, moveCopy, myCollections, returnCopy } from "../api";
import { Book, Name } from "./BookCard";
import { SignIn } from "./SignIn";

const actionText: Record<ActionType, string> = {
  claim: "I have this book",
  return: "Mark as returned",
  move: "Move",
  label: "Put a label on it",
};
const historyText: Record<HistoryEntry["type"], string> = {
  added: "added this book",
  labelled: "put a label on it",
  claimed: "took it",
  returned: "marked it returned",
};

// A stable key per entry; a counter breaks ties between identical entries.
function historyKeys(history: HistoryEntry[]): [string, HistoryEntry][] {
  const seen = new Map<string, number>();
  return history.map((h) => {
    const base = `${h.at}/${h.type}/${h.actor.id}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return [`${base}/${n}`, h];
  });
}

function Copy(props: {
  copy: CopyView;
  busy: boolean;
  onAction: (a: ActionType) => void;
  choices: CollectionSummary[] | undefined;
  choicesFailed: boolean;
  onMove: (collectionId: string) => void;
}) {
  const { copy, busy, onAction, choices, choicesFailed, onMove } = props;
  const holder = copy.holder.kind === "member" ? copy.holder.person.name : copy.holder.name;
  // Only other collections are offered; with none, there is nothing to move to.
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const current = copy.collection?.id;
  const options = (choices ?? []).filter((c) => c.id !== current);
  const chosen = picked !== undefined && options.some((c) => c.id === picked) ? picked : options[0]?.id;
  // A copy with no label code was reached by id; claiming goes through the code, so it is not offered.
  const buttons = copy.actions.filter((a) => a !== "move" && a !== "label" && !(a === "claim" && copy.code === null));
  return (
    <>
      <Book {...copy.book} />
      {copy.owner && (
        <p>Owned by <Name>{copy.owner.name}</Name>{copy.collection && <> &middot; <Name>{copy.collection.name}</Name></>}</p>
      )}
      <p>{copy.home ? "At home" : <>With <Name>{holder}</Name></>}</p>
      {buttons.length > 0 && (
        <p>
          {buttons.map((a) => (
            <button key={a} type="button" disabled={busy} onClick={() => onAction(a)}>{actionText[a]}</button>
          ))}
        </p>
      )}
      {copy.actions.includes("move") && options.length > 0 && chosen !== undefined && (
        <p className="move">
          <label>
            {actionText.move} to
            <select value={chosen} disabled={busy} onChange={(e) => setPicked(e.target.value)}>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => onMove(chosen)}>Move</button>
        </p>
      )}
      {copy.actions.includes("move") && choicesFailed && <p>Couldn't load your collections, so moving isn't available right now.</p>}
      {copy.actions.includes("label") && (
        <p><a className="button" href={`/pair?copy=${encodeURIComponent(copy.copyId)}`}>{actionText.label}</a></p>
      )}
      <ul className="history">
        {historyKeys(copy.history).map(([key, h]) => (
          <li key={key}><Name>{h.actor.name}</Name> {historyText[h.type]} <span className="when">{new Date(h.at).toLocaleDateString()}</span></li>
        ))}
      </ul>
    </>
  );
}

type Props = ({ code: string } | { copyId: string }) & { member: Member | null; returnTo: string };

// Keyed on the code (or copy id) so moving between pages starts from nothing.
export function CopyPage(props: Props) {
  return <Page key={"code" in props ? `code:${props.code}` : `id:${props.copyId}`} {...props} />;
}

function Page(props: Props) {
  const { member, returnTo } = props;
  const code = "code" in props ? props.code : null;
  const copyId = "copyId" in props ? props.copyId : null;
  // The member prop was read once at load; a 401 or a public view means the session is gone.
  const [lost, setLost] = useState(false);
  const [view, setView] = useState<LabelView | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [gone, setGone] = useState(false);
  const [choices, setChoices] = useState<CollectionSummary[] | undefined>(undefined);
  const [choicesFailed, setChoicesFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const inFlight = useRef(false);
  const live = useRef(true);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const v: LabelView = code !== null ? await getLabel(code) : { kind: "copy", copy: await getCopy(copyId ?? "") };
      if (!live.current) return;
      if (v.kind === "public") setLost(true);
      setView(v);
    } catch (e) {
      if (!live.current) return;
      if (code === null && e instanceof ApiError && e.status === 401) {
        // Nothing on a page reached by id outlives the session: drop the stale copy and its buttons.
        setLost(true);
        setView(undefined);
      }
      else if (code === null && e instanceof ApiError && e.status === 404) setGone(true);
      else setFailed(true);
    }
  }, [code, copyId]);

  const mayMove = view?.kind === "copy" && view.copy.actions.includes("move");
  const loadChoices = useCallback(async (): Promise<CollectionSummary[] | null> => {
    try {
      const mine = await myCollections();
      if (live.current) {
        setChoices(mine.collections);
        setChoicesFailed(false);
      }
      return mine.collections;
    } catch {
      if (live.current) setChoicesFailed(true);
      return null;
    }
  }, []);
  useEffect(() => {
    if (mayMove) void loadChoices();
  }, [mayMove, loadChoices]);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  async function move(copy: CopyView, collectionId: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await moveCopy(copy.copyId, collectionId);
      // A label page refetches, so what depends on the code (the copy link) stays; the answer to a move carries none.
      if (code !== null) await load();
      else if (live.current) setView({ kind: "copy", copy: next });
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setLost(true);
      } else if (e instanceof ApiError && e.rejected === "not-found") {
        const fresh = await loadChoices();
        setNotice(fresh !== null && fresh.some((c) => c.id === collectionId)
          ? "That book isn't here any more."
          : "That collection is gone. Pick another.");
        return;
      } else {
        setNotice("Something went wrong. Try again.");
      }
      await load();
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }

  async function act(type: ActionType, copy: CopyView) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await (type === "claim" && code !== null ? claim(code) : returnCopy(copy.copyId));
      if (live.current) setView({ kind: "copy", copy: next });
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setLost(true);
      } else if (e instanceof ApiError && e.status === 403 && e.rejected === "not-allowed") {
        setNotice("That's already changed. Here's where the book is now.");
      } else {
        // The server may have accepted it before the answer was lost; show the truth.
        setNotice("Something went wrong. Try again.");
      }
      await load();
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }

  const heading = <h1>Natalie's Little Library</h1>;
  if (failed) {
    return (
      <div className="copy-page">
        {heading}
        <p role="alert" className="refusal">The library is having trouble right now. Please try again later.</p>
        <button type="button" onClick={() => { setView(undefined); void load(); }}>Try again</button>
      </div>
    );
  }
  if (view === undefined) {
    return (
      <div className="copy-page">
        {heading}
        {gone && <p>That book isn't here.</p>}
        {lost && !gone && <SignIn returnTo={returnTo} />}
      </div>
    );
  }

  const signedIn = member !== null && !lost;
  return (
    <div className="copy-page">
      {heading}
      {notice !== undefined && <p role="alert" className="refusal">{notice}</p>}
      {view.kind === "unknown" && <p>This label isn't one of ours.</p>}
      {view.kind === "blank" && (
        <>
          <p>This label isn't on a book yet.</p>
          {signedIn ? (
            <a className="button" href={`/pair?label=${encodeURIComponent(view.code)}`}>Pair it with a book</a>
          ) : <SignIn returnTo={returnTo} />}
        </>
      )}
      {view.kind === "public" && (
        <>
          <Book {...view.book} />
          <p>Sign in to see who has this book or to take it.</p>
          <SignIn returnTo={returnTo} />
        </>
      )}
      {view.kind === "copy" && <Copy copy={view.copy} busy={busy} choices={choices} onAction={(a) => void act(a, view.copy)} choicesFailed={choicesFailed} onMove={(id) => void move(view.copy, id)} />}
    </div>
  );
}
