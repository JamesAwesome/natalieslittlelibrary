import type { SheetLayout } from "./layout";

// Margins and pitch for every Avery sheet were read from the vector label outlines in Avery's own
// PDF template for that product (page 612 x 792 pt, points / 72 = inches); each one closes
// (left margin equals right margin, top equals bottom) to within 0.001 in.
const AVERY = "https://s3.amazonaws.com/avery.dpp.projects.s3uspdownloadables/US_en/Downloadables/pdf/";
const LETTER = { widthIn: 8.5, heightIn: 11 };

export const SHEETS: SheetLayout[] = [
  {
    id: "avery-94103",
    name: "Avery 94103 · 1 × 1 in square · 48 per sheet",
    source: `${AVERY}U-1203-01.pdf (Avery's template for 94103, https://www.avery.com/templates/94103)`,
    page: LETTER, shape: "rectangle", label: { widthIn: 1, heightIn: 1 },
    columns: 6, rows: 8, marginTopIn: 0.625, marginLeftIn: 0.625, pitchXIn: 1.25, pitchYIn: 1.25,
  },
  {
    id: "avery-22805",
    name: "Avery 22805 · 1½ × 1½ in square · 24 per sheet",
    source: `${AVERY}U-0430-01.pdf (Avery's template for 22805, https://www.avery.com/templates/22805)`,
    page: LETTER, shape: "rectangle", label: { widthIn: 1.5, heightIn: 1.5 },
    columns: 4, rows: 6, marginTopIn: 0.5, marginLeftIn: 0.78, pitchXIn: 1.8132, pitchYIn: 1.7,
  },
  {
    id: "avery-22806",
    name: "Avery 22806 · 2 × 2 in square · 12 per sheet",
    source: `${AVERY}U-0431-01.pdf (Avery's template for 22806, https://www.avery.com/templates/22806)`,
    page: LETTER, shape: "rectangle", label: { widthIn: 2, heightIn: 2 },
    columns: 3, rows: 4, marginTopIn: 0.625, marginLeftIn: 0.625, pitchXIn: 2.625, pitchYIn: 2.5833,
  },
  {
    id: "avery-5160",
    name: "Avery 5160 · 1 × 2⅝ in rectangle · 30 per sheet",
    source: `${AVERY}U-0087-01.pdf (Avery's template for 5160, https://www.avery.com/templates/5160; the PDF draws the outline 2.63 in wide, 2.625 in is the nominal width)`,
    page: LETTER, shape: "rectangle", label: { widthIn: 2.625, heightIn: 1 },
    columns: 3, rows: 10, marginTopIn: 0.5, marginLeftIn: 0.1875, pitchXIn: 2.75, pitchYIn: 1,
  },
  {
    id: "avery-6450",
    name: "Avery 6450 · 1 in round · 63 per sheet",
    source: `${AVERY}U-0514-01.pdf (Avery's template for 6450, https://www.avery.com/templates/6450)`,
    page: LETTER, shape: "round", label: { widthIn: 1, heightIn: 1 },
    columns: 7, rows: 9, marginTopIn: 0.5, marginLeftIn: 0.5, pitchXIn: 1.0833, pitchYIn: 1.125,
  },
  {
    id: "avery-22807",
    name: "Avery 22807 · 2 in round · 12 per sheet",
    source: `${AVERY}U-0435-01.pdf (Avery's template for 22807, https://www.avery.com/templates/22807)`,
    page: LETTER, shape: "round", label: { widthIn: 2, heightIn: 2 },
    columns: 3, rows: 4, marginTopIn: 0.625, marginLeftIn: 0.625, pitchXIn: 2.625, pitchYIn: 2.5833,
  },
  {
    id: "plain-63",
    name: "Plain sticker paper, cut by hand · 1 × 1 in square · 63 per sheet",
    source: "this project's own layout",
    page: LETTER, shape: "rectangle", label: { widthIn: 1, heightIn: 1 },
    // 7 x 9 grid on a 1.125 in pitch is 7.75 x 10 in, centred on the page.
    columns: 7, rows: 9, marginTopIn: 0.5, marginLeftIn: 0.375, pitchXIn: 1.125, pitchYIn: 1.125,
    cutMarks: true,
  },
];

export const DEFAULT_SHEET_ID = "avery-94103";
