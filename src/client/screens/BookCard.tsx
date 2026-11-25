import { useState } from "react";

export const Name = ({ children }: { children: string }) => <bdi>{children}</bdi>;

function Cover({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false);
  return url && !broken ? <img className="cover" src={url} alt="" onError={() => setBroken(true)} /> : <div className="cover cover-missing" aria-hidden="true" />;
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
