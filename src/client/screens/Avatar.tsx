import { useState } from "react";
import type { Person } from "../../shared/types";
import { personLabel } from "./BookCard";

// A person's picture, or their first initial on an accent disc when there is none or it will not load.
// Decorative either way (the name sits beside it), so it is hidden from assistive technology.
// A different picture starts over (the key), so one failure never carries to another person.
export function Avatar(props: { person: Person; size: number }) {
  return <AvatarFor key={props.person.pictureUrl ?? ""} {...props} />;
}

function AvatarFor({ person, size }: { person: Person; size: number }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size };
  if (person.pictureUrl && !broken) {
    return (
      <img
        className="avatar" src={person.pictureUrl} alt="" {...box} referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  const initial = (Array.from(personLabel(person).trim())[0] ?? "?").toUpperCase();
  return (
    <span className="avatar avatar-initial" style={{ ...box, fontSize: size * 0.45 }} aria-hidden="true">{initial}</span>
  );
}
