# Uroboros

A TypeScript monorepo that replaces ytdl-material: a self-hosted web UI and API for downloading
and managing media.

## Quickstart

```sh
mise trust && mise install   # pinned toolchain, git hooks, workspace dependencies
pnpm test                    # run the tests
mise run fmt                 # format everything
mise tasks                   # list every task
```

Workspaces live in `apps/*`, `packages/*` and `tools/*`.
