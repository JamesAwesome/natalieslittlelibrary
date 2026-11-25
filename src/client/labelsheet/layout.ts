export type SheetLayout = {
  id: string; // "avery-94103"
  name: string; // shown in the picker: "Avery 94103 · 1 × 1 in square · 48 per sheet"
  source: string; // where the measurements came from
  page: { widthIn: number; heightIn: number };
  shape: "rectangle" | "round";
  label: { widthIn: number; heightIn: number };
  columns: number;
  rows: number;
  marginTopIn: number;
  marginLeftIn: number;
  pitchXIn: number;
  pitchYIn: number; // label size plus the gap to the next one
  cutMarks?: boolean; // plain paper only: faint lines to cut along
};

export const MAX_PER_SHEET = 100;
// Template rounding (Avery's own PDFs differ from nominal sizes by a few thousandths of an inch).
const TOLERANCE_IN = 0.005;
const MIN_QR_IN = 0.6;
const TEXT_MIN_SIDE_IN = 0.9;

export function perSheet(layout: SheetLayout): number {
  return layout.columns * layout.rows;
}

export function positions(layout: SheetLayout): { leftIn: number; topIn: number }[] {
  const spots: { leftIn: number; topIn: number }[] = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.columns; c++) {
      spots.push({ leftIn: layout.marginLeftIn + c * layout.pitchXIn, topIn: layout.marginTopIn + r * layout.pitchYIn });
    }
  }
  return spots;
}

export type CodeBox = {
  qrIn: number;
  showText: boolean;
  // Where the code sits, measured from the label's top-left corner.
  qrLeftIn: number;
  qrTopIn: number;
  // The code text (only meaningful when showText): top edge, line height and widest extent.
  textTopIn: number;
  textHeightIn: number;
  textWidthIn: number;
};

const TEXT_HEIGHT_IN = 6 / 72; // 6 pt, line-height 1
const TEXT_WIDTH_IN = (10 * 0.6 * 6) / 72; // ten monospace characters at 6 pt
const EDGE_CLEAR_IN = 1.5 / 25.4; // the code, and its text, stay 1.5 mm from the cut
const ROUND_TEXT_MIN_IN = 1.5; // smaller round labels carry no text: the code stays centred and clear of the cut
const QUIET_MODULES = 2; // clear space between the code and its text, in modules
const DEFAULT_MODULES = 29; // a version-3 code, which a 38-character link makes

// The printed code for a label of this shape and size, or null if the label is too small to carry one.
// `modules` is the code's real width in modules, used to size the space above the text.
export function codeBox(layout: SheetLayout, modules: number = DEFAULT_MODULES): CodeBox | null {
  const { widthIn: w, heightIn: h } = layout.label;
  const side = Math.min(w, h);
  const qrIn = (layout.shape === "round" ? 0.62 : 0.72) * side;
  // Written so that a NaN size fails the test and the label is refused.
  if (!(qrIn >= MIN_QR_IN)) return null;

  const centred = { qrLeftIn: (w - qrIn) / 2, qrTopIn: (h - qrIn) / 2 };
  const noText = { ...centred, qrIn, showText: false, textTopIn: 0, textHeightIn: 0, textWidthIn: 0 };
  if (side < TEXT_MIN_SIDE_IN) return noText;

  const gap = (QUIET_MODULES * qrIn) / modules;
  if (layout.shape === "round") {
    if (side < ROUND_TEXT_MIN_IN) return noText;
    // The code stays centred; the text goes below it, and must sit inside the circle with clearance.
    const textTopIn = centred.qrTopIn + qrIn + gap;
    const r = w / 2;
    const corner = Math.hypot(TEXT_WIDTH_IN / 2, textTopIn + TEXT_HEIGHT_IN - r);
    if (r - corner < EDGE_CLEAR_IN) return noText;
    return { ...centred, qrIn, showText: true, textTopIn, textHeightIn: TEXT_HEIGHT_IN, textWidthIn: TEXT_WIDTH_IN };
  }
  // Rectangle: code, gap and text are centred together; if that leaves too little room, drop the text, not the code.
  const group = qrIn + gap + TEXT_HEIGHT_IN;
  const top = (h - group) / 2;
  if (top < EDGE_CLEAR_IN || TEXT_WIDTH_IN > w - 2 * EDGE_CLEAR_IN) return noText;
  return {
    qrIn, showText: true, qrLeftIn: centred.qrLeftIn, qrTopIn: top,
    textTopIn: top + qrIn + gap, textHeightIn: TEXT_HEIGHT_IN, textWidthIn: TEXT_WIDTH_IN,
  };
}

export function validate(layout: SheetLayout): string[] {
  const { page, label } = layout;
  const wholeCounts = [layout.columns, layout.rows].every((n) => Number.isInteger(n) && n >= 1);
  if (!wholeCounts) return ["There must be at least one column and one row of labels."];
  const sizes = [
    page.widthIn, page.heightIn, label.widthIn, label.heightIn,
    layout.marginTopIn, layout.marginLeftIn, layout.pitchXIn, layout.pitchYIn,
  ];
  if (!sizes.every((n) => Number.isFinite(n) && n > 0)) return ["Every measurement must be a number greater than zero."];

  const problems: string[] = [];
  if (Math.abs(page.widthIn - 8.5) > 0.001 || Math.abs(page.heightIn - 11) > 0.001) {
    problems.push("Only Letter paper (8.5 × 11 in) is supported.");
  }
  if (perSheet(layout) > MAX_PER_SHEET) problems.push(`A sheet can hold at most ${MAX_PER_SHEET} labels.`);
  if (layout.pitchXIn < label.widthIn - 1e-9 || layout.pitchYIn < label.heightIn - 1e-9) {
    problems.push("Labels overlap: the distance from one label to the next is smaller than the label.");
  }
  const right = layout.marginLeftIn + (layout.columns - 1) * layout.pitchXIn + label.widthIn;
  const bottom = layout.marginTopIn + (layout.rows - 1) * layout.pitchYIn + label.heightIn;
  if (right > page.widthIn + TOLERANCE_IN || bottom > page.heightIn + TOLERANCE_IN) {
    problems.push("Labels run off the page.");
  }
  if (codeBox(layout) === null) problems.push("Labels this small can't carry a code that scans reliably.");
  return problems;
}
