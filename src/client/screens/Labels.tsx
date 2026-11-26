import { flushSync } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Member, SheetSummary } from "../../shared/types";
import { ApiError, listSheets, mintLabels, sheetLabels } from "../api";
import { DEFAULT_SHEET_ID, perSheet, SHEETS, Sheet, validate, type Nudge, type SheetLayout } from "../labelsheet";
import { SignIn } from "./SignIn";

const STORAGE_KEY = "labels.settings";
const CUSTOM = "custom";
const NUDGES = Array.from({ length: 21 }, (_, i) => -5 + i * 0.5);

type Made = { code: string; url: string };
const FIELDS = [
  ["pageW", "Page width"], ["pageH", "Page height"], ["labelW", "Label width"], ["labelH", "Label height"],
  ["columns", "Columns"], ["rows", "Rows"], ["top", "Top margin"], ["left", "Left margin"],
  ["pitchX", "Distance across to the next label"], ["pitchY", "Distance down to the next label"],
] as const;
type Field = (typeof FIELDS)[number][0];
type Custom = Record<Field, string> & { shape: "rectangle" | "round" };

const START: Custom = {
  shape: "rectangle", pageW: "8.5", pageH: "11", labelW: "1", labelH: "1", columns: "6", rows: "8",
  top: "0.625", left: "0.625", pitchX: "1.25", pitchY: "1.25",
};

function customLayout(c: Custom): SheetLayout {
  const n = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
  return {
    id: CUSTOM, name: "Custom sheet", source: "typed from the sheet's packaging",
    page: { widthIn: n(c.pageW), heightIn: n(c.pageH) }, shape: c.shape,
    label: { widthIn: n(c.labelW), heightIn: n(c.labelH) },
    columns: n(c.columns), rows: n(c.rows), marginTopIn: n(c.top), marginLeftIn: n(c.left),
    pitchXIn: n(c.pitchX), pitchYIn: n(c.pitchY),
  };
}

type Settings = { sheetId: string; nudge: Nudge; custom: Custom };

function readSettings(): Settings {
  const fresh: Settings = { sheetId: DEFAULT_SHEET_ID, nudge: { xMm: 0, yMm: 0 }, custom: START };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return fresh;
    const saved = JSON.parse(raw) as { sheetId?: unknown; nudge?: { xMm?: unknown; yMm?: unknown }; custom?: Record<string, unknown> } | null;
    const sheetId = typeof saved?.sheetId === "string" && (saved.sheetId === CUSTOM || SHEETS.some((s) => s.id === saved.sheetId))
      ? saved.sheetId : fresh.sheetId;
    const step = (v: unknown) => (typeof v === "number" && NUDGES.includes(v) ? v : 0);
    const custom = { ...START };
    if (saved?.custom && typeof saved.custom === "object") {
      for (const [key] of FIELDS) if (typeof saved.custom[key] === "string") custom[key] = saved.custom[key];
      if (saved.custom.shape === "round") custom.shape = "round";
    }
    return { sheetId, nudge: { xMm: step(saved?.nudge?.xMm), yMm: step(saved?.nudge?.yMm) }, custom };
  } catch {
    return fresh;
  }
}

function writeSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage may be blocked; the page works without remembering.
  }
}

