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

// The printed code for a label of this shape and size, or null if the label is too small to carry one.
export function codeBox(layout: SheetLayout): { qrIn: number; showText: boolean } | null {
  const side = Math.min(layout.label.widthIn, layout.label.heightIn);
  const qrIn = (layout.shape === "round" ? 0.62 : 0.72) * side;
  if (!(qrIn >= MIN_QR_IN)) return null;
  return { qrIn, showText: side >= TEXT_MIN_SIDE_IN };
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
