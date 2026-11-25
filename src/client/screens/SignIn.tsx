import { useState } from "react";
import { embeddedBrowser } from "../embedded";

// No query or hash: the address is for sharing, not for carrying this visit's state.
const address = () => location.origin + location.pathname;

function CopyLink() {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(address());
      setState("copied");
    } catch {
      setState("manual");
    }
  }
  return (
    <>
      <button type="button" onClick={copy}>{state === "copied" ? "Copied" : "Copy link"}</button>
      {state === "manual" && (
        <p>
          <input type="text" readOnly aria-label="Address of this page" value={address()}
            onFocus={(e) => e.currentTarget.select()} />
        </p>
      )}
    </>
  );
}

export function SignIn({ returnTo }: { returnTo: string }) {
  const app = embeddedBrowser(navigator.userAgent);
  if (app !== null) {
    return (
      <>
        <p>Google won't let you sign in inside {app}. Open this page in Safari or Chrome.</p>
        <CopyLink />
      </>
    );
  }
  return <a className="button" href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in with Google</a>;
}
