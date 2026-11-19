import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionType, CopyView, HistoryEntry, LabelView, Member } from "../../shared/types";
import { ApiError, claim, getLabel, returnCopy } from "../api";
import { embeddedBrowser } from "../embedded";

const actionText: Record<ActionType, string> = { claim: "I have this book", return: "Mark as returned" };
const historyText: Record<HistoryEntry["type"], string> = {
  added: "added this book",
  labelled: "put a label on it",
  claimed: "took it",
  returned: "marked it returned",
};

function Cover({ url }: { url: string | null }) {
  return url ? <img className="cover" src={url} alt="" /> : <div className="cover cover-missing" aria-hidden="true" />;
}

function Book(props: { title: string; authors: string[]; coverUrl: string | null }) {
  return (
    <div className="book">
      <Cover url={props.coverUrl} />
      <div>
        <h2>{props.title}</h2>
        {props.authors.length > 0 && <p className="authors">{props.authors.join(", ")}</p>}
      </div>
    </div>
  );
}

function CopyLink() {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(location.href);
      setState("copied");
    } catch {
      setState("manual");
    }
  }
  return (
    <>
      <button type="button" onClick={copy}>{state === "copied" ? "Copied" : "Copy link"}</button>
      {state === "manual" && (
        <p>
          <input type="text" readOnly aria-label="Address of this page" value={location.href}
            onFocus={(e) => e.currentTarget.select()} />
        </p>
      )}
    </>
  );
}

function SignIn({ returnTo }: { returnTo: string }) {
  const app = embeddedBrowser(navigator.userAgent);
  if (app !== null) {
    return (
      <>
        <p>Google won't let you sign in inside {app}. Open this page in Safari or Chrome.</p>
        <CopyLink />
      </>
    );
  }
  return <a className="button" href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in with Google</a>;
}

function Copy(props: { copy: CopyView; busy: boolean; onAction: (a: ActionType) => void }) {
  const { copy, busy, onAction } = props;
  const holder = copy.holder.kind === "member" ? copy.holder.person.name : copy.holder.name;
  return (
    <>
      <Book {...copy.book} />
      {copy.owner && <p>Owned by {copy.owner.name}</p>}
      <p>{copy.home ? "At home with" : "With"} {holder}</p>
      {copy.actions.length > 0 && (
        <p>
          {copy.actions.map((a) => (
            <button key={a} type="button" disabled={busy} onClick={() => onAction(a)}>{actionText[a]}</button>
          ))}
        </p>
      )}
      <ul className="history">
        {copy.history.map((h, i) => (
          <li key={i}>{h.actor.name} {historyText[h.type]} <span className="when">{new Date(h.at).toLocaleDateString()}</span></li>
        ))}
      </ul>
    </>
  );
}

export function CopyPage(props: { code: string; member: Member | null; returnTo: string }) {
  const { code, member, returnTo } = props;
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
      if (live.current) setView(v);
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
        await load();
      } else if (e instanceof ApiError && e.status === 403 && e.rejected === "not-allowed") {
        setNotice("That's already changed. Here's where the book is now.");
        await load();
      } else {
        setNotice("Something went wrong. Try again.");
      }
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
        <button type="button" onClick={() => void load()}>Try again</button>
      </>
    );
  }
  if (view === undefined) return heading;

  const signIn = member ? null : <SignIn returnTo={returnTo} />;
  return (
    <>
      {heading}
      {notice !== undefined && <p role="alert" className="refusal">{notice}</p>}
      {view.kind === "unknown" && <p>This label isn't one of ours.</p>}
      {view.kind === "blank" && (
        <>
          <p>This label isn't on a book yet.</p>
          {member ? (
            <a className="button" href={`/pair?label=${encodeURIComponent(view.code)}`}>Pair it with a book</a>
          ) : signIn}
        </>
      )}
      {view.kind === "public" && (
        <>
          <Book {...view.book} />
          <p>Sign in to see who has this book or to take it.</p>
          {signIn}
        </>
      )}
      {view.kind === "copy" && <Copy copy={view.copy} busy={busy} onAction={(a) => void act(a, view.copy)} />}
    </>
  );
}
