import { useState } from "react";
import { largerCover } from "../covers";
import type { Holder, Person } from "../../shared/types";

// A person's name as shown: a removed member says so.
export const personLabel = (p: Person): string => (p.removed ? `${p.name} (no longer a member)` : p.name);
// A holder's name as shown; only called for a holder that exists.
export const holderLabel = (h: Holder): string => (h.kind === "member" ? personLabel(h.person) : h.name);

export const Name = ({ children }: { children: string }) => <bdi>{children}</bdi>;

export function BookCount({ n }: { n: number }) {
  return <span className="count">{n} {n === 1 ? "book" : "books"}</span>;
}

// "card" is Pair's book card: the size it had before the hero existed, with the stored image as is.
export type CoverSize = "wall" | "row" | "card" | "hero";
// Width and height attributes give the image its 2:3 shape before it loads. The hero's box is reserved in CSS
// (a fixed width at 2:3) until the image has loaded, and only then takes the cover's own proportions.
const BOX: Record<CoverSize, [number, number]> = { wall: [160, 240], row: [64, 96], card: [96, 144], hero: [160, 240] };

// Three states: the image, a plain tile when there is no cover, and the same tile saying the cover did not load.
// The whole thing is aria-hidden: the title and author beside it name the book.
// A different url starts over (the key), so a failure never carries across to another book's cover.
export function Cover(props: { url: string | null; title: string; authors: string[]; size?: CoverSize }) {
  return <CoverFor key={props.url ?? ""} {...props} />;
}

function CoverFor({ url, title, authors, size = "row" }: { url: string | null; title: string; authors: string[]; size?: CoverSize }) {
  // The hero asks for a larger image first. Failed attempts so far: 0, then 1 (the stored URL), then 2 (give up).
  const [failures, setFailures] = useState(0);
  const [ready, setReady] = useState(false);
  const larger = size === "hero" && url ? largerCover(url) : url;
  const attempts = url && larger !== url ? [larger, url] : [url];
  const broken = failures >= attempts.length;
  const state = !url ? "none" : broken ? "failed" : "loaded";
  const [width, height] = BOX[size];
  const fail = () => setFailures((n) => n + 1);
  return (
    <div className={`cover-frame cover-${size}`} data-state={state} data-ready={ready && state === "loaded" ? "" : undefined} aria-hidden="true">
      {url && !broken ? (
        <img
          className="cover" src={attempts[failures] ?? undefined} alt="" width={width} height={height} loading={size === "hero" ? "eager" : "lazy"} referrerPolicy="no-referrer"
          onLoad={(e) => { if (e.currentTarget.naturalWidth <= 1) fail(); else setReady(true); }}
          onError={fail}
        />
      ) : (
        <div className="cover-tile">
          <span className="cover-tile-title">{title}</span>
          {authors[0] && <span className="cover-tile-author">{authors[0]}</span>}
          {state === "failed" && <span className="cover-tile-note">Cover didn’t load</span>}
        </div>
      )}
    </div>
  );
}

export function Book(props: { title: string; authors: string[]; coverUrl: string | null }) {
  return (
    <div className="book">
      <Cover url={props.coverUrl} title={props.title} authors={props.authors} size="card" />
      <div>
        <h2>{props.title}</h2>
        {props.authors.length > 0 && <p className="authors">{props.authors.map((a, i) => (
          <span key={i}>{i > 0 && ", "}<Name>{a}</Name></span>
        ))}</p>}
      </div>
    </div>
  );
}
