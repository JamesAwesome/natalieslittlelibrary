import { useEffect, useRef, useState } from "react";
import type { BookInfo, CollectionSummary, Member, ShelfItem } from "../../shared/types";
import { cleanCollectionName } from "../../shared/collectionName";
import { toIsbn13 } from "../../shared/isbn";
import { parseLabelLink } from "../../shared/labelCode";
import { addCopy, ApiError, createCollection, getCandidates, getCopy, labelCopy, lookupBook, myCollections, relabelCopy } from "../api";
import { Scanner, type ScannerProblem } from "../scanner";
import { Book, Name } from "./BookCard";
import { APP_NAME } from "../shell";
import { SignIn } from "./SignIn";

const problemText: Record<ScannerProblem, string> = {
  "no-camera": "This device has no camera we can use.",
  denied: "Camera access was refused. You can allow it in your browser's settings, or type instead.",
  "decoder-failed": "The scanner couldn't start. Type instead.",
};

type Step = "isbn" | "looking" | "confirm" | "similar" | "miss" | "type" | "label" | "saving" | "failed" | "copyloading" | "copyfailed" | "cannot" | "replaceconfirm";
// The server's limits (bookFacts.ts), counted in code points; maxLength counts UTF-16 units, so it can only be stricter.
const MAX_TITLE = 300;
const MAX_AUTHOR = 200;

type Typed = { title: string; author: string };
// What gets saved is decided where the person decides it and passed along, never re-read from state.
// `replacing` is the copy's live code as read, so the server can refuse if it has changed since.
type Payload = { isbn: string } | { title: string; authors: string[] } | { copyId: string } | { copyId: string; replacing: string };
// `stays` is null for a new copy; otherwise the collection an existing copy stays in (name null when it has none).
type Pending = { how: Payload; stays: { name: string | null } | null };

// Not a refusal this screen understands: the request may have done its work before the answer went missing.
const KNOWN: readonly (string | null)[] = ["label-in-use", "label-unknown", "not-allowed", "not-found", "book-not-found"];
const unknownFailure = (e: unknown) => !(e instanceof ApiError) || (e.status !== 401 && !KNOWN.includes(e.rejected));

// One collator for every sort: a new one per comparison is slow.
const COLLATOR = new Intl.Collator();
const LOST = Symbol("lost");
// A request whose failure only means "no answer", except a lost session.
async function soft<T>(p: Promise<T>): Promise<T | null | typeof LOST> {
  try {
    return await p;
  } catch (e) {
    return e instanceof ApiError && e.status === 401 ? LOST : null;
  }
}

const pickKey = (memberId: string) => `nll.pair-collection.${memberId}`;
function readPick(memberId: string): string | null {
  try {
    return localStorage.getItem(pickKey(memberId));
  } catch {
    return null;
  }
}
function writePick(memberId: string, id: string) {
  try {
    localStorage.setItem(pickKey(memberId), id);
  } catch {
    /* the pick just isn't remembered */
  }
}
const defaultOf = (list: CollectionSummary[]) => (list.find((c) => c.isDefault) ?? list[0])?.id ?? "";

