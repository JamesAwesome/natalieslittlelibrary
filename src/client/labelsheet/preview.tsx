// Development only: every offered sheet with made-up labels, to print to PDF and check against the layout.
// Not linked from the app and not part of the production build (the build's only entry is /index.html).
// Add ?outlines to draw the label outlines too, so their vector positions can be read from the PDF.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { perSheet } from "./layout";
import { Sheet } from "./Sheet";
import { SHEETS } from "./sheets";

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const code = (n: number) => Array.from({ length: 10 }, (_, i) => ALPHABET[(n * 7 + i * 11 + i * i * n) % ALPHABET.length]).join("");
const outlines = new URLSearchParams(location.search).has("outlines");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="labels-page"><div className="sheet-area">
    {outlines && <style>{".sheet-label { outline: 0.5pt solid #000 !important; outline-offset: -0.5pt !important; }"}</style>}
    {SHEETS.map((layout, s) => {
      const labels = Array.from({ length: perSheet(layout) }, (_, i) => {
        const c = code(s * 1000 + i + 1);
        return { code: c, url: `https://example.test/b/${c}` };
      });
      return (
        <div key={layout.id} style={s < SHEETS.length - 1 ? { breakAfter: "page" } : undefined}>
          <Sheet labels={labels} layout={layout} nudge={{ xMm: 0, yMm: 0 }} />
        </div>
      );
    })}
    </div></div>
  </StrictMode>,
);
