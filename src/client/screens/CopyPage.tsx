import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionType, CollectionSummary, CopyView, HistoryEntry, LabelView, LendTo, Member, Person } from "../../shared/types";
import {
  adoptCopy, ApiError, approveRequest, claim, declineRequest, getCopy, getLabel, giveCopy, lendCopy, listMembers, moveCopy, myCollections,
  releaseCopy, requestCopy, returnCopy, withdrawRequest,
} from "../api";
import { backFor, mainAction } from "../book/model";
import { Cover, holderLabel, Name, personLabel } from "./BookCard";
import { APP_NAME, tabRoot, useTab, type Tab } from "../shell";
import { LendBox } from "./LendBox";
import { SignIn } from "./SignIn";

const actionText: Record<ActionType, string> = {
  claim: "I have this book",
  return: "Mark as returned",
  move: "Move",
  label: "Put a label on it",
  relabel: "Replace label",
  lend: "Lend",
  give: "Give",
  request: "Ask to keep this",
  withdraw: "Withdraw",
  approve: "Approve",
  decline: "Decline",
  release: "Release",
  adopt: "Take this book",
};
// What an entry says after the actor's name; `who` is its subject.
const historyText: Record<HistoryEntry["type"], (who: ReactNode) => ReactNode> = {
  added: () => "added this book",
  labelled: () => "put a label on it",
  relabelled: () => "replaced its label",
  claimed: () => "took it",
  returned: () => "marked it returned",
  lent: (who) => <>lent this to {who}</>,
  given: (who) => <>gave this to {who}</>,
  requested: () => "asked to keep this",
  withdrawn: () => "withdrew their request",
  approved: (who) => <>let {who} keep this</>,
  declined: (who) => <>declined {who}&apos;s request</>,
  released: () => "released this",
  adopted: () => "took this on",
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

// One stroke set with the tab icons: 24x24, 1.6 stroke, round caps and joins.
const Chevron = ({ back = false }: { back?: boolean }) => (
  <svg className="book-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={back ? "M14.5 6l-6 6 6 6" : "M9.5 6l6 6-6 6"} /></svg>
);

// Parts of one line, with a middle dot between those present.
const joined = (parts: ReactNode[]) => parts.filter(Boolean).map((p, i) => <Fragment key={i}>{i > 0 && " \u00B7 "}{p}</Fragment>);

// The way back to the wall this visit came from. The visible text is the wall's name; its accessible name says "Back to".
// The link is a flex row, so the space that keeps the name readable takes no room on screen.
export function BookBack({ href, label }: { href: string; label: string }) {
  return (
    <p className="book-back">
      <a href={href}><Chevron back /><span className="visually-hidden">Back to</span>{" "}<span className="book-back-label"><Name>{label}</Name></span></a>
    </p>
  );
}

// The cover, centred, then the title and the authors. The title takes focus after an action, so it can be focused by script.
function BookHead({ book }: { book: { title: string; authors: string[]; coverUrl: string | null } }) {
  return (
    <div className="book-head">
      <Cover url={book.coverUrl} title={book.title} authors={book.authors} size="hero" />
      <h1 tabIndex={-1}>{book.title}</h1>
      {book.authors.length > 0 && (
        <p className="book-authors">{book.authors.map((a, i) => <span key={i}>{i > 0 && ", "}<Name>{a}</Name></span>)}</p>
      )}
    </div>
  );
}

// Signed out: the same layout, with sign-in where the main button goes.
export function PublicBook({ book, returnTo }: { book: { title: string; authors: string[]; coverUrl: string | null }; returnTo: string }) {
  return (
    <>
      <BookHead book={book} />
      <p className="book-status">Sign in to see who has this book or to take it.</p>
      <div className="book-main"><SignIn returnTo={returnTo} /></div>
    </>
  );
}

export function Copy(props: {
  copy: CopyView;
  viewerId: string | null;
  busy: boolean;
  onAction: (a: ActionType) => void;
  choices: CollectionSummary[] | undefined;
  choicesFailed: boolean;
  onMove: (collectionId: string) => void;
  onLend: (to: LendTo) => void;
  onGive: (memberId: string) => void;
  onRelease: () => void;
}) {
  const { copy, viewerId, busy, onAction, choices, choicesFailed, onMove, onLend, onGive, onRelease } = props;
  const [step, setStep] = useState<"lend" | "give" | "release" | "approve" | undefined>(undefined);
  const [giveTo, setGiveTo] = useState<Person | undefined>(undefined);
  const [members, setMembers] = useState<Person[] | "failed" | undefined>(undefined);
  useEffect(() => {
    if (step !== "give") return;
    let live = true;
    listMembers().then(
      (m) => live && setMembers(m.members.filter((x) => x.id !== copy.owner?.id && !x.removed)),
      () => live && setMembers("failed"),
    );
    return () => {
      live = false;
    };
  }, [step, copy.owner?.id]);
  const close = () => {
    setStep(undefined);
    setGiveTo(undefined);
  };
  // Only other collections are offered; with none, there is nothing to move to.
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const current = copy.collection?.id;
  const options = (choices ?? []).filter((c) => c.id !== current);
  const chosen = picked !== undefined && options.some((c) => c.id === picked) ? picked : options[0]?.id;
  // An action this page has no text for (a newer server's) is ignored, never a blank button.
  const known = copy.actions.filter((a) => a in actionText);
  const main = mainAction(known, copy.code);
  // Approve hands the book over, so it asks first; while it asks, its own buttons stand in for the plain one.
  const approving = step === "approve" && copy.request !== null;
  // Lend, give and release open a step; while any step is open, none of the three is offered again.
  const shows = (a: ActionType) => (a === "lend" || a === "give" || a === "release" ? step === undefined : !(a === "approve" && approving));
  const press = (a: ActionType) => (a === "approve" || a === "lend" || a === "give" || a === "release" ? setStep(a) : onAction(a));
  // A copy with no label code was reached by id; claiming and taking go through the code, so they are not offered.
  // Move has its own control, and label and relabel go to pairing.
  const rowActions = known.filter((a) => a !== main && a !== "move" && !((a === "claim" || a === "adopt") && copy.code === null));
  const rows = rowActions.flatMap((a) => {
    if (a === "label" || a === "relabel") {
      const href = `/pair?copy=${encodeURIComponent(copy.copyId)}${a === "relabel" ? "&replace=1" : ""}`;
      return [<li key={a}><a className="book-row" href={href}><span>{actionText[a]}</span><Chevron /></a></li>];
    }
    if (!shows(a)) return [];
    return [<li key={a}><button type="button" className="book-row" disabled={busy} onClick={() => press(a)}><span>{actionText[a]}</span><Chevron /></button></li>];
  });
  if (copy.actions.includes("move") && options.length > 0 && chosen !== undefined) {
    rows.push(
      <li key="move" className="move">
        <label>
          {actionText.move} to
          <select value={chosen} disabled={busy} onChange={(e) => setPicked(e.target.value)}>
            {options.map((c) => <option key={c.id} value={c.id} dir="auto">{c.name}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" disabled={busy} onClick={() => onMove(chosen)}>Move</button>
      </li>,
    );
  }

  const isOwner = viewerId !== null && copy.owner !== null && copy.owner.id === viewerId;
  const where = copy.home ? <span className="book-where">At home</span>
    : copy.holder && <span className="book-where">With <Name>{holderLabel(copy.holder)}</Name></span>;
  const whose = copy.owner === null ? <span>No one owns this book.</span> : !isOwner && <><Name>{personLabel(copy.owner)}</Name>’s book</>;
  const status = joined([where, whose]);
  const meta = isOwner
    ? joined([copy.collection && <>In <Name>{copy.collection.name}</Name></>, copy.ownerCode !== null && <span className="label-code">Label {copy.ownerCode}</span>])
    : [];
  return (
    <>
      <BookHead book={copy.book} />
      {status.length > 0 && <p className="book-status">{status}</p>}
      {meta.length > 0 && <p className="book-meta">{meta}</p>}
      {copy.request && <p className="book-request"><Name>{personLabel(copy.request.by)}</Name> asked to keep this</p>}
      {main !== null && shows(main) && (
        <div className="book-main">
          <button type="button" disabled={busy} onClick={() => press(main)}>{actionText[main]}</button>
        </div>
      )}
      {step === "lend" && copy.owner && (
        <div className="book-flow">
          <LendBox ownerId={copy.owner.id} holder={copy.holder} busy={busy} onLend={onLend} />
          <button type="button" className="secondary" onClick={close}>Cancel</button>
        </div>
      )}
      {step === "give" && giveTo === undefined && (
        <div className="book-flow">
          {members === undefined && <p>Loading members.</p>}
          {members === "failed" && <p>Couldn't load the members, so giving isn't available right now.</p>}
          {Array.isArray(members) && members.length === 0 && <p>There is no one to give it to.</p>}
          {Array.isArray(members) && (
            <ul className="book-choices">
              {members.map((m) => <li key={m.id}><button type="button" disabled={busy} onClick={() => setGiveTo(m)}><Name>{m.name}</Name></button></li>)}
            </ul>
          )}
          <button type="button" className="secondary" onClick={close}>Cancel</button>
        </div>
      )}
      {step === "give" && giveTo !== undefined && (
        <div className="book-flow">
          <p>Give <Name>{copy.book.title}</Name> to <Name>{giveTo.name}</Name>?</p>
          <button type="button" disabled={busy} onClick={() => onGive(giveTo.id)}>{actionText.give}</button>
          <button type="button" className="secondary" onClick={close}>Cancel</button>
        </div>
      )}
      {approving && copy.request && (
        <div className="book-flow">
          <p>Let <Name>{personLabel(copy.request.by)}</Name> keep <Name>{copy.book.title}</Name>?</p>
          <button type="button" disabled={busy} onClick={() => onAction("approve")}>{actionText.approve}</button>
          <button type="button" className="secondary" onClick={close}>Cancel</button>
        </div>
      )}
      {step === "release" && (
        <div className="book-flow">
          <p>Release <Name>{copy.book.title}</Name>? It leaves your collection and anyone who scans it can take it.</p>
          <button type="button" disabled={busy} onClick={onRelease}>{actionText.release}</button>
          <button type="button" className="secondary" onClick={close}>Cancel</button>
        </div>
      )}
      {rows.length > 0 && <ul className="book-rows" aria-label="Other actions">{rows}</ul>}
      {copy.actions.includes("move") && choicesFailed && <p>Couldn't load your collections, so moving isn't available right now.</p>}
      {copy.history.length > 0 && (
        <>
          <h2 className="book-history-heading">History</h2>
          <ul className="history">
            {historyKeys(copy.history).map(([key, h]) => (
              <li key={key}><Name>{personLabel(h.actor)}</Name> {historyText[h.type](h.subject ? <Name>{holderLabel(h.subject)}</Name> : "someone")} <span className="when">{new Date(h.at).toLocaleDateString()}</span></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// What the page asks the server to do. Lend and give carry their target; the rest need none.
type Doing = { type: "lend"; to: LendTo } | { type: "give"; to: string } | { type: Exclude<ActionType, "lend" | "give"> };

// Every action type has its own call, so none can fall through to another: adding a type fails to compile until it is handled.
function dispatch(doing: Doing, copy: CopyView, code: string | null): Promise<CopyView> {
  switch (doing.type) {
    case "claim":
      return code !== null ? claim(code) : Promise.reject(new Error("claim needs the label's code"));
    case "adopt":
      return code !== null ? adoptCopy(code) : Promise.reject(new Error("take needs the label's code"));
    case "return":
      return returnCopy(copy.copyId);
    case "lend":
      return lendCopy(copy.copyId, doing.to);
    case "give":
      return giveCopy(copy.copyId, doing.to);
    case "request":
      return requestCopy(copy.copyId);
    case "withdraw":
      return withdrawRequest(copy.copyId);
    case "approve":
      return approveRequest(copy.copyId);
    case "decline":
      return declineRequest(copy.copyId);
    case "release":
      return releaseCopy(copy.copyId);
    case "move":
    case "label":
    case "relabel":
      return Promise.reject(new Error(`${doing.type} has its own control`));
    default: {
      const never: never = doing;
      return Promise.reject(new Error(`unhandled action ${JSON.stringify(never)}`));
    }
  }
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
  // Bumped whenever the copy is replaced, so an open lend, give or release step does not outlive what it was about.
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const inFlight = useRef(false);
  const live = useRef(true);

  // Decided once the view is in: a copy is under Books if mine, Holding if I have it, Friends otherwise.
  let tab: Tab | undefined;
  if (member !== null && !lost && view !== undefined) {
    if (view.kind !== "copy") tab = "books";
    else if (view.copy.owner?.id === member.id) tab = "books";
    else if (view.copy.holder?.kind === "member" && view.copy.holder.person.id === member.id) tab = "holding";
    else tab = "friends";
  }
  // The tab and the way back are decided once, when the view first comes in, and stay for the visit:
  // a claim that makes me the holder doesn't move the page to Holding, and a move or a give doesn't change where Back goes.
  const [pinned, setPinned] = useState<{ tab: Tab; back: { href: string; label: string } } | undefined>(undefined);
  if (pinned === undefined && tab !== undefined && view !== undefined) {
    setPinned({ tab, back: view.kind === "copy" ? backFor(document.referrer, location.origin, view.copy, tab) : tabRoot[tab] });
  }
  useTab(pinned?.tab ?? tab);

  // After an action, focus goes to the page's heading, so nobody is left at the top of the document when the page redraws.
  const page = useRef<HTMLDivElement>(null);
  const [acted, setActed] = useState(0);
  useEffect(() => {
    if (acted > 0) page.current?.querySelector<HTMLElement>("h1")?.focus();
  }, [acted]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const v: LabelView = code !== null ? await getLabel(code) : { kind: "copy", copy: await getCopy(copyId ?? "") };
      if (!live.current) return;
      if (v.kind === "public") setLost(true);
      setRev((r) => r + 1);
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

  function shown(copy: CopyView) {
    setRev((r) => r + 1);
    setView({ kind: "copy", copy });
  }

  async function move(copy: CopyView, collectionId: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await moveCopy(copy.copyId, collectionId);
      // A label page refetches, so what depends on the code (the copy link) stays; the answer to a move carries none.
      if (code !== null) await load();
      else if (live.current) shown(next);
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
      } else if (e instanceof ApiError && e.rejected === "not-allowed") {
        setNotice("You can't move this book.");
      } else {
        setNotice("Something went wrong. Try again.");
      }
      await load();
    } finally {
      inFlight.current = false;
      if (live.current) {
        setBusy(false);
        setActed((n) => n + 1);
      }
    }
  }

  async function act(doing: Doing, copy: CopyView) {
    const type = doing.type;
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await dispatch(doing, copy, code);
      // Claim and take go by the code and answer with it; any other answer carries none, so a label page re-reads.
      if (code !== null && type !== "claim" && type !== "adopt") await load();
      else if (live.current) shown(next);
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setLost(true);
      } else if (e instanceof ApiError && e.status === 403 && e.rejected === "not-allowed") {
        setNotice("That's already changed. Here's where the book is now.");
      } else if ((type === "claim" || type === "adopt") && e instanceof ApiError && e.rejected === "not-found") {
        // The label was replaced meanwhile; the reload below shows that, and "try again" cannot work.
      } else {
        // The server may have accepted it before the answer was lost; show the truth.
        setNotice("Something went wrong. Try again.");
      }
      await load();
    } finally {
      inFlight.current = false;
      if (live.current) {
        setBusy(false);
        setActed((n) => n + 1);
      }
    }
  }

  const heading = <h1 tabIndex={-1}>{APP_NAME}</h1>;
  if (failed) {
    return (
      <div className="copy-page" ref={page}>
        {heading}
        <p role="alert" className="refusal">The library is having trouble right now. Please try again later.</p>
        <button type="button" onClick={() => { setView(undefined); void load(); }}>Try again</button>
      </div>
    );
  }
  if (view === undefined) {
    return (
      <div className="copy-page" ref={page}>
        {heading}
        {gone && <p>That book isn't here.</p>}
        {lost && !gone && <SignIn returnTo={returnTo} />}
      </div>
    );
  }

  const signedIn = member !== null && !lost;
  // Signed out there is no way back: no tab, no wall.
  const back = signedIn ? pinned?.back : undefined;
  return (
    <div className="copy-page" ref={page}>
      {back && <BookBack {...back} />}
      {view.kind !== "copy" && view.kind !== "public" && heading}
      {notice !== undefined && <p role="alert" className="refusal">{notice}</p>}
      {view.kind === "unknown" && <p>This label isn't one of ours.</p>}
      {view.kind === "retired" && <p>This label has been replaced.</p>}
      {view.kind === "blank" && (
        <>
          <p>This label isn't on a book yet.</p>
          {signedIn ? (
            <a className="button" href={`/pair?label=${encodeURIComponent(view.code)}`}>Pair it with a book</a>
          ) : <SignIn returnTo={returnTo} />}
        </>
      )}
      {view.kind === "public" && <PublicBook book={view.book} returnTo={returnTo} />}
      {view.kind === "copy" && (
        <Copy
          key={rev}
          copy={view.copy}
          viewerId={signedIn ? member.id : null}
          busy={busy}
          choices={choices}
          choicesFailed={choicesFailed}
          onAction={(type) => void act({ type } as Doing, view.copy)}
          onMove={(id) => void move(view.copy, id)}
          onLend={(to) => void act({ type: "lend", to }, view.copy)}
          onGive={(to) => void act({ type: "give", to }, view.copy)}
          onRelease={() => void act({ type: "release" }, view.copy)}
        />
      )}
    </div>
  );
}
