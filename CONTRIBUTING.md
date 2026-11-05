# Contributing

## Branches

- **`main` is the only long-lived branch.** It is always the latest coherent,
  runnable version, and CI must be green on it.
- Do each change on a short-lived branch from `main` (`feat/…`, `fix/…`,
  `docs/…`, `chore/…`), open a PR, and delete the branch after it merges.
- Milestones are **tags**, not branches: `v0.1.0` … `v0.4.0`. To run an old
  stage, `git checkout v0.2.0`. Unmerged work worth keeping becomes an
  `archive/*` tag before its branch is deleted. See
  [docs/history/MILESTONES.md](docs/history/MILESTONES.md).

## Planning

- The build plan is [ROADMAP.md](ROADMAP.md). Every item on it is a GitHub
  issue labelled with its phase (`phase: 0.5 field test`, `phase: 0.6`,
  `phase: later`).
- New ideas start as an issue, not a branch. Say which hypothesis or finding
  the idea serves.
- Labels are defined in [.github/labels.json](.github/labels.json) and synced
  by a workflow. Edit the file, not the labels page.

## Checks

```bash
npm ci
npm run typecheck   # app, server and Worker
npm test
npx vite build
```

CI runs the same steps on every PR.

## The one rule

> AI may interpret and propose. It may not silently rewrite collective memory.

A PR that lets any AI path change canonical state without a person deciding is
a bug, however convenient.
