# Handoff: caching and layout shift

Updated 2026-11-28. The design is approved and the implementation plan is
committed. The next session builds PR 1.

## Start here

1. Work on the branch `caching-and-shift`. Rebase it on `main` first. Every
   change reaches `main` through a pull request (see `AGENTS.md`).
2. Read the plan, `docs/superpowers/plans/2026-11-28-caching-and-shift.md`,
   and the design it implements,
   `docs/superpowers/specs/2026-11-28-caching-and-shift-design.md`.
   - The design is the source of truth. Don't reopen what it decided. Calls
     marked **(call)** were checked by the maintainer while reading.
3. Build **PR 1: Tasks 1–10**, with `superpowers:subagent-driven-development`.
   - Every task gets the ordinary task review and an antagonist pass
     (`.claude/agents/antagonist.md`). Their findings go back into the fix loop
     before the next task starts.
4. **The maintainer wants a clean session for each major step.** Task 10 ends
   with `gh pr create`. Then stop:
   - Update this handoff for PR 2 (Tasks 11–13, on a new branch `layout-shift`
     from `main` after PR 1 merges).
   - Update the `caching-and-shift` memory.
   - Alert the maintainer.
   - Merging waits for the maintainer's approval.
5. Committed text says "the maintainer", never a name.

## Evidence the next steps can reuse

- **The design review's probes** (`anch.mjs`, `cls.mjs`, `cls2.mjs`, `geo.mjs`)
  are still in session `bff88c04`'s scratchpad, under `probe/`. They may vanish.
  The plan says how to rebuild what Tasks 9 and 11 need from
  `scripts/shoot.mjs`.
  - `anch.mjs`: native scroll anchoring against a chips-row correction.
  - `cls.mjs`: a buffered `layout-shift` observer, with a 100px-insert control.
- **Upstream cover behaviour** was observed with curl on the preview fixtures'
  ids (`src/client/preview/fixtures.ts`). The design records it under "How the
  cover hosts answer", and the Task 3 fixtures are shaped like it.
- **The stored Google cover URL** (`googleCover` in
  `src/worker/booklookup/sources.ts`) is
  `…/books/content?id=…&printsec=frontcover&img=1&zoom=1&source=gbs_api`.
  That fits the design's `gb` shape, so Google covers are proxied too.

## Tools already in the repo

- **`scripts/shoot.mjs`** takes true-width headless Chrome screenshots. For
  sticky UI or measurements, copy it to the scratchpad with
  `captureBeyondViewport: false` and an eval hook.
- **The dev preview** is at `/src/client/preview/preview.html?view=wall`
  (`&loading`, `&q=`, `&status=`, `&collection=`).
  - Task 9 adds `&remember` and `&grow`.
  - Task 11 adds `&loadfor=<ms>`.
  - The real screens need a Google sign-in, which only the maintainer can do.

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
