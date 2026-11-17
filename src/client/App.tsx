import { useEffect, useState } from "react";
import type { Member, RefusalReason } from "../shared/types";
import { getMe, logout } from "./api";
import { Home } from "./screens/Home";

function readLocation() {
  const params = new URLSearchParams(location.search);
  const refused = params.get("refused") as RefusalReason | null;
  params.delete("refused");
  const query = params.toString();
  return { refused, returnTo: location.pathname + (query ? `?${query}` : "") };
}

export function App() {
  // Read once: the refusal is shown, then dropped from the address bar so a reload does not repeat it.
  const [{ refused, returnTo }] = useState(readLocation);
  const [member, setMember] = useState<Member | null | undefined>(undefined);

  useEffect(() => {
    history.replaceState(null, "", returnTo);
    let live = true;
    getMe().then(
      (m) => live && setMember(m),
      () => live && setMember(null),
    );
    return () => {
      live = false;
    };
  }, [returnTo]);

  if (member === undefined) return <h1>Natalie's Little Library</h1>;

  return (
    <Home
      member={member}
      refused={refused}
      returnTo={returnTo}
      onLogout={() => {
        logout().then(() => location.reload());
      }}
    />
  );
}
