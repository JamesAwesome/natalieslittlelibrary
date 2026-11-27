import type { Member } from "../../shared/types";
import { APP_NAME } from "../shell";
import { Name } from "./BookCard";
import { SignIn } from "./SignIn";

const tools = [
  { href: "/pair", label: "Pair a book" },
  { href: "/labels", label: "Print labels" },
  { href: "/people", label: "People" },
  { href: "/import", label: "Import from StoryGraph" },
];

export function More(props: {
  member: Member | null;
  returnTo: string;
  notice?: string;
  busy?: boolean;
  onLogout: () => void;
}) {
  const { member, returnTo, notice, busy, onLogout } = props;
  if (!member) {
    return (
      <>
        <h1>{APP_NAME}</h1>
        <SignIn returnTo={returnTo} />
      </>
    );
  }
  return (
    <div className="more-page">
      <h1>More</h1>
      <p>Hi, <Name>{member.name}</Name></p>
      <ul className="more-list">
        {tools.map((t) => (
          <li key={t.href}><a href={t.href}>{t.label}</a></li>
        ))}
      </ul>
      <div className="more-signout">
        {notice !== undefined && <p role="alert" className="refusal">{notice}</p>}
        <button type="button" disabled={busy} onClick={onLogout}>Sign out</button>
      </div>
    </div>
  );
}
