import { useEffect, useState } from "react";
import type { Member, RefusalReason } from "../shared/types";
import { getMe, logout } from "./api";
import { Home } from "./screens/Home";

function readLocation() {
  const params = new URLSearchParams(location.search);
  const refused = params.get("refused") as RefusalReason | null;
  const hadRefused = params.has("refused");
  params.delete("refused");
  const query = params.toString();
  const returnTo = location.pathname + (query ? `?${query}` : "");
  return { refused, hadRefused, returnTo, cleanUrl: returnTo + location.hash };
}

export function App() {
  // Read once: the refusal is shown, then dropped from the address bar so a reload does not repeat it.
  const [{ refused, hadRefused, returnTo, cleanUrl }] = useState(readLocation);
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (hadRefused) {
      try {
        history.replaceState(null, "", cleanUrl);
      } catch {
        // An odd path (e.g. "//x") can make this throw; the page must still render.
      }
    }
    let live = true;
    getMe().then(
      (m) => live && setMember(m),
      () => live && setMember(null),
    );
    return () => {
      live = false;
    };
  }, [hadRefused, cleanUrl]);

  if (member === undefined) return <h1>Natalie's Little Library</h1>;

  return (
    <Home
      member={member}
      refused={refused}
      returnTo={returnTo}
      notice={notice}
      onLogout={() => {
        setNotice(undefined);
        logout().then(
          () => location.reload(),
          () => setNotice("Couldn't sign out. Check your connection and try again."),
        );
      }}
    />
  );
}
