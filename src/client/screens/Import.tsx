import { useEffect, useRef, useState } from "react";
import type { CollectionSummary, ImportRow, Member } from "../../shared/types";
import { cleanCollectionName } from "../../shared/collectionName";
import { ApiError, createCollection, importRows, myCollections } from "../api";
import { chunkRows, parseExport, type ParseResult } from "../storygraph";
import { Name } from "./BookCard";
import { APP_NAME } from "../shell";
import { SignIn } from "./SignIn";
import { useGuard } from "./useGuard";

// One collator for every sort: a new one per comparison is slow.
const COLLATOR = new Intl.Collator();
const GAP_MS = 1000; // between one chunk's answer and the next request
const RETRY_WAITS = [2000, 5000, 12000]; // an "unavailable" or unanswered chunk is asked again after each wait, then the run stops
const REQUEST_MS = 60000; // a chunk with no answer by then is cut off

type Outcome = { kind: "done"; added: number; skipped: number; listedTwice: number; into: { id: string; name: string } | null } | { kind: "stopped"; done: number };
type Loaded = { rows: ImportRow[]; skipped: { notOwned: number; notPhysical: number } };

const defaultOf = (list: CollectionSummary[]) => (list.find((c) => c.isDefault) ?? list[0])?.id ?? "";

