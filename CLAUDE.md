# CLAUDE.md

Uroboros: a TypeScript pnpm monorepo (`apps/*`, `packages/*`, `tools/*`, packages named
`@uroboros/*`). Tools and tasks all come from mise (`.mise/config.toml`).

## Quickstart

```sh
mise trust && mise install
pnpm test
mise run fmt:check
```

## Principles

- Pins live in `.mise/config.toml` and `package.json`; change every copy in one commit.
- Task bodies run under POSIX `sh`, not bash.
- Never lower `minimumReleaseAge` in `pnpm-workspace.yaml`.
