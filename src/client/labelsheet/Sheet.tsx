import { useMemo } from "react";
import { create } from "qrcode";
import { codeBox, perSheet, positions, type SheetLayout } from "./layout";

export type Nudge = { xMm: number; yMm: number };
type Made = { code: string; url: string };

const MM_PER_IN = 25.4;
const inch = (n: number) => `${Number(n.toFixed(4))}in`;

// Drawn from qrcode's module matrix, not from its string output: the markup holds numbers only.
function Qr({ url, sizeIn }: { url: string; sizeIn: number }) {
  const { size, d } = useMemo(() => {
    const { modules } = create(url, { errorCorrectionLevel: "M" });
    const parts: string[] = [];
    for (let y = 0; y < modules.size; y++) {
      let x = 0;
      while (x < modules.size) {
        if (!modules.get(y, x)) {
          x++;
          continue;
        }
        const start = x;
        while (x < modules.size && modules.get(y, x)) x++;
        parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
      }
    }
    return { size: modules.size, d: parts.join("") };
  }, [url]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={inch(sizeIn)} height={inch(sizeIn)} shapeRendering="crispEdges" aria-hidden="true">
      <path d={d} fill="#000" />
    </svg>
  );
}

function CutMarks({ layout, dx, dy }: { layout: SheetLayout; dx: number; dy: number }) {
  const { label, columns, rows, pitchXIn, pitchYIn, marginLeftIn, marginTopIn } = layout;
  const gapX = (pitchXIn - label.widthIn) / 2;
  const gapY = (pitchYIn - label.heightIn) / 2;
  const left = marginLeftIn - gapX + dx;
  const top = marginTopIn - gapY + dy;
  const width = (columns - 1) * pitchXIn + label.widthIn + 2 * gapX;
  const height = (rows - 1) * pitchYIn + label.heightIn + 2 * gapY;
  const lines = [];
  for (let c = 0; c <= columns; c++) {
    lines.push(<div key={`v${c}`} className="sheet-cut" style={{ left: inch(left + c * pitchXIn), top: inch(top), width: "0.25pt", height: inch(height) }} />);
  }
  for (let r = 0; r <= rows; r++) {
    lines.push(<div key={`h${r}`} className="sheet-cut" style={{ left: inch(left), top: inch(top + r * pitchYIn), width: inch(width), height: "0.25pt" }} />);
  }
  return <>{lines}</>;
}

export function Sheet(props: { labels: Made[]; layout: SheetLayout; nudge: Nudge; outlinesOnly?: boolean }) {
  const { labels, layout, nudge, outlinesOnly = false } = props;
  const per = perSheet(layout);
  const box = codeBox(layout);
  const spots = positions(layout);
  const dx = nudge.xMm / MM_PER_IN;
  const dy = nudge.yMm / MM_PER_IN;

  // The alignment test is a single page of empty outlines.
  const pages: (Made | null)[][] = [];
  if (outlinesOnly) pages.push(Array.from({ length: per }, () => null));
  else for (let i = 0; i < labels.length; i += per) pages.push(labels.slice(i, i + per));

  return (
    <div className={outlinesOnly ? "sheets sheets--align" : "sheets"}>
      {pages.map((page, p) => (
        <div key={p} className="sheet-page" style={{ width: inch(layout.page.widthIn), height: inch(layout.page.heightIn) }}>
          {layout.cutMarks === true && !outlinesOnly && <CutMarks layout={layout} dx={dx} dy={dy} />}
          {page.map((made, i) => (
            <div
              key={i}
              className={layout.shape === "round" ? "sheet-label sheet-label--round" : "sheet-label"}
              data-code={made?.code}
              style={{
                left: inch(spots[i]!.leftIn + dx),
                top: inch(spots[i]!.topIn + dy),
                width: inch(layout.label.widthIn),
                height: inch(layout.label.heightIn),
              }}
            >
              {made !== null && box !== null && (
                <>
                  <Qr url={made.url} sizeIn={box.qrIn} />
                  {box.showText && <span className="sheet-code">{made.code}</span>}
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
