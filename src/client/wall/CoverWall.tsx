import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CollectionRef, ShelfItem } from "../../shared/types";
import { Cover, holderLabel, Name, personLabel } from "../screens/BookCard";
import { AlphaRail } from "./AlphaRail";
import { ALL, applyFilter, countLine, groupByLetter, showRail, type Status, type WallFilter } from "./model";

export type WallKind = "mine" | "friend" | "holding" | "my-collection" | "friend-collection";

type Props = {
  kind: WallKind;
  title: string;
  items: ShelfItem[];
  collections?: CollectionRef[];
  /** Alerts and the requests bar, between the count line and the chips. */
  top?: ReactNode;
  /** Some shelves failed to load, so the count would be wrong. */
  incomplete?: boolean;
  onNewCollection?: () => void;
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
  const groups = groupByLetter(applyFilter(items, filter));
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const rail = !loading && items.length > 0 && showRail(shown, groups.length);
  const pick = (letter: string) => document.getElementById(letterId(letter))?.scrollIntoView({ block: "start", behavior: "instant" });

  return (
    <div className="wall" data-chips={chips && !loading && items.length > 0 ? "" : undefined} data-rail={rail ? "" : undefined}>
      <h1>{title}</h1>
      {!props.incomplete && !loading && items.length > 0 && <p className="wall-count">{countLine(items, owner)}</p>}
      {props.top}
      {loading ? (
        <div className="wall-grid wall-skeleton" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => <div key={i} className="wall-skeleton-tile" />)}
        </div>
      ) : items.length === 0 ? props.empty : (
        <>
          {chips && (
            <div className="wall-chips">
              <div className="wall-status">
                {STATUS[kind].map(([status, label]) => (
                  <button key={status} type="button" className="chip" aria-pressed={filter.status === status}
                    onClick={() => onFilter({ ...filter, status })}>
                    <span className="chip-pill">{label}</span>
                  </button>
                ))}
              </div>
              <CollectionMenu {...props} />
            </div>
          )}
          {groups.length === 0 ? (
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

function CollectionMenu({ kind, collections = [], filter, onFilter, onNewCollection }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const picked = collections.find((c) => c.id === filter.collectionId) ?? null;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const entries = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

  useEffect(() => {
    if (!open) return;
    (entries()[0])?.focus();
    const outside = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
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
  const choose = (collectionId: string | null) => {
    onFilter({ ...filter, collectionId });
    close(true);
  };
  const radio = (id: string | null, label: string) => (
    <button key={id ?? ""} type="button" role="menuitemradio" aria-checked={filter.collectionId === id} tabIndex={-1}
      className="wall-menu-item" onClick={() => choose(id)}>
      <span className="wall-menu-label">{label}</span>
    </button>
  );

  return (
    <div className="wall-collection" ref={root}>
      <button ref={button} type="button" className="chip" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        data-active={picked ? "" : undefined} onClick={() => setOpen((o) => !o)}>
        <span className="chip-pill">
          <span className="chip-label">{picked ? picked.name : "Collection"}</span>
          <svg className="chip-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
        </span>
      </button>
      {open && (
        <div ref={menu} id={menuId} role="menu" aria-label="Collection" className="wall-menu" onKeyDown={onKeyDown}>
          {radio(null, "All collections")}
          {collections.map((c) => radio(c.id, c.name))}
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
