import { useRef, useState, type PointerEvent } from "react";
import { markAt, RAIL_STRIP, RAIL_TOP, targetLetter } from "./model";

// One strip of 28 marks (an up arrow, then A–Z and #) down the right edge. Hidden from assistive tech: the letter headings are real headings.
// touch-action: none and pointer capture keep the browser from taking the drag as a page scroll.
export function AlphaRail({ present, onPick, onTop }: { present: string[]; onPick(letter: string): void; onTop(): void }) {
  const has = new Set(present);
  const drag = useRef<{ pointerId: number; letter: string | null } | null>(null);
  const [bubble, setBubble] = useState<{ letter: string; y: number } | null>(null);

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = Math.min(r.height, Math.max(0, e.clientY - r.top));
    const mark = markAt(y, r.height);
    const letter = mark === RAIL_TOP ? RAIL_TOP : targetLetter(mark, present);
    if (!letter || !drag.current) return;
    setBubble({ letter, y });
    if (letter !== drag.current.letter) {
      drag.current.letter = letter;
      if (letter === RAIL_TOP) onTop();
      else onPick(letter);
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
      {RAIL_STRIP.map((m) => (
        <span key={m} className="alpha-rail-mark" data-empty={m === RAIL_TOP || has.has(m) ? undefined : ""}>{m}</span>
      ))}
      {bubble && <span className="alpha-rail-bubble" aria-hidden="true" style={{ top: bubble.y }}>{bubble.letter}</span>}
    </div>
  );
}
