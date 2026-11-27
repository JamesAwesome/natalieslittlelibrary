# Agent instructions

## Changes go through pull requests

- Every change reaches `main` by a pull request. Never commit on `main` or push to it; GitHub refuses it anyway (the "protect main" ruleset, see README → Deploying).
- Start from an up-to-date `main` on a branch of its own, one branch per piece of work. Push the branch and open the pull request with `gh pr create`.
- The `app` CI check must pass on a branch that is up to date with `main` before it can merge.
- An agent merges only with James's approval. Without it, opening the pull request is where an agent's work ends.

## Releases are James's call

- A release is an annotated `v*.*.*` tag on `main`; CI applies migrations and deploys it. An agent creates a tag only with James's approval, and never moves or deletes one.
- Never run `wrangler deploy`, `wrangler secret put`, `wrangler login`, or a `--remote` command that writes. A read-only `--remote` query needs James's word each time.
- Never change repository settings, rulesets or the `production` environment.

## Private data

- `storygraph_export.csv` is Natalie's private reading data and `.dev.vars` holds secrets. Never commit, print or send either to an outside service. To check the export, print headers and counts only.