export function Labels(props: { member: Member | null; returnTo: string }) {
  const { member, returnTo } = props;
  const [lost, setLost] = useState(false);
  const [saved] = useState(readSettings);
  const [sheetId, setSheetId] = useState(saved.sheetId);
  const [nudge, setNudge] = useState(saved.nudge);
  const [custom, setCustom] = useState(saved.custom);
  const [sheetCount, setSheetCount] = useState(1);
  const [labels, setLabels] = useState<Made[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A run of sheets that stopped part way: the sheets made so far are kept and the rest can be made.
  const [partial, setPartial] = useState<{ made: number; total: number } | null>(null);
  const [aligning, setAligning] = useState(false);
  // Set when labels are on the page and ready to print; the effect below prints once they are in the DOM.
  const [printSoon, setPrintSoon] = useState(false);
  // The labels shown came from a past sheet, not a new run.
  const [reprint, setReprint] = useState(false);
  const [reprintNote, setReprintNote] = useState<"empty" | "failed" | null>(null);
  // The sheet whose reprint had nothing to print, so the note can say whether the checkbox would change that.
  const [emptySheet, setEmptySheet] = useState<string | null>(null);
  const [includeMine, setIncludeMine] = useState(false);
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [listFailed, setListFailed] = useState(false);
  const inFlight = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => writeSettings({ sheetId, nudge, custom }), [sheetId, nudge, custom]);

  async function refreshSheets() {
    try {
      const { sheets: list } = await listSheets();
      if (!live.current) return;
      setSheets(list);
      setListFailed(false);
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 401) setLost(true);
      else setListFailed(true);
    }
  }
  const signedIn = member !== null;
  useEffect(() => {
    if (signedIn) void refreshSheets();
  }, [signedIn]);

  const layout = useMemo(
    () => (sheetId === CUSTOM ? customLayout(custom) : SHEETS.find((s) => s.id === sheetId) ?? SHEETS[0]!),
    [sheetId, custom],
  );
  const problems = useMemo(() => validate(layout), [layout]);
  // Runs after commit, so the labels are in the DOM. A layout that went invalid while the request was out
  // drops the pending print; the Print button stays.
  useEffect(() => {
    if (!printSoon) return;
    setPrintSoon(false);
    if (problems.length === 0) window.print();
  }, [printSoon, problems]);

  async function make() {
    if (inFlight.current || problems.length > 0) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    setReprintNote(null);
    // After a failure part way, go on from where it stopped; otherwise start a fresh run.
    const resume = partial !== null && partial.total === sheetCount ? partial : null;
    const total = sheetCount;
    let made = resume?.made ?? 0;
    let kept: Made[] = resume ? labels : [];
    try {
      for (; made < total; made++) {
        kept = [...kept, ...(await mintLabels(perSheet(layout))).labels];
        if (live.current) {
          setLabels(kept);
          setReprint(false);
        }
      }
      if (live.current) {
        setPartial(null);
        setPrintSoon(true);
      }
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 401) setLost(true);
      else {
        setFailed(true);
        setPartial(made > 0 ? { made, total } : null);
      }
    } finally {
      inFlight.current = false;
      if (live.current) {
        setBusy(false);
        void refreshSheets();
      }
    }
  }

  async function printAgain(id: string) {
    if (inFlight.current || problems.length > 0) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    setPartial(null);
    setReprintNote(null);
    try {
      const { labels: again } = await sheetLabels(id, includeMine);
      if (!live.current) return;
      if (again.length === 0) {
        setReprintNote("empty");
        setEmptySheet(id);
      }
      else {
        setLabels(again);
        setReprint(true);
        setPrintSoon(true);
      }
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 401) setLost(true);
      else setReprintNote("failed");
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }

  function alignmentTest() {
    // Show only the outlines while the print dialog is open, then put the sheets back.
    flushSync(() => setAligning(true));
    try {
      window.print();
    } finally {
      setAligning(false);
    }
  }

  const heading = <h1>Natalie's Little Library</h1>;
  if (member === null || lost) {
    return (
      <div className="labels-page">
        {heading}
        <SignIn returnTo={returnTo} />
      </div>
    );
  }

  const set = (key: keyof Custom, value: string) => setCustom({ ...custom, [key]: value });
  return (
    <div className="labels-page">
      {heading}
      <p>
        <label htmlFor="labels-sheet">Label sheet</label>
        <select id="labels-sheet" value={sheetId} onChange={(e) => setSheetId(e.target.value)}>
          {SHEETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value={CUSTOM}>Custom sheet</option>
        </select>
      </p>
      {sheetId === CUSTOM && (
        <fieldset className="custom-sheet">
          <legend>Custom sheet (sizes in inches)</legend>
          <p>
            <label htmlFor="custom-shape">Shape</label>
            <select id="custom-shape" value={custom.shape} onChange={(e) => set("shape", e.target.value === "round" ? "round" : "rectangle")}>
              <option value="rectangle">Rectangle</option>
              <option value="round">Round</option>
            </select>
          </p>
          {FIELDS.map(([key, text]) => (
            <p key={key}>
              <label htmlFor={`custom-${key}`}>{text}</label>
              <input id={`custom-${key}`} type="text" inputMode="decimal" value={custom[key]} onChange={(e) => set(key, e.target.value)} />
            </p>
          ))}
        </fieldset>
      )}
      {problems.length > 0 && (
        <ul className="refusal" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      <p>
        <label htmlFor="labels-count">How many sheets?</label>
        <select id="labels-count" value={sheetCount} onChange={(e) => setSheetCount(Number(e.target.value))}>
          {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </p>
      <p>
        <button type="button" disabled={busy || problems.length > 0} onClick={() => void make()}>Make labels</button>
      </p>
      {failed && <p role="alert" className="refusal">Couldn't make labels. Try again.</p>}
      {failed && partial !== null && <p>{partial.made} of {partial.total} sheets {partial.made === 1 ? "was" : "were"} made.</p>}
      {labels.length > 0 && !reprint && <p>These labels now exist. If you don't print them, they simply go unused.</p>}
      <p>Print from a computer, at 100%, not "fit to page", on Letter paper.</p>
      <p>
        <button type="button" disabled={labels.length === 0 || problems.length > 0} onClick={() => window.print()}>Print</button>
      </p>
      {(sheets.length > 0 || listFailed) && (
        <section className="previous-sheets">
          <h2>Previous sheets</h2>
          {listFailed && <p role="alert" className="refusal">Couldn't load your previous sheets.</p>}
          {sheets.length > 0 && (
            <>
              <p>
                <input id="labels-mine" type="checkbox" checked={includeMine} onChange={(e) => setIncludeMine(e.target.checked)} />
                <label htmlFor="labels-mine">Also print labels already on my books</label>
              </p>
              <ul>
                {sheets.map((s) => (
                  <li key={s.id}>
                    {new Date(s.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {s.total} {s.total === 1 ? "label" : "labels"}, {s.blank} blank, {s.mine} on your books{" "}
                    <button type="button" disabled={busy || problems.length > 0} onClick={() => void printAgain(s.id)}>Print again</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {reprintNote === "empty" && <p>Every label on that sheet is already on a book.</p>}
          {reprintNote === "empty" && !includeMine && (sheets.find((s) => s.id === emptySheet)?.mine ?? 0) > 0 && (
            <p>Tick 'Also print labels already on my books' to print those.</p>
          )}
          {reprintNote === "failed" && <p role="alert" className="refusal">Couldn't load that sheet. Try again.</p>}
        </section>
      )}
      <fieldset className="nudge">
        <legend>If the print lands off the sheet</legend>
        <p>
          <label htmlFor="nudge-x">Nudge right/left</label>
          <select id="nudge-x" value={nudge.xMm} aria-describedby="nudge-help" onChange={(e) => setNudge({ ...nudge, xMm: Number(e.target.value) })}>
            {NUDGES.map((v) => <option key={v} value={v}>{v} mm</option>)}
          </select>
        </p>
        <p>
          <label htmlFor="nudge-y">Nudge down/up</label>
          <select id="nudge-y" value={nudge.yMm} aria-describedby="nudge-help" onChange={(e) => setNudge({ ...nudge, yMm: Number(e.target.value) })}>
            {NUDGES.map((v) => <option key={v} value={v}>{v} mm</option>)}
          </select>
        </p>
        <p id="nudge-help">Millimetres. Positive moves the print right and down.</p>
        <p>
          <button type="button" disabled={problems.length > 0} onClick={alignmentTest}>Print an alignment test</button>
        </p>
        <p>It prints only the label outlines, on plain paper. Hold it against a real sheet before using one.</p>
      </fieldset>
      <div className="sheet-area">
        {aligning
          ? <Sheet labels={[]} layout={layout} nudge={nudge} outlinesOnly />
          : problems.length === 0 && <Sheet labels={labels} layout={layout} nudge={nudge} />}
      </div>
    </div>
  );
}