export function Pair(props: { member: Member | null; returnTo: string }) {
  const { member, returnTo } = props;
  // The member prop was read once at load; a 401 means the session is gone.
  const [lost, setLost] = useState(false);
  // /pair?copy=<id> labels a book already on a shelf; read once from the address.
  const [copyId] = useState<string | null>(() => new URLSearchParams(location.search).get("copy"));
  // With replace=1 the copy already has a label, and the one read takes its place.
  const [replace] = useState(() => copyId !== null && new URLSearchParams(location.search).get("replace") === "1");
  const [step, setStep] = useState<Step>(copyId !== null ? "copyloading" : "isbn");
  const [forCopy, setForCopy] = useState<{ title: string; authors: string[]; coverUrl: string | null } | null>(null);
  const [imported, setImported] = useState<ShelfItem | null>(null);
  const [similar, setSimilar] = useState<ShelfItem[]>([]);
  const [after, setAfter] = useState<Payload | null>(null);
  const [cols, setCols] = useState<CollectionSummary[] | null>(null);
  const [pick, setPick] = useState("");
  const pickRef = useRef("");
  const [stale, setStale] = useState(false);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | undefined>(undefined);
  const creating = useRef(false);
  const colSeq = useRef(0);
  const [isbn, setIsbn] = useState<string | null>(null);
  const [book, setBook] = useState<BookInfo | null>(null);
  const [typed, setTyped] = useState<Typed>({ title: "", author: "" });
  // A code from the address skips the label step until it is refused.
  const [linked, setLinked] = useState<string | null>(() => parseLabelLink(new URLSearchParams(location.search).get("label") ?? ""));
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [problem, setProblem] = useState<ScannerProblem | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [stays, setStays] = useState<{ name: string; label: string } | null>(null);
  // The label read and the payload it was read for, held together until the person confirms the replace.
  const [toReplace, setToReplace] = useState<{ label: string; p: Pending } | null>(null);
  const inFlight = useRef(false);
  // A refused label still in front of the camera must not be saved again until another is read or typed.
  const refused = useRef<string | null>(null);
  const seq = useRef(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const choose = (id: string) => {
    pickRef.current = id;
    setPick(id);
  };

  const colsRef = useRef<CollectionSummary[] | null>(null);
  // The member's collections, read again whenever a choice is about to be made: a once-read list goes stale.
  // A failed read keeps the list already known; the answer is the list to decide from, or LOST.
  async function loadCollections(gone = false): Promise<CollectionSummary[] | null | typeof LOST> {
    if (member === null) return null;
    const mine = ++colSeq.current;
    const r = await soft(myCollections());
    if (mine !== colSeq.current || !live.current) return colsRef.current;
    if (r === LOST) {
      setLost(true);
      return LOST;
    }
    if (r === null) return colsRef.current;
    const list = r.collections;
    const has = (id: string) => list.some((c) => c.id === id);
    colsRef.current = list;
    setCols(list);
    if (has(pickRef.current)) return list;
    const stored = gone ? null : readPick(member.id);
    if (stored !== null && has(stored)) {
      choose(stored);
      setStale(false);
    } else {
      choose(defaultOf(list));
      setStale(stored !== null);
    }
    return list;
  }

  useEffect(() => {
    if (copyId === null) void loadCollections();
    else void loadCopy(copyId);
  }, []);

  // `again` is a replace refused because the copy's label changed: once re-read, the same label is asked about
  // again with the fresh code, and the scanner stays closed so a camera still on the sticker reads nothing.
  async function loadCopy(id: string, again?: { label: string; notice: string }) {
    const mine = ++seq.current;
    setNotice(undefined);
    go("copyloading");
    try {
      const view = await getCopy(id);
      if (mine !== seq.current || !live.current) return;
      const how: Payload | null = replace
        ? (view.actions.includes("relabel") && view.ownerCode !== null ? { copyId: id, replacing: view.ownerCode } : null)
        : (view.actions.includes("label") ? { copyId: id } : null);
      if (how === null) {
        go("cannot");
        return;
      }
      setForCopy(view.book);
      const stays = { name: view.collection?.name ?? null };
      if (again !== undefined) {
        const p: Pending = { how, stays };
        setPending(p);
        setToReplace({ label: again.label, p });
        setNotice(again.notice);
        go("replaceconfirm");
        return;
      }
      void chosen(how, stays);
    } catch (e) {
      if (mine !== seq.current || !live.current) return;
      if (e instanceof ApiError && e.status === 401) setLost(true);
      else if (e instanceof ApiError && (e.status === 404 || e.rejected === "not-found")) go("cannot");
      else go("copyfailed");
    }
  }

  const picking = (p: Pending) => p.stays === null && cols !== null && cols.length >= 2;
  // A new copy cannot be filed while the member's collections are unknown: they may have several.
  const unknown = (p: Pending) => p.stays === null && cols === null;

  const go = (next: Step) => {
    setProblem(null);
    setStep(next);
  };

  function startOver() {
    seq.current++;
    setIsbn(null);
    setBook(null);
    setTyped({ title: "", author: "" });
    setCode(null);
    setPending(null);
    setForCopy(null);
    setImported(null);
    setSimilar([]);
    setAfter(null);
    setToReplace(null);
    refused.current = null;
    setNotice(undefined);
    go("isbn");
  }

  async function look(raw: string) {
    const mine = ++seq.current;
    setIsbn(raw);
    setNotice(undefined);
    setImported(null);
    setSimilar([]);
    go("looking");
    const [looked, byIsbn] = await Promise.all([soft(lookupBook(raw)), soft(getCandidates({ isbn: raw }))]);
    if (mine !== seq.current || !live.current) return;
    if (looked === LOST || byIsbn === LOST) {
      setLost(true);
      return;
    }
    // An imported copy with this ISBN is the answer even when the lookup has nothing.
    const held = byIsbn?.sameIsbn ?? null;
    if (held !== null) {
      setImported(held);
      setBook(held.book);
      go("confirm");
      return;
    }
    const found = looked?.book ?? null;
    let near: ShelfItem[] = [];
    if (found !== null) {
      const byTitle = await soft(getCandidates({ title: found.title }));
      if (mine !== seq.current || !live.current) return;
      if (byTitle === LOST) {
        setLost(true);
        return;
      }
      near = byTitle?.similar ?? [];
    }
    setSimilar(near);
    setBook(found);
    go(found ? "confirm" : "miss");
  }

  async function save(label: string, p: Pending, collectionId: string | undefined) {
    if (inFlight.current) return;
    inFlight.current = true;
    const mine = seq.current;
    setCode(label);
    setNotice(undefined);
    setStays(null);
    go("saving");
    try {
      let stayed: { name: string } | null = null;
      if ("replacing" in p.how) await relabelCopy(p.how.copyId, label, p.how.replacing);
      else if ("copyId" in p.how) await labelCopy(p.how.copyId, label);
      else {
        const saved = await addCopy({ code: label, ...p.how, ...(collectionId !== undefined ? { collectionId } : {}) });
        // A scan that found an imported copy labels it where it is; the collection that was picked did not apply.
        if (collectionId !== undefined && saved.collection != null && saved.collection.id !== collectionId) stayed = { name: saved.collection.name };
      }
      if (collectionId !== undefined && member !== null && stayed === null) writePick(member.id, collectionId);
      if (stayed !== null) {
        if (mine === seq.current && live.current) setStays({ name: stayed.name, label });
        return;
      }
      // Stay in flight once saved: the page is leaving, and a second tap must not save again.
      if (mine === seq.current && live.current) location.assign(`/b/${label}`);
      return;
    } catch (e) {
      inFlight.current = false;
      if (mine !== seq.current || !live.current) return;
      const why = e instanceof ApiError ? e.rejected : null;
      const existing = "copyId" in p.how;
      // A replace whose answer was lost may have landed, and a retry of it is then refused as label-in-use.
      // Re-read the copy first: if it already carries the label sent, the replace is done.
      if ("replacing" in p.how && (unknownFailure(e) || (why === "label-in-use" && label !== p.how.replacing))) {
        const now = await soft(getCopy(p.how.copyId));
        if (mine !== seq.current || !live.current) return;
        if (now === LOST) {
          setLost(true);
          return;
        }
        if (now !== null && now.ownerCode === label) {
          inFlight.current = true;
          location.assign(`/b/${label}`);
          return;
        }
      }
      if (e instanceof ApiError && e.status === 401) {
        setLost(true);
      } else if (why === "label-in-use" || why === "label-unknown") {
        setLinked(null);
        setCode(null);
        refused.current = label;
        setNotice(why === "label-in-use" ? "That label is already on a book. Use a blank one." : "That isn't one of our labels.");
        go("label");
      } else if ("replacing" in p.how && why === "not-allowed") {
        // The copy's label changed since it was read (or it is no longer ours): read it again before another try.
        void loadCopy(p.how.copyId, { label, notice: "This book's label just changed. Try again." });
      } else if (existing && why === "not-allowed") {
        startOver();
        setNotice("That book already has a label.");
      } else if (existing && why === "not-found") {
        go("cannot");
      } else if (!existing && why === "not-found") {
        // The collection was deleted since the list was read: drop it, keep the label and book, read the list again.
        // The scanner stays away so a label still in front of the camera is not sent again until the person taps.
        const rest = (colsRef.current ?? []).filter((c) => c.id !== collectionId);
        if (colsRef.current !== null) {
          colsRef.current = rest;
          setCols(rest);
          choose(defaultOf(rest));
        }
        setLinked(label);
        setCode(null);
        go("label");
        void afterGone();
      } else if (why === "book-not-found") {
        setNotice("We couldn't find that book. Type the title instead.");
        go("type");
      } else {
        setNotice("Something went wrong saving that. Try again.");
        go("failed");
      }
    }
  }

  async function afterGone() {
    const list = await loadCollections(true);
    if (list === LOST || !live.current) return;
    if (list !== null && list.length >= 2) setNotice("That collection was just deleted. Pick another.");
    else if (list !== null && list.length === 1) setNotice(`That collection was just deleted, so this goes in ${list[0].name}.`);
    else setNotice("That collection was just deleted.");
  }

  // The collection for a new copy comes from the pick the person made; an existing copy stays where it is.
  function withLabel(label: string, p: Pending) {
    if ("replacing" in p.how) {
      if (label === p.how.replacing) {
        // The sticker already on the book: nothing to confirm, and not offered again until another is read.
        refused.current = label;
        setLinked(null);
        setCode(null);
        setNotice("That's the label already on this book. Scan a new blank one.");
        go("label");
        return;
      }
      // Every way a label arrives (scan, typed, from the address) asks before the old one is retired.
      setToReplace({ label, p });
      setNotice(undefined);
      go("replaceconfirm");
      return;
    }
    let target: string | undefined;
    if (p.stays === null) {
      const list = colsRef.current;
      if (list === null) {
        go("label");
        return;
      }
      if (list.length >= 2) target = pickRef.current;
    }
    if (target === "new") {
      // Keep the code: once the collection is created it is one tap away.
      setLinked(label);
      setNotice("Create the new collection first, or pick another.");
      return;
    }
    void save(label, p, target);
  }
  // Once the payload is chosen: save now if the label is known and no collection needs asking, otherwise ask for it.
  // For a new copy the list is read first and decided from, never from what an earlier render saw.
  async function chosen(how: Payload, stays: Pending["stays"]) {
    const p: Pending = { how, stays };
    const mine = seq.current;
    setNotice(undefined);
    setPending(p);
    let list = colsRef.current;
    if (stays === null) {
      go("looking");
      const r = await loadCollections();
      if (mine !== seq.current || !live.current || r === LOST) return;
      list = r;
    }
    const asks = stays === null && (list === null || list.length >= 2);
    if (linked !== null && !asks) withLabel(linked, p);
    else go("label");
  }
  // Back to scanning; the label declined is not offered again until another is read or typed.
  function cancelReplace() {
    if (toReplace !== null) refused.current = toReplace.label;
    setLinked(null);
    setToReplace(null);
    go("label");
  }
  const rescan = () => {
    setIsbn(null);
    setBook(null);
    go("isbn");
  };

  async function onTyped(t: Typed, rawIsbn: string) {
    setTyped(t);
    // A title means the person chose to type the book; an ISBN alone is looked up.
    if (t.title !== "") {
      const how = { title: t.title, authors: t.author ? [t.author] : [] };
      const mine = ++seq.current;
      go("looking");
      const r = await soft(getCandidates({ title: t.title }));
      if (mine !== seq.current || !live.current) return;
      if (r === LOST) {
        setLost(true);
        return;
      }
      const near = r?.similar ?? [];
      if (near.length === 0) {
        void chosen(how, null);
        return;
      }
      setSimilar(near);
      setAfter(how);
      go("similar");
      return;
    }
    const n = toIsbn13(rawIsbn);
    if (n !== null) void look(n);
  }

  async function create() {
    if (creating.current || member === null) return;
    const clean = cleanCollectionName(newName);
    if (clean === null) {
      setNewError("A collection name is 1 to 60 characters, with no control characters.");
      return;
    }
    creating.current = true;
    colSeq.current++;
    setNewError(undefined);
    try {
      const made = await createCollection(clean.name);
      if (!live.current) return;
      const rest = (colsRef.current ?? []).filter((c) => c.id !== made.id);
      const next = [...rest.filter((c) => c.isDefault), ...[...rest.filter((c) => !c.isDefault), made].sort((x, y) => COLLATOR.compare(x.name, y.name))];
      colsRef.current = next;
      setCols(next);
      colSeq.current++;
      choose(made.id);
      writePick(member.id, made.id);
      setNewName("");
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 401) setLost(true);
      else setNewError(e instanceof ApiError && e.rejected === "name-taken" ? "You already have a collection called that." : "Something went wrong. Try again.");
    } finally {
      creating.current = false;
    }
  }

  if (member === null || lost) {
    return (
      <div className="pair-page">
        <h1>{APP_NAME}</h1>
        <SignIn returnTo={returnTo} />
      </div>
    );
  }

  const unavailable = problem !== null;
  return (
    <div className="pair-page">
      <h1>Pair a book</h1>
      {notice !== undefined && <p role="alert" className="refusal">{notice}</p>}
      {step === "isbn" && (
        <>
          <p>Scan the barcode on the back of the book.</p>
          {unavailable ? <p>{problemText[problem]}</p> : (
            <Scanner key="isbn" want="isbn" onProblem={setProblem} onRead={(r) => {
              if (r.kind !== "isbn") return;
              void look(r.isbn);
            }} />
          )}
          {unavailable ? <TypeForm typed={typed} isbn={isbn} onSubmit={onTyped} /> : (
            <p><button type="button" className="link" onClick={() => go("type")}>No barcode? Type it in</button></p>
          )}
        </>
      )}
      {step === "looking" && <p>Looking that up…</p>}
      {step === "copyloading" && <p>Looking that up…</p>}
      {step === "copyfailed" && (
        <>
          <p>We couldn't load that book.</p>
          <p><button type="button" onClick={() => copyId !== null && void loadCopy(copyId)}>Try again</button></p>
        </>
      )}
      {step === "cannot" && (
        <>
          {replace && copyId !== null ? (
            <>
              <p>This book's label can't be replaced here.</p>
              <p><a href={`/copies/${encodeURIComponent(copyId)}`}>Back to the book</a></p>
            </>
          ) : (
            <>
              <p>That book can't take a label here.</p>
              <p><a href="/">My books</a></p>
            </>
          )}
        </>
      )}
      {step === "confirm" && book !== null && (
        <>
          <Book title={book.title} authors={book.authors} coverUrl={book.coverUrl} />
          {imported?.collection && <p>From <Name>{imported.collection.name}</Name></p>}
          <p>Is this the book?</p>
          <p>
            <button type="button" onClick={() => {
              if (isbn === null) return;
              if (imported !== null) void chosen({ isbn }, { name: imported.collection?.name ?? null });
              else if (similar.length > 0) {
                setAfter({ isbn });
                go("similar");
              } else void chosen({ isbn }, null);
            }}>Yes</button>
            <button type="button" onClick={rescan}>No, scan again</button>
          </p>
        </>
      )}
      {step === "similar" && (
        <>
          <p>Is it one of these?</p>
          {similar.map((s) => (
            <div key={s.copyId}>
              <Book title={s.book.title} authors={s.book.authors} coverUrl={s.book.coverUrl} />
              {s.collection && <p>From <Name>{s.collection.name}</Name></p>}
              <p><button type="button" aria-label={`This one: ${s.book.title}`} onClick={() => void chosen({ copyId: s.copyId }, { name: s.collection?.name ?? null })}>This one</button></p>
            </div>
          ))}
          <p><button type="button" onClick={() => after !== null && void chosen(after, null)}>No, it's a different copy</button></p>
        </>
      )}
      {step === "miss" && (
        <>
          <p>We couldn't find that book.</p>
          <p>
            <button type="button" onClick={() => go("type")}>Type the title</button>
            <button type="button" onClick={rescan}>Scan again</button>
          </p>
        </>
      )}
      {step === "type" && <TypeForm typed={typed} isbn={isbn} onSubmit={onTyped} />}
      {step === "label" && pending !== null && (
        <>
          {forCopy !== null && <Book title={forCopy.title} authors={forCopy.authors} coverUrl={forCopy.coverUrl} />}
          {pending.stays !== null && pending.stays.name !== null && <p>It stays in <Name>{pending.stays.name}</Name>.</p>}
          {picking(pending) && cols !== null && (
            <>
              {stale && <p>The collection you used last is gone, so this goes in <Name>{cols.find((c) => c.id === defaultOf(cols))?.name ?? ""}</Name>.</p>}
              <p>
                <label htmlFor="pair-collection">Collection</label>
                <select id="pair-collection" value={pick} onChange={(e) => {
                  choose(e.target.value);
                  setStale(false);
                  setNewError(undefined);
                  if (e.target.value !== "new" && member !== null) writePick(member.id, e.target.value);
                }}>
                  {cols.map((c) => <option key={c.id} value={c.id} dir="auto">{c.name}</option>)}
                  <option value="new">New collection…</option>
                </select>
              </p>
              {pick === "new" && (
                <div>
                  <p>
                    <label htmlFor="pair-new-name">Name</label>
                    <input id="pair-new-name" type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                      aria-invalid={newError ? true : undefined} aria-describedby="pair-new-name-error" />
                    <span id="pair-new-name-error" className="field-error long">{newError}</span>
                  </p>
                  <p><button type="button" onClick={() => void create()}>Create</button></p>
                </div>
              )}
            </>
          )}
          {unknown(pending) && (
            <>
              <p>We couldn't load your collections.</p>
              <p><button type="button" onClick={() => void loadCollections()}>Try again</button></p>
            </>
          )}
          {!unknown(pending) && <p>Now scan a blank label.</p>}
          {unknown(pending) ? null : linked !== null ? (
            <p><button type="button" onClick={() => withLabel(linked, pending)}>Use this label</button></p>
          ) : (
            <>
              {unavailable ? <p>{problemText[problem]}</p> : (
                <Scanner key="label" want="label" onProblem={setProblem} onRead={(r) => {
                  if (r.kind !== "label") return;
                  const c = parseLabelLink(r.code);
                  if (c === null || c === refused.current) return;
                  refused.current = null;
                  withLabel(c, pending);
                }} />
              )}
              <CodeForm onCode={(c) => {
                refused.current = null;
                withLabel(c, pending);
              }} />
            </>
          )}
        </>
      )}
      {step === "replaceconfirm" && toReplace !== null && forCopy !== null && (
        <>
          <Book title={forCopy.title} authors={forCopy.authors} coverUrl={forCopy.coverUrl} />
          <p>Replace the label on <Name>{forCopy.title}</Name>?</p>
          <p className="label-code">Label {toReplace.label}</p>
          <p>
            <button type="button" onClick={() => void save(toReplace.label, toReplace.p, undefined)}>Replace</button>
            <button type="button" onClick={cancelReplace}>Cancel</button>
          </p>
        </>
      )}
      {step === "saving" && stays === null && <p>Saving…</p>}
      {step === "saving" && stays !== null && (
        <>
          <p role="status">This book was already in <Name>{stays.name}</Name>; it stays there.</p>
          <p><a className="button" href={`/b/${stays.label}`}>Open it</a></p>
        </>
      )}
      {step === "failed" && code !== null && pending !== null && (
        <p><button type="button" onClick={() => withLabel(code, pending)}>Try again</button></p>
      )}
      {step !== "isbn" && step !== "saving" && step !== "cannot" && step !== "copyloading" && (replace && copyId !== null ? (
        // Replace mode never opens the add flow: it cannot find a labelled copy, so it would make a second one.
        <p><a href={`/copies/${encodeURIComponent(copyId)}`}>Back to the book</a></p>
      ) : <p><button type="button" className="link" onClick={startOver}>Start over</button></p>)}
    </div>
  );
}

