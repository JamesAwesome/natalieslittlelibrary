import { useState } from "react";
import type { Holder, Person } from "../../shared/types";

// A person's name as shown: a removed member says so.
export const personLabel = (p: Person): string => (p.removed ? `${p.name} (no longer a member)` : p.name);
// A holder's name as shown; only called for a holder that exists.
export const holderLabel = (h: Holder): string => (h.kind === "member" ? personLabel(h.person) : h.name);

export const Name = ({ children }: { children: string }) => <bdi>{children}</bdi>;

export function Cover({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false);
  return url && !broken ? <img className="cover" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <div className="cover cover-missing" aria-hidden="true" />;
}

export function Book(props: { title: string; authors: string[]; coverUrl: string | null }) {
  return (
    <div className="book">
      <Cover url={props.coverUrl} />
      <div>
        <h2>{props.title}</h2>
        {props.authors.length > 0 && <p className="authors">{props.authors.map((a, i) => (
          <span key={i}>{i > 0 && ", "}<Name>{a}</Name></span>
        ))}</p>}
      </div>
    </div>
  );
}
