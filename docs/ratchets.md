# Ratchets

A ratchet is a CI gate that lets a number move in one direction only. Each one has a cap, and an
exception list for the rare case where the cap is genuinely wrong for one file or function. The
exception list holds **frozen numbers**: the exact current value, plus a reason.

All of them live in `tools/ratchet` (TypeScript, run on node's native type stripping, no build
step) and run through mise:

| Task                            | What it checks                                              |
| ------------------------------- | ----------------------------------------------------------- |
| `mise run ratchet:lines`        | no source file over 1000 lines                              |
| `mise run ratchet:complexity`   | cognitive complexity: function <= 25, file **sum** <= 200   |
| `mise run ratchet:suppressions` | per-file lint-suppression count may only fall               |
| `mise run ratchet:pins`         | toolchain pins and the supply-chain soak agree across files |
| `mise run ratchet`              | all four                                                    |
| `mise run ratchet:test`         | the ratchets' own unit tests                                |
| `mise run ci:parity`            | `ci.yml` and `[tasks.ci].depends` run the same set of tasks |

The CLI is `ratchet <lines|complexity|suppressions|pins|ci-parity|all>` (`pnpm exec ratchet ...`
from the repo root). Exit codes are the same for all of them: `0` pass, `1` violation, `2` layout or
tool error (a missing file, an unparseable config). A layout error is never treated as a pass.

## The shared rules for frozen exceptions

`lines`, `complexity` and `suppressions` share one policy (`tools/ratchet/src/frozen.ts`). An entry
is `{ "key", "value", "reason" }` in the matching list of `tools/ratchet/frozen.json`, and **the only
passing state for a frozen entry is "over the cap and exactly at its frozen number"**. Everything
else fails:

| Outcome     | Meaning                                             | Fix                                  |
| ----------- | --------------------------------------------------- | ------------------------------------ |
| offender    | over the cap and not in the list                    | bring it under the cap               |
| regression  | frozen, and the value grew                          | bring it back down                   |
| slack       | frozen, and the value shrank                        | lower the frozen number, same commit |
| stale       | frozen, but now at or under the cap                 | delete the entry                     |
| unknown     | the frozen key matches nothing (renamed or deleted) | fix or delete the entry              |
| duplicate   | the same key frozen twice                           | merge them                           |
| unjustified | the reason is 20 characters or fewer                | say why, and what would remove it    |

**Why slack fails.** If a file shrinks from 1200 lines to 1100 and the entry still says 1200, there
are now 100 lines of headroom that anyone can grow back into without the gate noticing. The
improvement is only kept if the number moves with it. Failing on slack forces that edit into the
same commit as the improvement. That is the "ratchet" part: every improvement becomes the new
ceiling.

**Why stale fails.** An entry that outlives its fix would let the next change push that file back
over the cap without anyone noticing.

`frozen.json` ships with empty lists (`{ "lines": [], "complexity": [], "suppressions": [] }`).
Keep them that way where you can. Adding an entry should be rare enough that a reviewer asks about
it.

Each ratchet also has a `MIN_SCANNED` floor. A scan that finds fewer files than that is treated as
broken (wrong root, broken git listing), not as clean. That stops the gate passing when it has
checked nothing. Raise the floor as the repo grows.

## Which files are governed

The file set is `git ls-files --cached --others --exclude-standard`: what would be committed.
`.gitignore` therefore excludes build output and `node_modules` with no skip list to drift. Of those
files, `lines`, `complexity` and `suppressions` govern `*.ts`, `*.tsx`, `*.js` and `*.mjs`, and skip
anything under a `generated/` or `dist/` directory (nobody can act on a complaint about generated
code). Test fixtures that must contain forbidden content live under `tools/ratchet/fixtures/` with a
`.fixture` extension for the same reason.

## `ratchet:lines`

- **Measures:** physical lines (comments and blanks included) of every governed file. Any governed
  file that contains a NUL byte also fails, and that cannot be excepted: git would treat the file as
  binary and drop it from every diff.
- **Cap:** 1000 lines, inclusive.
- **Exception list:** `lines` in `tools/ratchet/frozen.json`, key = repo-relative path.
- **Updating:** split the file along a seam that already exists. Only freeze it if splitting is
  genuinely wrong. When a frozen file shrinks, lower its number in the same commit.