export function Import({ member, returnTo }: { member: Member | null; returnTo: string }) {
  const [lost, setLost] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [garbled, setGarbled] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [cols, setCols] = useState<CollectionSummary[] | null>(null);
  const [colsFailed, setColsFailed] = useState(false);
  const [pick, setPick] = useState("");
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [newName, setNewName] = useState("");
  const [newError, setNewError] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<{ added: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const { busy, guard, live } = useGuard();
  const picked = useRef("");
  const fileSeq = useRef(0);
  const colSeq = useRef(0);
  const creating = useRef(false);
  const sleeps = useRef(new Set<{ timer: ReturnType<typeof setTimeout>; wake: () => void }>());
  const request = useRef<AbortController | null>(null);

  // Leaving the page ends any wait, so a run never sends once its page is gone.
  useEffect(() => {
    const waiting = sleeps.current;
    return () => {
      for (const s of waiting) {
        clearTimeout(s.timer);
        s.wake();
      }
      waiting.clear();
      request.current?.abort();
    };
  }, []);

  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const entry = { timer: setTimeout(() => {
        sleeps.current.delete(entry);
        resolve();
      }, ms), wake: resolve };
      sleeps.current.add(entry);
    });
  }

  const choose = (id: string) => {
    picked.current = id;
    setPick(id);
  };

  // The member's collections, read when the page opens and again just before a run: a once-read list goes stale.
  // Returns the list now known, or null when it could not be read and none was known before.
  async function loadCollections(): Promise<CollectionSummary[] | null | "lost"> {
    const mine = ++colSeq.current;
    try {
      const { collections } = await myCollections();
      if (!live.current || mine !== colSeq.current) return cols;
      setCols(collections);
      setColsFailed(false);
      if (!collections.some((c) => c.id === picked.current) && picked.current !== "new") choose(defaultOf(collections));
      return collections;
    } catch (e) {
      if (!live.current || mine !== colSeq.current) return cols;
      if (e instanceof ApiError && e.status === 401) {
        setLost(true);
        return "lost";
      }
      if (cols === null) setColsFailed(true);
      return cols;
    }
  }

  useEffect(() => {
    if (member !== null) void loadCollections();
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const mine = ++fileSeq.current;
    setParsed(null);
    setOutcome(null);
    setProgress(null);
    setNotice(undefined);
    setReadFailed(false);
    setGarbled(false);
    try {
      const bytes = await file.arrayBuffer();
      if (!live.current || mine !== fileSeq.current) return;
      // Warn only on bytes that aren't UTF-8: a "\uFFFD" already in the export (StoryGraph has some) is not a sign of a wrong encoding.
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder("utf-8").decode(bytes);
        setGarbled(true);
      }
      setParsed(parseExport(text));
    } catch {
      if (live.current && mine === fileSeq.current) setReadFailed(true);
    }
  }

  async function create() {
    if (creating.current) return;
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
      const rest = (cols ?? []).filter((c) => c.id !== made.id);
      setCols([...rest.filter((c) => c.isDefault), ...[...rest.filter((c) => !c.isDefault), made].sort((x, y) => COLLATOR.compare(x.name, y.name))]);
      choose(made.id);
      setNewName("");
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 401) setLost(true);
      else setNewError(e instanceof ApiError && e.rejected === "name-taken" ? "You already have a collection called that." : "Something went wrong. Try again.");
    } finally {
      creating.current = false;
    }
  }

  // One request, asked again after a wait while the server says its lookup was unavailable or nothing answered
  // within REQUEST_MS. Returns the answer, or null when the run must stop (a lost session shows sign-in instead).
  async function send(collectionId: string | null, rows: ImportRow[]) {
    for (let attempt = 0; ; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), REQUEST_MS);
      request.current = ctl;
      try {
        return await importRows(collectionId, rows, ctl.signal);
      } catch (e) {
        if (!live.current) return null;
        if (e instanceof ApiError && e.status === 401) {
          setLost(true);
          return null;
        }
        const unavailable = e instanceof ApiError && e.status === 503 && e.rejected === "unavailable";
        const timedOut = ctl.signal.aborted && !(e instanceof ApiError);
        if (!(unavailable || timedOut) || attempt >= RETRY_WAITS.length) return null;
      } finally {
        clearTimeout(timer);
        if (request.current === ctl) request.current = null;
      }
      setWaiting(true);
      await sleep(RETRY_WAITS[attempt]);
      setWaiting(false);
      if (!live.current) return null;
    }
  }

  function run(loaded: Loaded) {
    return guard(async () => {
      setNotice(undefined);
      setOutcome(null);
      const wanted = picked.current;
      const list = await loadCollections();
      if (list === "lost" || !live.current) return;
      if (list === null) return; // the "couldn't load" message is showing
      if (wanted === "new") {
        setNotice("Create the new collection first, or pick another.");
        return;
      }
      if (wanted !== "" && !list.some((c) => c.id === wanted)) {
        // Deleted since the list was read: loadCollections has moved the pick to the default; the person confirms.
        setNotice("That collection is gone. Check where these books go, then press Import again.");
        return;
      }
      // From the list as it is now: with no collection yet the server files into the default, so the id is null, never "".
      const target: string | null = list.length > 0 ? picked.current : null;
      const total = loaded.rows.length;
      const chunks = chunkRows(loaded.rows);
      let added = 0;
      let skipped = 0;
      let done = 0;
      // Rows that repeat an earlier row in the file are always skipped by the server; they are counted apart from books already held.
      const seen = new Set<string>();
      let listedTwice = 0;
      for (const r of loaded.rows) {
        const key = r.isbn ?? JSON.stringify([r.title, r.authors]);
        if (seen.has(key)) listedTwice++;
        seen.add(key);
      }
      setProgress({ added: 0, total });
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) {
          await sleep(GAP_MS);
          if (!live.current) return;
        }
        const r = await send(target, chunks[i]);
        if (!live.current) return;
        if (r === null) {
          setProgress(null);
          // A lost session shows sign-in instead; anything else is a stopped run.
          setOutcome({ kind: "stopped", done });
          return;
        }
        added += r.added;
        skipped += r.skipped;
        done += chunks[i].length;
        setProgress({ added, total });
      }
      const into = list.find((c) => c.id === target) ?? list.find((c) => c.isDefault) ?? null;
      setProgress(null);
      setOutcome({ kind: "done", added, skipped, listedTwice, into: into && { id: into.id, name: into.name } });
    });
  }

  const heading = <h1>Import from StoryGraph</h1>;
  if (member === null || lost) {
    return (
      <div className="import-page">
        <h1>{APP_NAME}</h1>
        <SignIn returnTo={returnTo} />
      </div>
    );
  }

  const ready: Loaded | null = parsed !== null && parsed.ok ? { rows: parsed.rows, skipped: parsed.skipped } : null;
  const needsList = cols === null;
  const total = ready?.rows.length ?? 0;

  return (
    <div className="import-page">
      {heading}
      <p>Pick the file you exported from StoryGraph. It is read on this device; only each book's title, authors and ISBN are sent.</p>
      <p>
        <label htmlFor="import-file">StoryGraph export (.csv)</label>
        <input id="import-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void onFile(e)} />
      </p>
      {readFailed && <p role="alert" className="refusal">We couldn't read that file.</p>}
      {parsed !== null && !parsed.ok && (
        <p role="alert" className="refusal">This doesn't look like a StoryGraph export. Missing: {parsed.missing.join(", ")}.</p>
      )}
      {garbled && <p role="alert" className="refusal">This file doesn't look like UTF-8; some titles may be garbled.</p>}
      {ready !== null && (
        <>
          <p>{total} {total === 1 ? "book" : "books"} to import.</p>
          {ready.skipped.notOwned > 0 && <p>{ready.skipped.notOwned} not marked owned.</p>}
          {ready.skipped.notPhysical > 0 && <p>{ready.skipped.notPhysical} digital or audio skipped.</p>}
          {colsFailed && needsList && (
            <>
              <p role="alert" className="refusal">We couldn't load your collections.</p>
              <p><button type="button" onClick={() => void loadCollections()}>Try again</button></p>
            </>
          )}
          {cols !== null && cols.length > 0 && (
            <>
              <p>
                <label htmlFor="import-collection">Into</label>
                <select id="import-collection" value={pick} disabled={busy} onChange={(e) => {
                  choose(e.target.value);
                  setNewError(undefined);
                  setNotice(undefined);
                }}>
                  {cols.map((c) => <option key={c.id} value={c.id} dir="auto">{c.name}</option>)}
                  <option value="new">New collection…</option>
                </select>
              </p>
              {pick === "new" && (
                <div>
                  <p>
                    <label htmlFor="import-new-name">Name</label>
                    <input id="import-new-name" type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                      aria-invalid={newError ? true : undefined} aria-describedby={newError ? "import-new-name-error" : undefined} />
                    {newError && <span id="import-new-name-error" className="field-error">{newError}</span>}
                  </p>
                  <p><button type="button" onClick={() => void create()}>Create</button></p>
                </div>
              )}
            </>
          )}
          {notice !== undefined && <p role="alert" className="refusal">{notice}</p>}
          {!needsList && total > 0 && outcome?.kind !== "done" && (
            <p><button type="button" disabled={busy} onClick={() => void run(ready)}>Import</button></p>
          )}
        </>
      )}
      {progress !== null && <p role="status">Added {progress.added} of {progress.total}…</p>}
      {waiting && <p role="status">Waiting to try again…</p>}
      {outcome?.kind === "done" && (
        <>
          <p role="status">
            Added {outcome.added}. {Math.max(0, outcome.skipped - outcome.listedTwice)} were already in your books.
            {outcome.listedTwice > 0 && ` ${outcome.listedTwice} listed twice in the file.`}
          </p>
          <p>
            {outcome.into !== null
              ? <a className="button" href={`/collections/${encodeURIComponent(outcome.into.id)}`}>Open <Name>{outcome.into.name}</Name></a>
              : <a className="button" href="/mine">My books</a>}
          </p>
        </>
      )}
      {outcome?.kind === "stopped" && (
        <p role="alert" className="refusal">
          Stopped after {outcome.done} of {total}. Import the same file again to carry on; books already added are skipped.
        </p>
      )}
    </div>
  );
}
