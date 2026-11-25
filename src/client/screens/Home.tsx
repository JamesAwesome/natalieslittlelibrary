import type { Member } from "../../shared/types";
import { SignIn } from "./SignIn";

export function Home(props: {
  member: Member | null;
  returnTo: string;
  onLogout: () => void;
  notice?: string;
}) {
  const { member, returnTo, onLogout, notice } = props;
  return (
    <>
      <h1>Natalie's Little Library</h1>
      {member ? (
        <>
          {notice !== undefined && <p role="alert" className="refusal">{notice}</p>}
          <p>Hi, {member.name}</p>
          <p>
            <a className="button" href="/pair">Pair a book</a>{" "}
            <a className="button" href="/labels">Print labels</a>
          </p>
          <button type="button" onClick={onLogout}>Sign out</button>
        </>
      ) : (
        <SignIn returnTo={returnTo} />
      )}
    </>
  );
}
