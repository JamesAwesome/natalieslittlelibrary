import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from "react";
import type { CollectionRef, ShelfItem } from "../../shared/types";
import { Cover, holderLabel, Name, personLabel } from "../screens/BookCard";
import { AlphaRail } from "./AlphaRail";
import { WALL_ANCHOR } from "./memory";
import { ALL, applyFilter, countLine, groupByLetter, showRail, type Status, type WallFilter } from "./model";

export type WallKind = "mine" | "friend" | "holding" | "my-collection" | "friend-collection";

type Props = {
  kind: WallKind;
  /** The h1. It is often a name (a collection's, a friend's), so it sits in bdi. */
  title: string;
  /** Lets the screen move focus to the h1 (after a rename, say); the h1 then takes tabIndex -1. */
  headingRef?: Ref<HTMLHeadingElement>;
  items: ShelfItem[];
  collections?: CollectionRef[];
  /** Alerts and the requests bar, between the count line and the chips. */
  top?: ReactNode;
  /** Some shelves failed to load, so the count would be wrong. */
  incomplete?: boolean;
  onNewCollection?: () => void;
  /** The Collection ▾ button, so the screen can hand focus back to it (closing the form New collection… opened). */
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
  filter: WallFilter;
  onFilter(f: WallFilter): void;
  empty: ReactNode;
  loading?: boolean;
};

const STATUS: Record<"mine" | "friend", [Status, string][]> = {
  mine: [["all", "All"], ["home", "At home"], ["out", "Lent out"], ["unlabelled", "No label"]],
  friend: [["all", "All"], ["home", "At home"]],
};

const letterId = (l: string) => `letter-${l === "#" ? "hash" : l}`;

// The one short line under a cover, when it applies. Names go through personLabel and holderLabel.
function note(kind: WallKind, it: ShelfItem): ReactNode {
  if (kind === "holding") return it.owner ? <>From <Name>{personLabel(it.owner)}</Name></> : "No owner";
  if (it.home) return null;
  if ((kind === "mine" || kind === "my-collection") && it.holder) return <>With <Name>{holderLabel(it.holder)}</Name></>;
  return "Out";
}

export function CoverWall(props: Props) {
  const { kind, title, items, filter, onFilter, loading } = props;
  const owner = kind === "mine" || kind === "my-collection";
  const chips = kind === "mine" || kind === "friend";
  const shown = applyFilter(items, filter);
  const groups = groupByLetter(shown);
  const rail = !loading && items.length > 0 && showRail(shown.length, groups.length);
  // Your own wall always has its chips, so Collection ▾ (New collection…, Manage) is there even with no books.
  const chipsShown = chips && !loading && (items.length > 0 || kind === "mine");
  const pick = (letter: string) => document.getElementById(letterId(letter))?.scrollIntoView({ block: "start", behavior: "instant" });

  return (
    <div className="wall" data-chips={chipsShown ? "" : undefined} data-rail={rail ? "" : undefined}>
      <h1 ref={props.headingRef} tabIndex={props.headingRef ? -1 : undefined}><Name>{title}</Name></h1>
      {!props.incomplete && !loading && items.length > 0 && <p className="wall-count">{countLine(shown, owner)}</p>}
      {props.top && <div className="wall-top">{props.top}</div>}
      {/* Where the chips row (or the grid) starts in the page: the place a wall restores to is measured from here,
          so what sits above it (an open list, a form) can differ between visits. Not sticky, so never moves. */}
      {!loading && <div {...{ [WALL_ANCHOR]: "" }} />}
      {loading ? (
        <div className="wall-grid wall-skeleton" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => <div key={i} className="wall-skeleton-tile" />)}
        </div>
      ) : items.length === 0 && !chipsShown ? <div className="wall-empty">{props.empty}</div> : (
        <>
          {chipsShown && (
            <div className="wall-chips">
              <StatusChips kind={kind as "mine" | "friend"} filter={filter} onFilter={onFilter} />
              <CollectionMenu {...props} />
            </div>
          )}
          {items.length === 0 ? <div className="wall-empty">{props.empty}</div> : groups.length === 0 ? (
            <div className="wall-none">
              <p>No books match.</p>
              <button type="button" onClick={() => onFilter(ALL)}>Show all</button>
            </div>
          ) : groups.map((g) => (
            <section key={g.letter} className="wall-group">
              <h2 id={letterId(g.letter)} className="wall-letter">{g.letter}</h2>
              <ul className="wall-grid">
                {g.items.map((it) => <Tile key={it.copyId} kind={kind} item={it} />)}
              </ul>
            </section>
          ))}
          {rail && <AlphaRail present={groups.map((g) => g.letter)} onPick={pick} />}
        </>
      )}
    </div>
  );
}

// Status toggles in a strip that scrolls sideways. The trailing edge fades while more chips lie past it, and the
// pressed chip is scrolled into the strip (never the page) whenever the filter or the strip's width changes.
function StatusChips({ kind, filter, onFilter }: { kind: "mine" | "friend"; filter: WallFilter; onFilter(f: WallFilter): void }) {
  const strip = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    const reveal = () => {
      const chip = el.querySelector('[aria-pressed="true"]');
      if (!chip) return;
      const s = el.getBoundingClientRect();
      const c = chip.getBoundingClientRect();
      // The least scroll that brings the chip clear of the trailing fade (1.5rem in wall.css); none if it fits,
      // so a strip that once had to scroll (fonts loading, a long collection name) settles back to its start.
      const fade = 24;
      const end = c.right - s.left + el.scrollLeft;
      el.scrollLeft = Math.max(0, end - (s.right - s.left - fade));
      measure();
    };
    reveal();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", measure); ro?.disconnect(); };
  }, [filter.status, filter.collectionId]);

  return (
    <div className="wall-status" ref={strip} data-more={more ? "" : undefined}>
      {STATUS[kind].map(([status, label]) => (
        <button key={status} type="button" className="chip" aria-pressed={filter.status === status}
          onClick={() => onFilter({ ...filter, status })}>
          <span className="chip-pill">{label}</span>
        </button>
      ))}
    </div>
  );
}

