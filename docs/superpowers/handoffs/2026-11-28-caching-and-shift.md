# Handoff: caching and layout shift

Updated 2026-11-28. The design doc is written and the maintainer has approved
it. The next session writes the implementation plan.

## Start here

1. Work on the branch `caching-and-shift`. Rebase it on `main` first. Every
   change reaches `main` through a pull request (see `AGENTS.md`).
2. Read the approved design:
   `docs/superpowers/specs/2026-11-28-caching-and-shift-design.md`.
   - It is the source of truth. Where it differs from the plan this handoff
     used to carry, the design wins, because each difference came from
     evidence:
     - the memory lives in `sessionStorage`
     - Open Library's archive.org redirects are followed
     - the skeleton is judged by tile position, not CLS
     - there are no fallback fonts
   - Don't reopen what it decided. Calls marked **(call)** were checked by the
     maintainer while reading.
3. Invoke `superpowers:writing-plans` and write the plan to
   `docs/superpowers/plans/2026-11-28-caching-and-shift.md`. Commit it on the
   branch.
   - The plan covers two PRs: PR 1, caching, then PR 2, layout shift. PR 2
     branches from `main` after PR 1 merges.
   - Every task gets a reviewer and an antagonist (`.claude/agents/antagonist.md`).
4. **The maintainer wants a clean session for each major step.** Once the plan
   is written and committed, stop. Update this handoff to point at the plan,
   update the `caching-and-shift` memory, push, and alert the maintainer.
   Don't start building PR 1 in the same session.
5. Committed text says "the maintainer", never a name.

## Evidence the next steps can reuse

- The antagonist's scratch work from the design review is in the session
  scratchpad, and may be gone. The probes are worth rebuilding in the plan:
  - `anch.mjs`: native scroll anchoring against a chips-row correction.
  - `cls.mjs`: a buffered `layout-shift` observer, with a 100px-insert control.
  - A preview copy with `loadfor`.
- Upstream cover behaviour was observed with curl on the preview fixtures' ids
  (`src/client/preview/fixtures.ts`). The design records it under "How the
  cover hosts answer". Test fixtures should be shaped like it.
- The antagonist's technique proposal: CLS doesn't score a React swap of the
  skeleton, so measure the first content box's rect across the swap. Add it to
  `.claude/agents/antagonist-techniques.md` as part of PR 2.

## Tools already in the repo

- **`scripts/shoot.mjs`** takes true-width headless Chrome screenshots. For
  sticky UI or measurements, copy it to the scratchpad with
  `captureBeyondViewport: false` and an eval hook.
- **The dev preview** is at `/src/client/preview/preview.html?view=wall`
  (`&loading`, `&q=`, `&status=`, `&collection=`). The real screens need a
  Google sign-in, which only the maintainer can do.

## Off limits

- `storygraph_export.csv` and `.dev.vars` (`AGENTS.md`).
- Don't fetch covers by the library's own ISBNs. Use the preview fixtures' ids
  or well-known public ISBNs.
- No `wrangler deploy`, and no `--remote` writes. Releases are tags the
  maintainer approves.

## Still open from earlier releases

Phone checks the maintainer hasn't done yet:
- **v0.9.0:** iOS doesn't zoom when the find box is tapped; the search key
  dismisses the keyboard; the 104px row feels right.
- **Earlier ones:** listed in the release PRs (#18, #21, #22).
