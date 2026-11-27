import { useRef, useState, type PointerEvent } from "react";
import { markAt, RAIL_MARKS, targetLetter } from "./model";

// One strip of 27 marks down the right edge. Hidden from assistive tech: the letter headings are real headings.
// touch-action: none and pointer capture keep the browser from taking the drag as a page scroll.
export function AlphaRail({ present, onPick }: { present: string[]; onPick(letter: string): void }) {
  const has = new Set(present);
  const drag = useRef<{ pointerId: number; letter: string | null } | null>(null);
  const [bubble, setBubble] = useState<{ letter: string; y: number } | null>(null);

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = Math.min(r.height, Math.max(0, e.clientY - r.top));
    const letter = targetLetter(markAt(y, r.height), present);
    if (!letter || !drag.current) return;
    setBubble({ letter, y });
    if (letter !== drag.current.letter) {
      drag.current.letter = letter;
      onPick(letter);
    }
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setBubble(null);
  };

  return (
    <div
      className="alpha-rail"
      aria-hidden="true"
      style={{ touchAction: "none" }}
      data-dragging={bubble ? "" : undefined}
      onPointerDown={(e) => {
        e.preventDefault();
        drag.current = { pointerId: e.pointerId, letter: null };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => { if (drag.current?.pointerId === e.pointerId) pick(e); }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      {RAIL_MARKS.map((m) => (
        <span key={m} className="alpha-rail-mark" data-empty={has.has(m) ? undefined : ""}>{m}</span>
      ))}
      {bubble && <span className="alpha-rail-bubble" aria-hidden="true" style={{ top: bubble.y }}>{bubble.letter}</span>}
    </div>
  );
}
