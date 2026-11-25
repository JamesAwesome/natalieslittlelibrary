import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionType, CopyView, HistoryEntry, LabelView, Member } from "../../shared/types";
import { ApiError, claim, getLabel, returnCopy } from "../api";
import { Book, Name } from "./BookCard";
import { SignIn } from "./SignIn";

const actionText: Record<ActionType, string> = {
  claim: "I have this book",
  return: "Mark as returned",
  move: "Move to another collection",
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

function Copy(props: { copy: CopyView; busy: boolean; onAction: (a: ActionType) => void }) {
  const { copy, busy, onAction } = props;
  const holder = copy.holder.kind === "member" ? copy.holder.person.name : copy.holder.name;
  return (
    <>
      <Book {...copy.book} />
      {copy.owner && <p>Owned by <Name>{copy.owner.name}</Name></p>}
      <p>{copy.home ? "At home with" : "With"} <Name>{holder}</Name></p>
      {copy.actions.length > 0 && (
        <p>
          {copy.actions.map((a) => (
            <button key={a} type="button" disabled={busy} onClick={() => onAction(a)}>{actionText[a]}</button>
          ))}
        </p>
      )}
      <ul className="history">
        {historyKeys(copy.history).map(([key, h]) => (
          <li key={key}><Name>{h.actor.name}</Name> {historyText[h.type]} <span className="when">{new Date(h.at).toLocaleDateString()}</span></li>
        ))}
      </ul>
    </>
  );
}

// Keyed on the code so moving between labels starts from nothing.
export function CopyPage(props: { code: string; member: Member | null; returnTo: string }) {
  return <Page key={props.code} {...props} />;
}

function Page(props: { code: string; member: Member | null; returnTo: string }) {
  const { code, member, returnTo } = props;
  // The member prop was read once at load; a 401 or a public view means the session is gone.
  const [lost, setLost] = useState(false);
  const [view, setView] = useState<LabelView | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const inFlight = useRef(false);
  const live = useRef(true);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const v = await getLabel(code);
      if (!live.current) return;
      if (v.kind === "public") setLost(true);
      setView(v);
    } catch {
      if (live.current) setFailed(true);
    }
  }, [code]);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  async function act(type: ActionType, copy: CopyView) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await (type === "claim" ? claim(code) : returnCopy(copy.copyId));
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
      <>
        {heading}
        <p role="alert" className="refusal">The library is having trouble right now. Please try again later.</p>
        <button type="button" onClick={() => { setView(undefined); void load(); }}>Try again</button>
      </>
    );
  }
  if (view === undefined) return heading;

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
      {view.kind === "copy" && <Copy copy={view.copy} busy={busy} onAction={(a) => void act(a, view.copy)} />}
    </div>
  );
}