function TypeForm(props: { typed: Typed; isbn: string | null; onSubmit: (t: Typed, isbn: string) => void }) {
  const [title, setTitle] = useState(props.typed.title);
  const [author, setAuthor] = useState(props.typed.author);
  const [raw, setRaw] = useState(props.isbn ?? "");
  const [errors, setErrors] = useState<{ title?: string; isbn?: string }>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: { title?: string; isbn?: string } = {};
    const hasIsbn = raw.trim() !== "";
    if (hasIsbn && title.trim() === "" && toIsbn13(raw) === null) next.isbn = "That isn't a book ISBN.";
    if (!hasIsbn && title.trim() === "") next.title = "Type the title.";
    setErrors(next);
    if (next.title || next.isbn) return;
    props.onSubmit({ title: title.trim(), author: author.trim() }, raw);
  }

  return (
    <form onSubmit={submit} noValidate>
      <p>
        <label htmlFor="pair-title">Title</label>
        <input id="pair-title" type="text" maxLength={MAX_TITLE} value={title} onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined} aria-describedby="pair-title-error" />
        <span id="pair-title-error" className="field-error">{errors.title}</span>
      </p>
      <p>
        <label htmlFor="pair-author">Author</label>
        <input id="pair-author" type="text" maxLength={MAX_AUTHOR} value={author} onChange={(e) => setAuthor(e.target.value)} />
      </p>
      <p>
        <label htmlFor="pair-isbn">ISBN (optional)</label>
        <input id="pair-isbn" type="text" inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value)}
          aria-invalid={errors.isbn ? true : undefined} aria-describedby="pair-isbn-error" />
        <span id="pair-isbn-error" className="field-error">{errors.isbn}</span>
      </p>
      <p><button type="submit">Continue</button></p>
    </form>
  );
}

function CodeForm(props: { onCode: (code: string) => void }) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = parseLabelLink(raw);
    if (c === null) {
      setError("That isn't a label code.");
      return;
    }
    setError(undefined);
    props.onCode(c);
  }
  return (
    <form onSubmit={submit} noValidate>
      <p>
        <label htmlFor="pair-code">Or type the code printed under it</label>
        <input id="pair-code" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={raw}
          onChange={(e) => setRaw(e.target.value)} aria-invalid={error ? true : undefined}
          aria-describedby="pair-code-error" />
        <span id="pair-code-error" className="field-error">{error}</span>
      </p>
      <p><button type="submit">Use this code</button></p>
    </form>
  );
}
