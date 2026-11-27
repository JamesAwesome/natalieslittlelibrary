import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { Member, RefusalReason } from "../shared/types";
import { getMe, logout } from "./api";
import { matchRoute } from "./route";
import { APP_NAME, ShellContext, tabFor, type Tab } from "./shell";
import { TabBar } from "./TabBar";
import { CopyPage } from "./screens/CopyPage";
import { Holding } from "./screens/Holding";
import { Import } from "./screens/Import";
import { More } from "./screens/More";
import { Members } from "./screens/Members";
import { Mine } from "./screens/Mine";
import { People } from "./screens/People";
import { Shelf } from "./screens/Shelf";
import { NotFound } from "./screens/NotFound";

// Pairing and label printing carry the barcode decoder and the QR drawer; the other pages need neither.
const Pair = lazy(() => import("./screens/Pair").then((m) => ({ default: m.Pair })));
const Labels = lazy(() => import("./screens/Labels").then((m) => ({ default: m.Labels })));

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
  const [tab, setTab] = useState<Tab | null>(() => tabFor(route));
  const [signingOut, setSigningOut] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const shell = useMemo(() => ({ setTab, setSignedOut }), []);
  const showBar = member !== undefined && member !== null && !signedOut;

  useEffect(() => {
    if (!showBar) return;
    const root = document.getElementById("root");
    root?.classList.add("has-tab-bar");
    return () => root?.classList.remove("has-tab-bar");
  }, [showBar]);

  useEffect(() => {
    // One write: the refusal is dropped and /mine becomes /, so neither undoes the other.
    if (hadRefused || route.name === "mine") {
      try {
        history.replaceState(null, "", route.name === "mine" ? "/" : cleanUrl);
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
  }, [hadRefused, cleanUrl, route.name]);

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
        <h1>{APP_NAME}</h1>
        <p role="alert" className="refusal">{refusalText.unavailable}</p>
        <button type="button" onClick={() => location.reload()}>Try again</button>
      </>
    );
  }

  if (member === undefined) return <h1>{APP_NAME}</h1>;

  const screen =
    route.name === "more" ? (
      <More
        member={member}
        returnTo={returnTo}
        notice={notice}
        busy={signingOut}
        onLogout={() => {
          if (signingOut) return;
          setNotice(undefined);
          setSigningOut(true);
          logout().then(
            // Land on the wall, so the next sign-in does not return to More.
            () => location.assign("/"),
            () => {
              setSigningOut(false);
              setNotice("Couldn't sign out. Check your connection and try again.");
            },
          );
        }}
      />
    ) : route.name === "copy" ? (
      <CopyPage code={route.code} member={member} returnTo={returnTo} />
    ) : route.name === "copy-by-id" ? (
      <CopyPage copyId={route.id} member={member} returnTo={returnTo} />
    ) : route.name === "pair" ? (
      <Pair member={member} returnTo={returnTo} />
    ) : route.name === "labels" ? (
      <Labels member={member} returnTo={returnTo} />
    ) : route.name === "home" || route.name === "mine" ? (
      <Mine member={member} returnTo={returnTo} />
    ) : route.name === "shelf" ? (
      <Shelf id={route.id} member={member} returnTo={returnTo} />
    ) : route.name === "holding" ? (
      <Holding member={member} returnTo={returnTo} />
    ) : route.name === "import" ? (
      <Import member={member} returnTo={returnTo} />
    ) : route.name === "members" ? (
      <Members member={member} returnTo={returnTo} />
    ) : route.name === "people" ? (
      <People member={member} returnTo={returnTo} />
    ) : route.name === "member" ? (
      <Members id={route.id} member={member} returnTo={returnTo} />
    ) : (
      <NotFound />
    );

  return (
    <ShellContext.Provider value={shell}>
      {refused !== null && <p role="alert" className="refusal app-chrome">{explain(refused)}</p>}
      <Suspense fallback={<p>Loading…</p>}>{screen}</Suspense>
      {showBar && <TabBar active={tab} />}
    </ShellContext.Provider>
  );
}