## `ratchet:complexity`

- **Measures:** cognitive complexity (SonarSource's definition) of every function in every
  governed file. It is `eslint-plugin-sonarjs`'s `cognitive-complexity` rule, run through ESLint's
  Node API at threshold 0 so that every function with a non-zero score is reported. The score is
  parsed out of the message text. The run uses its own override config that enables only that rule
  (plus a collector that records function names), so no other lint rule affects the measurement, and
  inline ESLint disable comments cannot hide a score.
- **Not the ESLint `complexity` rule.** That one measures cyclomatic complexity (it counts every
  branch), which punishes a flat `switch` dispatch far beyond its real difficulty. The root ESLint
  config keeps `complexity: 15` as a fast editor guard rail; this gate is the one that ratchets.
- **Caps:** each function <= 25. Each file: the **sum** of its functions' scores <= 200.
- **The file cap is a sum.** Moving code into a helper function in the same file does not lower it,
  because the helper's score still counts toward the same file. To bring a file under the cap, move
  code into a sibling module. To bring a function under its cap, extracting a helper does work.
- **Exception list:** `complexity` in `tools/ratchet/frozen.json`. A function key is
  `path/to/file.ts::functionName`, with a `#N` suffix (1-based order of appearance) when one file has
  several functions of the same name. Methods and object-literal functions use their bare name,
  anonymous functions are `<anonymous>`. A key without `::` is a file key (the summed score).
  Tolerance is +0.

## `ratchet:suppressions`

- **Measures:** the number of lint escape hatches in each governed file: occurrences of the ESLint
  disable directive (every form), `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck`.
- **Cap:** zero per file.
- **Exception list:** `suppressions` in `tools/ratchet/frozen.json`, recording each file's exact
  count.
- **Updating:** prefer fixing the lint. If a suppression is really warranted, narrow it to one line
  and say why, then freeze the file at its new count, with a reason. Removing a suppression means
  lowering the count in the same commit. Otherwise the gate fails on slack.

## `ratchet:pins`

This one has no exception list. It is an equality check between files that each hold a copy of the
same pin, parsed with real parsers (TOML, JSON, JSON5, YAML), not regexes over text:

- **pnpm:** `.mise/config.toml` `[tools].pnpm` = `package.json` `packageManager` = `package.json`
  `devEngines.packageManager.version` = `Dockerfile` `ARG PNPM_VERSION`. The same `devEngines`
  entry must also say `"onFail": "error"`, so `npm install` fails.
- **node:** `.mise/config.toml` `[tools].node` = `Dockerfile` `ARG NODE_VERSION`, and it must satisfy
  the `>=` lower bound of `package.json` `engines.node`.
- **soak:** every `minimumReleaseAge` in `.renovaterc.json5` (`"3 days"`) matches
  `pnpm-workspace.yaml` `minimumReleaseAge` (`4320` minutes). If the two disagree, Renovate opens
  PRs that pnpm then refuses to install.

The `Dockerfile` is mandatory: a missing file (a symlink to one counts), or a missing
`ARG NODE_VERSION` or `ARG PNPM_VERSION`, is a layout error (exit 2).

**Updating:** change every copy in one commit. Renovate groups each tool's pins into a single PR
("node", "pnpm") for this reason. If a pin turns up in a new file, add it to
`tools/ratchet/src/pins.ts` and to the matching group in `.renovaterc.json5`.

## `ci:parity`

- **Checks:** the set of tasks that `.github/workflows/ci.yml` runs as `mise run` steps equals
  `[tasks.ci].depends` in `.mise/config.toml`, in both directions. If either set is empty, or
  `ci.yml` is missing, the check is a layout error (exit 2), never a pass.
- **Why:** `mise run ci` promises "if this passes locally it passes in CI". A gate added to only one
  side breaks that promise without anyone noticing.
- **Updating:** a new gate is a new task, one step in `ci.yml`, and one entry in `depends`, all
  added together.

## Pre-push hook

`.lefthook.toml` runs `mise run ratchet` before every push, so a too-long file, a new suppression, a
too-complex function or a split pin fails locally instead of costing a CI round-trip. Skip it once
with `LEFTHOOK_EXCLUDE=ratchets git push`.
