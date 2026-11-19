import { useEffect, useState } from "react";
import type { Member, RefusalReason } from "../shared/types";
import { getMe, logout } from "./api";
import { matchRoute } from "./route";
import { Home } from "./screens/Home";
import { NotFound } from "./screens/NotFound";

const refusalText: Record<RefusalReason, string> = {
  "not-invited": "This library is invite-only right now. Ask Natalie to add you.",
  removed: "This account no longer has access.",
  unverified: "Google hasn't verified that email address yet.",
  failed: "Sign-in didn't finish. Please try again.",
  unavailable: "The library is having trouble right now. Please try again later.",
};

function explain(refused: string): string {
  return Object.hasOwn(refusalText, refused) ? refusalText[refused as RefusalReason] : refusalText.failed;
}

function readLocation() {
  const params = new URLSearchParams(location.search);
  const refused = params.get("refused");
  const hadRefused = params.has("refused");
  params.delete("refused");
  const query = params.toString();
  const returnTo = location.pathname + (query ? `?${query}` : "");
  return { refused, hadRefused, returnTo, cleanUrl: returnTo + location.hash, route: matchRoute(location.pathname) };
}

export function App() {
  // Read once: the refusal is shown, then dropped from the address bar so a reload does not repeat it.
  const [{ refused, hadRefused, returnTo, cleanUrl, route }] = useState(readLocation);
  const [member, setMember] = useState<Member | null | undefined>(undefined);
  const [trouble, setTrouble] = useState(false);
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
      (e: unknown) => {
        if (!live) return;
        if ((e as { status?: unknown } | null)?.status === 503) setTrouble(true);
        else setMember(null);
      },
    );
    return () => {
      live = false;
    };
  }, [hadRefused, cleanUrl]);

  useEffect(() => {
    // A page restored from the back-forward cache keeps old state; start it afresh.
    const onPageShow = (e: Event) => {
      if ((e as PageTransitionEvent).persisted) location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  if (trouble) {
    return (
      <>
        <h1>Natalie's Little Library</h1>
        <p role="alert" className="refusal">{refusalText.unavailable}</p>
        <button type="button" onClick={() => location.reload()}>Try again</button>
      </>
    );
  }

  if (member === undefined) return <h1>Natalie's Little Library</h1>;

  const screen =
    route.name === "home" ? (
      <Home
        member={member}
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
    ) : (
      <NotFound />
    );

  return (
    <>
      {refused !== null && <p role="alert" className="refusal">{explain(refused)}</p>}
      {screen}
    </>
  );
}
