import type { Member, RefusalReason } from "../../shared/types";

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

export function Home(props: {
  member: Member | null;
  refused: RefusalReason | null;
  returnTo: string;
  onLogout: () => void;
  notice?: string;
}) {
  const { member, refused, returnTo, onLogout, notice } = props;
  return (
    <>
      <h1>Natalie's Little Library</h1>
      {member ? (
        <>
          {notice !== undefined && <p role="alert" className="refusal">{notice}</p>}
          <p>Hi, {member.name}</p>
          <button type="button" onClick={onLogout}>Sign out</button>
        </>
      ) : (
        <>
          {refused !== null && <p role="alert" className="refusal">{explain(refused)}</p>}
          <a className="button" href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in with Google</a>
        </>
      )}
    </>
  );
}
