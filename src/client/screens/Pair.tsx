import { useEffect, useRef, useState } from "react";
import type { BookInfo, Member } from "../../shared/types";
import { toIsbn13 } from "../../shared/isbn";
import { parseLabelLink } from "../../shared/labelCode";
import { addCopy, ApiError, lookupBook } from "../api";
import { Scanner, type ScannerProblem } from "../scanner";
import { Book } from "./BookCard";
import { SignIn } from "./SignIn";

const problemText: Record<ScannerProblem, string> = {
  "no-camera": "This device has no camera we can use.",
  denied: "Camera access was refused. You can allow it in your browser's settings, or type instead.",
  "decoder-failed": "The scanner couldn't start. Type instead.",
};

type Step = "isbn" | "looking" | "confirm" | "miss" | "type" | "label" | "saving" | "failed";
type Typed = { title: string; author: string };
// What gets saved is decided where the person decides it and passed along, never re-read from state.
type Payload = { isbn: string } | { title: string; authors: string[] };

export function Pair(props: { member: Member | null; returnTo: string }) {
  const { member, returnTo } = props;
  // The member prop was read once at load; a 401 means the session is gone.
  const [lost, setLost] = useState(false);
  const [step, setStep] = useState<Step>("isbn");
  const [isbn, setIsbn] = useState<string | null>(null);
  const [book, setBook] = useState<BookInfo | null>(null);
  const [typed, setTyped] = useState<Typed>({ title: "", author: "" });
  // A code from the address skips the label step until it is refused.
  const [linked, setLinked] = useState<string | null>(() => parseLabelLink(new URLSearchParams(location.search).get("label") ?? ""));
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState<Payload | null>(null);
  const [problem, setProblem] = useState<ScannerProblem | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const inFlight = useRef(false);
  const seq = useRef(0);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

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
    setNotice(undefined);
    go("isbn");
  }

  async function look(raw: string) {
    const mine = ++seq.current;
    setIsbn(raw);
    setNotice(undefined);
    go("looking");
    let found: BookInfo | null = null;
    try {
      found = (await lookupBook(raw)).book;
    } catch (e) {
      if (mine === seq.current && live.current && e instanceof ApiError && e.status === 401) {
        setLost(true);
        return;
      }
    }
    if (mine !== seq.current || !live.current) return;
    setBook(found);
    go(found ? "confirm" : "miss");
  }

  async function save(label: string, how: Payload) {
    if (inFlight.current) return;
    inFlight.current = true;
    const mine = seq.current;
    setCode(label);
    setNotice(undefined);
    go("saving");
    try {
      await addCopy({ code: label, ...how });
      // Stay in flight once saved: the page is leaving, and a second tap must not save again.
      if (mine === seq.current && live.current) location.assign(`/b/${label}`);
      return;
    } catch (e) {
      inFlight.current = false;
      if (mine !== seq.current || !live.current) return;
      const why = e instanceof ApiError ? e.rejected : null;
      if (e instanceof ApiError && e.status === 401) {
        setLost(true);
      } else if (why === "label-in-use" || why === "label-unknown") {
        setLinked(null);
        setCode(null);
        setNotice(why === "label-in-use" ? "That label is already on a book. Use a blank one." : "That isn't one of our labels.");
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

  const withLabel = (label: string, how: Payload) => void save(label, how);
  // Once the payload is chosen: save now if the label is known, otherwise ask for it.
  function chosen(how: Payload) {
    setNotice(undefined);
    setPending(how);
    if (linked !== null) withLabel(linked, how);
    else go("label");
  }
  const rescan = () => {
    setIsbn(null);
    setBook(null);
    go("isbn");
  };

  function onTyped(t: Typed, rawIsbn: string) {
    setTyped(t);
    // A title means the person chose to type the book; an ISBN alone is looked up.
    if (t.title !== "") {
      chosen({ title: t.title, authors: t.author ? [t.author] : [] });
      return;
    }
    const n = toIsbn13(rawIsbn);
    if (n !== null) void look(n);
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
      {step === "confirm" && book !== null && (
        <>
          <Book title={book.title} authors={book.authors} coverUrl={book.coverUrl} />
          <p>Is this the book?</p>
          <p>
            <button type="button" onClick={() => isbn !== null && chosen({ isbn })}>Yes</button>
            <button type="button" onClick={rescan}>No, scan again</button>
          </p>
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
      {step === "label" && (
        <>
          <p>Now scan a blank label.</p>
          {unavailable ? <p>{problemText[problem]}</p> : (
            <Scanner key="label" want="label" onProblem={setProblem} onRead={(r) => {
              if (r.kind !== "label") return;
              const c = parseLabelLink(r.code);
              if (c === null) setNotice("That isn't one of our labels.");
              else if (pending !== null) withLabel(c, pending);
            }} />
          )}
          <CodeForm onCode={(c) => pending !== null && withLabel(c, pending)} />
        </>
      )}
      {step === "saving" && <p>Saving…</p>}
      {step === "failed" && code !== null && pending !== null && (
        <p><button type="button" onClick={() => withLabel(code, pending)}>Try again</button></p>
      )}
      {step !== "isbn" && step !== "saving" && <p><button type="button" className="link" onClick={startOver}>Start over</button></p>}
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
        <input id="pair-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined} aria-describedby={errors.title ? "pair-title-error" : undefined} />
        {errors.title && <span id="pair-title-error" className="field-error">{errors.title}</span>}
      </p>
      <p>
        <label htmlFor="pair-author">Author</label>
        <input id="pair-author" type="text" value={author} onChange={(e) => setAuthor(e.target.value)} />
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
