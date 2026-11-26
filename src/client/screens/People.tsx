import { useState } from "react";
import type { Member, Person, PersonSummary } from "../../shared/types";
import { cleanPersonName } from "../../shared/name";
import { ApiError, linkPerson, listMembers, listPeople, renamePerson } from "../api";
import { Name, personLabel } from "./BookCard";
import { ShelfList } from "./ShelfList";
import { SignIn } from "./SignIn";
import { Trouble } from "./Trouble";
import { useGuard } from "./useGuard";
import { useLoaded } from "./useLoaded";

type Step =
  | { kind: "rename"; id: string; name: string }
  | { kind: "pick"; id: string; members: Person[] | null }
  | { kind: "confirm"; id: string; to: Person };

export function People({ member, returnTo }: { member: Member | null; returnTo: string }) {
  const { state, reload, lose, retry } = useLoaded(async () => (await listPeople()).people, member !== null);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const { busy, guard, live } = useGuard();

  function run(send: () => Promise<unknown>, taken?: string, notAllowed?: string) {
    void guard(async () => {
      setError(undefined);
      try {
        await send();
        if (live.current) setStep(null);
      } catch (e) {
        if (!live.current) return;
        if (e instanceof ApiError && e.status === 401) return lose();
        const why = e instanceof ApiError ? e.rejected : null;
        setError(taken !== undefined && why === "name-taken" ? taken
          : notAllowed !== undefined && why === "not-allowed" ? notAllowed
          : "Something went wrong. Try again.");
        if (notAllowed !== undefined && why === "not-allowed") setStep(null);
      }
      await reload();
    });
  }

  function startLink(id: string) {
    setError(undefined);
    setStep({ kind: "pick", id, members: null });
    listMembers().then(
      (r) => live.current && setStep((s) => (s?.kind === "pick" && s.id === id ? { ...s, members: r.members.filter((m) => m.id !== member?.id) } : s)),
      (e: unknown) => {
        if (!live.current) return;
        if (e instanceof ApiError && e.status === 401) return lose();
        setStep(null);
        setError("Couldn't load the members. Try again.");
      },
    );
  }

  const one = (p: PersonSummary) => {
    const mine = step !== null && step.id === p.id ? step : null;
    return (
      <section key={p.id} className="group">
        <h3><Name>{p.name}</Name></h3>
        {p.linked && <p>Linked to <Name>{personLabel(p.linked)}</Name></p>}
        {mine?.kind === "rename" ? (
          <form onSubmit={(e) => { e.preventDefault(); {
            const clean = cleanPersonName(mine.name);
            if (clean === null) return setError("A name is 1 to 60 characters, with no control characters.");
            run(() => renamePerson(p.id, clean.name), "You already have someone called that.");
          } }}>
            <label>
              Name
              <input type="text" value={mine.name} onChange={(e) => setStep({ ...mine, name: e.target.value })} />
            </label>
            <button type="submit" disabled={busy}>Save</button>{" "}
            <button type="button" onClick={() => setStep(null)}>Cancel</button>
          </form>
        ) : mine?.kind === "pick" ? (
          mine.members === null ? <p>Loading…</p> : mine.members.length === 0 ? <p>No other members to link to.</p> : (
            <ul className="plain-list" aria-label="Members">
              {mine.members.map((m) => (
                <li key={m.id}><button type="button" onClick={() => setStep({ kind: "confirm", id: p.id, to: m })}><Name>{m.name}</Name></button></li>
              ))}
            </ul>
          )
        ) : mine?.kind === "confirm" ? (
          <>
            <p>Link <Name>{p.name}</Name> to <Name>{mine.to.name}</Name>? The books <Name>{p.name}</Name> has will show as theirs.</p>
            <button type="button" disabled={busy} onClick={() => run(() => linkPerson(p.id, mine.to.id), undefined, "That link can't be made now.")}>Link</button>{" "}
            <button type="button" onClick={() => setStep(null)}>Cancel</button>
          </>
        ) : (
          <p>
            <button type="button" onClick={() => { setError(undefined); setStep({ kind: "rename", id: p.id, name: p.name }); }}>Rename</button>
            {!p.linked && <>{" "}<button type="button" onClick={() => startLink(p.id)}>Link</button></>}
          </p>
        )}
        {mine !== null && mine.kind !== "rename" && mine.kind !== "confirm" && <p><button type="button" onClick={() => setStep(null)}>Cancel</button></p>}
        {p.holding.length > 0 && <ShelfList items={p.holding} viewerId={member?.id} showOwner />}
      </section>
    );
  };

  return (
    <div className="shelf-page">
      <h1>Natalie's Little Library</h1>
      {member === null || state.status === "lost" ? (
        <SignIn returnTo={returnTo} />
      ) : state.status === "failed" || state.status === "gone" ? (
        <Trouble onRetry={retry} />
      ) : state.status === "ok" ? (
        <>
          <h2>People</h2>
          {error !== undefined && <p role="alert" className="refusal">{error}</p>}
          {state.data.length === 0 ? <p>You haven't lent a book to anyone without an account yet.</p> : state.data.map(one)}
        </>
      ) : null}
    </div>
  );
}