function Tile({ kind, item }: { kind: WallKind; item: ShelfItem }) {
  const id = useId();
  const { title, authors, coverUrl } = item.book;
  const n = note(kind, item);
  return (
    <li className="wall-tile">
      <a className="wall-link" href={`/copies/${encodeURIComponent(item.copyId)}`} aria-describedby={n ? id : undefined}>
        <span className="visually-hidden">{[title, ...authors].join(", ")}</span>
        <Cover url={coverUrl} title={title} authors={authors} size="wall" />
      </a>
      {n && <p id={id} className="wall-note">{n}</p>}
    </li>
  );
}

// Eats the next click anywhere, once, and returns a function that disarms it. A gesture that ends with no click (a
// scroll's pointercancel) disarms it, as does the next pointerdown or key, so it never eats a later tap or Enter.
// Added during the pointerdown's own dispatch, its pointerdown listener does not hear that same event.
function swallowNextClick(): () => void {
  const click = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    disarm();
  };
  const disarm = () => {
    document.removeEventListener("click", click, true);
    for (const type of ["pointercancel", "pointerdown", "keydown"]) document.removeEventListener(type, disarm, true);
  };
  document.addEventListener("click", click, true);
  for (const type of ["pointercancel", "pointerdown", "keydown"]) document.addEventListener(type, disarm, true);
  return disarm;
}

function CollectionMenu({ kind, collections = [], filter, onFilter, onNewCollection, menuButtonRef }: Props) {
  const [open, setOpen] = useState(false);
  const ownButton = useRef<HTMLButtonElement>(null);
  const button = menuButtonRef ?? ownButton;
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const picked = collections.find((c) => c.id === filter.collectionId) ?? null;
  // Disarms a click swallow still waiting when the wall goes away.
  const swallow = useRef<(() => void) | null>(null);
  useEffect(() => () => swallow.current?.(), []);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const entries = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

  useEffect(() => {
    if (!open) return;
    // The menu stops above the tab bar (or the screen's bottom) and scrolls inside itself.
    const m = menu.current;
    if (m) {
      const floor = document.querySelector(".tab-bar")?.getBoundingClientRect().top ?? innerHeight;
      m.style.maxHeight = `${Math.max(88, floor - m.getBoundingClientRect().top - 8)}px`;
    }
    (entries()[0])?.focus();
    // A tap outside only closes the menu: the click it goes on to make (on a cover, a tab) is swallowed, once.
    const outside = (e: Event) => {
      if (root.current?.contains(e.target as Node)) return;
      setOpen(false);
      swallow.current?.();
      swallow.current = swallowNextClick();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    const all = entries();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => { e.preventDefault(); all[(i + all.length) % all.length]?.focus(); };
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    // Back to the button first, so the browser's own Tab moves on from there rather than from a removed item.
    else if (e.key === "Tab") close(true);
    else if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(-1);
  };
  // Focus moving elsewhere (a screen reader, a script) closes it. A null target is a tap, which the pointerdown
  // listener above handles; closing on it would unmount an item before Safari, which doesn't focus buttons, clicks it.
  const onBlur = (e: FocusEvent) => {
    if (e.relatedTarget instanceof Node && !root.current?.contains(e.relatedTarget)) setOpen(false);
  };
  const choose = (collectionId: string | null) => {
    onFilter({ ...filter, collectionId });
    close(true);
  };
  const radio = (id: string | null, label: ReactNode) => (
    <button key={id ?? ""} type="button" role="menuitemradio" aria-checked={filter.collectionId === id} tabIndex={-1}
      className="wall-menu-item" onClick={() => choose(id)}>
      <span className="wall-menu-label">{label}</span>
    </button>
  );

  return (
    <div className="wall-collection" ref={root} onBlur={onBlur}>
      <button ref={button} type="button" className="chip" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        data-active={picked ? "" : undefined} onClick={() => setOpen((o) => !o)}>
        <span className="chip-pill">
          {picked ? (
            <span className="chip-label"><span className="visually-hidden">Collection:</span> <Name>{picked.name}</Name></span>
          ) : <span className="chip-label">Collection</span>}
          <svg className="chip-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
        </span>
      </button>
      {open && (
        <div ref={menu} id={menuId} role="menu" aria-label="Collection" className="wall-menu" onKeyDown={onKeyDown}>
          {radio(null, "All collections")}
          {collections.map((c) => radio(c.id, <Name>{c.name}</Name>))}
          {kind === "mine" && picked && (
            <a role="menuitem" tabIndex={-1} className="wall-menu-item" href={`/collections/${encodeURIComponent(picked.id)}`}>
              <span className="wall-menu-label">Manage <Name>{picked.name}</Name></span>
            </a>
          )}
          {kind === "mine" && (
            <button type="button" role="menuitem" tabIndex={-1} className="wall-menu-item"
              onClick={() => { close(true); onNewCollection?.(); }}>
              <span className="wall-menu-label">New collection…</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
