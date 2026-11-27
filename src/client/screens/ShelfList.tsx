import type { ShelfItem } from "../../shared/types";
import { Cover, holderLabel, Name, personLabel } from "./BookCard";

// The one list renderer. It reads only the fields named here; a label code is never one of them.
export function ShelfList(props: { items: ShelfItem[]; viewerId?: string; showOwner?: boolean }) {
  const { items, viewerId, showOwner } = props;
  return (
    <ul className="shelf-list">
      {items.map((item) => {
        const mine = viewerId !== undefined && item.owner?.id === viewerId;
        return (
          <li key={item.copyId} className="shelf-row">
            <Cover url={item.book.coverUrl} title={item.book.title} authors={item.book.authors} size="row" />
            <div className="shelf-text">
              <a className="shelf-title" href={`/copies/${encodeURIComponent(item.copyId)}`}><Name>{item.book.title}</Name></a>
              {item.book.authors.length > 0 && (
                <p className="authors">
                  {item.book.authors.map((a, i) => <span key={i}>{i > 0 && ", "}<Name>{a}</Name></span>)}
                </p>
              )}
              {showOwner && (item.owner ? <p>Owned by <Name>{personLabel(item.owner)}</Name></p> : <p>No owner</p>)}
              {item.home ? <p>At home</p> : item.holder && <p>With <Name>{holderLabel(item.holder)}</Name></p>}
              {!item.labelled && <p>No label yet</p>}
              {!item.labelled && mine && (
                <a className="button" href={`/pair?copy=${encodeURIComponent(item.copyId)}`}>Put a label on it</a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function BookCount({ n }: { n: number }) {
  return <span className="count">{n} {n === 1 ? "book" : "books"}</span>;
}
