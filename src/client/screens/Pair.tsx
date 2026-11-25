import { useEffect, useRef, useState } from "react";
import type { BookInfo, CollectionSummary, Member, ShelfItem } from "../../shared/types";
import { cleanCollectionName } from "../../shared/collectionName";
import { toIsbn13 } from "../../shared/isbn";
import { parseLabelLink } from "../../shared/labelCode";
import { addCopy, ApiError, createCollection, getCandidates, getCopy, labelCopy, lookupBook, myCollections } from "../api";
import { Scanner, type ScannerProblem } from "../scanner";
import { Book, Name } from "./BookCard";
import { SignIn } from "./SignIn";

const problemText: Record<ScannerProblem, string> = {
  "no-camera": "This device has no camera we can use.",
  denied: "Camera access was refused. You can allow it in your browser's settings, or type instead.",
  "decoder-failed": "The scanner couldn't start. Type instead.",
};

type Step = "isbn" | "looking" | "confirm" | "similar" | "miss" | "type" | "label" | "saving" | "failed" | "copyloading" | "copyfailed" | "cannot";
// The server's limits (bookFacts.ts), counted in code points; maxLength counts UTF-16 units, so it can only be stricter.
const MAX_TITLE = 300;
const MAX_AUTHOR = 200;

type Typed = { title: string; author: string };
// What gets saved is decided where the person decides it and passed along, never re-read from state.
type Payload = { isbn: string } | { title: string; authors: string[] } | { copyId: string };
// `stays` is null for a new copy; otherwise the collection an existing copy stays in (name null when it has none).
type Pending = { how: Payload; stays: { name: string | null } | null };

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

  // The member's collections, read again whenever a choice is about to be made: a once-read list goes stale.
  async function loadCollections(gone = false) {
    if (member === null) return;
    const mine = ++colSeq.current;
    const r = await soft(myCollections());
    if (mine !== colSeq.current || !live.current) return;
    if (r === LOST) {
      setLost(true);
      return;
    }
    if (r === null) {
      setCols(null);
      return;
    }
    const list = r.collections;
    const has = (id: string) => list.some((c) => c.id === id);
    setCols(list);
    if (has(pickRef.current)) return;
    const stored = gone ? null : readPick(member.id);
    if (stored !== null && has(stored)) {
      choose(stored);
      setStale(false);
    } else {
      choose(defaultOf(list));
      setStale(stored !== null);
    }
  }

  useEffect(() => {
    if (copyId === null) void loadCollections();
    else void loadCopy(copyId);
  }, []);

  async function loadCopy(id: string) {
    const mine = ++seq.current;
    setNotice(undefined);
    go("copyloading");
    try {
      const view = await getCopy(id);
      if (mine !== seq.current || !live.current) return;
      if (!view.actions.includes("label")) {
        go("cannot");
        return;
      }
      setForCopy(view.book);
      chosen({ copyId: id }, { name: view.collection?.name ?? null });
    } catch (e) {
      if (mine !== seq.current || !live.current) return;
      if (e instanceof ApiError && e.status === 401) setLost(true);
      else if (e instanceof ApiError && (e.status === 404 || e.rejected === "not-found")) go("cannot");
      else go("copyfailed");
    }
  }

  const picking = (p: Pending) => p.stays === null && cols !== null && cols.length >= 2;

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
    go("saving");
    try {
      if ("copyId" in p.how) await labelCopy(p.how.copyId, label);
      else await addCopy({ code: label, ...p.how, ...(collectionId !== undefined ? { collectionId } : {}) });
      if (collectionId !== undefined && member !== null) writePick(member.id, collectionId);
      // Stay in flight once saved: the page is leaving, and a second tap must not save again.
      if (mine === seq.current && live.current) location.assign(`/b/${label}`);
      return;
    } catch (e) {
      inFlight.current = false;
      if (mine !== seq.current || !live.current) return;
      const why = e instanceof ApiError ? e.rejected : null;
      const existing = "copyId" in p.how;
      if (e instanceof ApiError && e.status === 401) {
        setLost(true);
      } else if (why === "label-in-use" || why === "label-unknown") {
        setLinked(null);
        setCode(null);
        refused.current = label;
        setNotice(why === "label-in-use" ? "That label is already on a book. Use a blank one." : "That isn't one of our labels.");
        go("label");
      } else if (existing && why === "not-allowed") {
        startOver();
        setNotice("That book already has a label.");
      } else if (existing && why === "not-found") {
        go("cannot");
      } else if (!existing && why === "not-found") {
        // The collection was deleted since the list was read: read it again and ask again, keeping the label and book.
        void loadCollections(true);
        setNotice("That collection was just deleted. Pick another.");
        go("label");
      } else if (why === "book-not-found") {
        setNotice("We couldn't find that book. Type the title instead.");
        go("type");
      } else {
        setNotice("Something went wrong saving that. Try again.");
        go("failed");
      }
    }
  }

  // The collection for a new copy comes from the pick the person made; an existing copy stays where it is.
  function withLabel(label: string, p: Pending) {
    const target = picking(p) ? pickRef.current : undefined;
    if (target === "new") {
      setNotice("Create the new collection first, or pick another.");
      return;
    }
    void save(label, p, target);
  }
  // Once the payload is chosen: save now if the label is known (and no collection needs asking), otherwise ask for it.
  function chosen(how: Payload, stays: Pending["stays"]) {
    const p: Pending = { how, stays };
    setNotice(undefined);
    setPending(p);
    if (stays === null) void loadCollections();
    if (linked !== null && !picking(p)) withLabel(linked, p);
    else go("label");
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
        chosen(how, null);
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
    setNewError(undefined);
    try {
      const made = await createCollection(clean.name);
      if (!live.current) return;
      setCols((prev) => {
        const rest = (prev ?? []).filter((c) => c.id !== made.id);
        const home = rest.filter((c) => c.isDefault);
        return [...home, ...[...rest.filter((c) => !c.isDefault), made].sort((x, y) => x.name.localeCompare(y.name))];
      });
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

  const heading = <h1>Natalie's Little Library</h1>;
  if (member === null || lost) {
    return (
      <div className="pair-page">
        {heading}
        <SignIn returnTo={returnTo} />
      </div>
    );
  }

  const unavailable = problem !== null;
  return (
    <div className="pair-page">
      {heading}
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
          <p>That book can't take a label here.</p>
          <p><a href="/mine">My books</a></p>
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
              if (imported !== null) chosen({ isbn }, { name: imported.collection?.name ?? null });
              else if (similar.length > 0) {
                setAfter({ isbn });
                go("similar");
              } else chosen({ isbn }, null);
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
              <p><button type="button" aria-label={`This one: ${s.book.title}`} onClick={() => chosen({ copyId: s.copyId }, { name: s.collection?.name ?? null })}>This one</button></p>
            </div>
          ))}
          <p><button type="button" onClick={() => after !== null && chosen(after, null)}>No, it's a different copy</button></p>
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
                  setNewError(undefined);
                  if (e.target.value !== "new" && member !== null) writePick(member.id, e.target.value);
                }}>
                  {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="new">New collection…</option>
                </select>
              </p>
              {pick === "new" && (
                <div>
                  <p>
                    <label htmlFor="pair-new-name">Name</label>
                    <input id="pair-new-name" type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                      aria-invalid={newError ? true : undefined} aria-describedby={newError ? "pair-new-name-error" : undefined} />
                    {newError && <span id="pair-new-name-error" className="field-error">{newError}</span>}
                  </p>
                  <p><button type="button" onClick={() => void create()}>Create</button></p>
                </div>
              )}
            </>
          )}
          <p>Now scan a blank label.</p>
          {linked !== null ? (
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
      {step === "saving" && <p>Saving…</p>}
      {step === "failed" && code !== null && pending !== null && (
        <p><button type="button" onClick={() => withLabel(code, pending)}>Try again</button></p>
      )}
      {step !== "isbn" && step !== "saving" && step !== "cannot" && step !== "copyloading" && <p><button type="button" className="link" onClick={startOver}>Start over</button></p>}
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
          aria-invalid={errors.title ? true : undefined} aria-describedby={errors.title ? "pair-title-error" : undefined} />
        {errors.title && <span id="pair-title-error" className="field-error">{errors.title}</span>}
      </p>
      <p>
        <label htmlFor="pair-author">Author</label>
        <input id="pair-author" type="text" maxLength={MAX_AUTHOR} value={author} onChange={(e) => setAuthor(e.target.value)} />
      </p>
      <p>
        <label htmlFor="pair-isbn">ISBN (optional)</label>
        <input id="pair-isbn" type="text" inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value)}
          aria-invalid={errors.isbn ? true : undefined} aria-describedby={errors.isbn ? "pair-isbn-error" : undefined} />
        {errors.isbn && <span id="pair-isbn-error" className="field-error">{errors.isbn}</span>}
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
          aria-describedby={error ? "pair-code-error" : undefined} />
        {error && <span id="pair-code-error" className="field-error">{error}</span>}
      </p>
      <p><button type="submit">Use this code</button></p>
    </form>
  );
}
