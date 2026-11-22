# Uroboros Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A green-CI TypeScript monorepo with the rust-ui-template's tooling, a typed Hono API (`/api/health`, `/api/info`, docs), a BullMQ worker skeleton, a safe migration runner, a real-Postgres/Valkey test harness, the React shell, container images and a Helm chart. Every later feature step builds on it.

**Architecture:** This is a pnpm workspace. `packages/contract` holds the Zod wire schemas, which are the only source of API types. `apps/server` is one package with four entrypoints (`api`, `worker`, `migrate`, `gen`), bundled by tsdown into single `.mjs` files. `apps/web` is the SPA. mise owns every tool pin and task, and CI only calls `mise run <task>`.

**Tech Stack:** Node 24.21.0, pnpm 12.12.1, TypeScript (both packages the template pins), Hono + `@hono/zod-openapi` + `@hono/swagger-ui`, Zod 4, Kysely + `pg`, BullMQ + ioredis on Valkey 8, vitest + `@testcontainers/postgresql` + `testcontainers`, React 19 + Vite 8 + TanStack Query + TanStack Router + Tailwind 4 + shadcn/ui, tsdown, Helm 3 + kubeconform, oxfmt, lefthook, Renovate, git-cliff.

**Spec:** `docs/superpowers/specs/2026-11-21-uroboros-design.md`

**Template:** `/PM9A3/.repos/rust-ui-template` (abbreviated `TPL/` below). Tasks say "port from TPL/x": copy the file, delete everything Rust/cargo, rename `app`→`uroboros`, keep the comments that still apply.

## Global Constraints

Node `24.21.0`, pnpm `12.12.1`, both pinned in `.mise/config.toml`, the root `package.json` (`packageManager`, `devEngines`, `engines.node: ">=24.21.0"`) and the Dockerfile `ARG`s, and kept equal by `ratchet:pins`.

The supply-chain soak is `minimumReleaseAge: 4320` in `pnpm-workspace.yaml`, equal to `minimumReleaseAge: "3 days"` in `.renovaterc.json5`.

Ratchets: no source file over 1000 lines. Cognitive complexity is at most 25 per function and at most 200 summed per file. The suppression count per file may only fall. Frozen-exception semantics are exactly `TPL/docs/ratchets.md` (offender/regression/slack/stale/unknown/duplicate/unjustified). Exit codes: 0 pass, 1 violation, 2 layout/tool error.

`mise run ci` is the definition of done, and `ci:parity` keeps it equal to the `mise run` steps in `.github/workflows/ci.yml`.

Wire types are defined only in `packages/contract`. `apps/web` imports only the package root `@uroboros/contract`, never deep paths, and never declares API JSON shapes itself.

Errors are `{ code, message }` with `code` from the `ApiErrorCode` enum, including for unknown `/api/*` routes.

No 64-bit integers on the wire. Ids are UUID strings.

Env vars: `UROBOROS_BIND` (default `127.0.0.1:8080`, images set `0.0.0.0:8080`), `DATABASE_URL` (required), `VALKEY_URL` (required), `UROBOROS_WEB_DIST` (optional path to the built SPA). Test overrides are `UROBOROS_TEST_DATABASE_URL` and `UROBOROS_TEST_VALKEY_URL`.

Migrations are forward-only `.sql` files named `migrations/<YYYYMMDDHHMMSS>_<name>.sql`. A shipped file is never edited. They are applied only by the `migrate` entrypoint, never on API or worker startup.

The API process never spawns yt-dlp or ffmpeg.

## Review Focus

1. **Two `migrate` Jobs run at once** (a Helm upgrade racing a manual run). Exactly one applies the migrations, the other waits and then finds nothing to do, and neither fails. This is pinned in Task 4.
2. **A shipped migration file is edited.** `migrate` refuses with exit code 1 and names the file. It must not skip the edit silently or re-run the file. Pinned in Task 4.
3. **Postgres or Valkey is unreachable while the API runs.** `/api/health` still answers 200 with `status: "degraded"` and names the failing dependency, and the process does not crash-loop. Pinned in Task 5.
4. **A worker gets SIGTERM mid-job** (rolling deploy). The worker stops taking new jobs and lets the active job finish within the grace period. A job killed outright is retried by another worker via BullMQ stall detection, not lost. Pinned in Task 7.
5. **A deep link is hard-refreshed (`/library/abc`), and an unknown API path is hit (`/api/nope`).** The first serves `index.html`. The second returns a JSON 404 `ApiErrorBody`, never the SPA HTML. Pinned in Task 5.

---

### Task 1: Workspace skeleton and toolchain

**Files:**
- Create: `.mise/config.toml`, `.mise/mise.lock`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `.oxfmtrc.json`, `.prettierignore`, `.editorconfig`, `.gitignore`, `.dockerignore`, `.lefthook.toml`, `.renovaterc.json5`, `cliff.toml`, `.git-blame-ignore-revs`, `LICENSE` (MIT), `README.md`, `CLAUDE.md`
- Test: `tools/smoke.test.ts` (deleted in Task 2 once real tests exist)

**Interfaces:**
- Produces: workspace globs `apps/*`, `packages/*`, `tools/*`. A root `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module`/`moduleResolution: "nodenext"`, `verbatimModuleSyntax`). A root eslint flat config that every package's `eslint.config.js` re-exports and extends. The tasks `fmt`, `fmt:check`, `install` (`pnpm install --frozen-lockfile`), `lint:workflows`, `lint:shell`, `lint:renovate`, `changelog`.

- [ ] **Step 1: Port `.mise/config.toml` from TPL.** Keep `node`, `pnpm`, `oxfmt`, `lefthook`, `shellcheck`, `actionlint`, `aqua:zizmorcore/zizmor` and `git-cliff` at TPL's versions. Add `helm` and `aqua:yannh/kubeconform` at their latest releases older than 3 days. Drop rust, nextest and cargo-deny. Keep `[settings]`, `[settings.node]`, `[settings.npm]` and the `[hooks]` comment rationale, and change the postinstall to `pnpm install --frozen-lockfile` at the root. Port `fmt` (oxfmt only), `fmt:check`, `lint:workflows`, `lint:shell`, `lint:renovate` and `changelog`.
- [ ] **Step 2: Port the remaining root files from TPL.** These are `pnpm-workspace.yaml` (add `packages:`, keep `minimumReleaseAge: 4320` and `allowBuilds`), `.lefthook.toml` (drop format-rust, and make `exclude` mirror the new `.prettierignore`: `api/openapi.json`, `CHANGELOG.md`, `.mise/mise.lock`, `pnpm-lock.yaml`), `.renovaterc.json5` (drop the cargo/rust rules, keep npm, docker, github-actions, mise and the soak), `cliff.toml`, `.editorconfig` and `.oxfmtrc.json`. Root eslint takes TPL's `web/eslint.config.js` rules, minus react-hooks (that moves to web), and adds typescript-eslint `strictTypeChecked` with `projectService: true`. The design calls for strict-type-checked, so TPL's parser-only comment no longer applies; delete it.
- [ ] **Step 3: Write `tools/smoke.test.ts`** with `expect(1 + 1).toBe(2)` and a root `vitest.workspace` style `vitest.config.ts` using `projects: ["apps/*", "packages/*", "tools/*"]`.
- [ ] **Step 4: Run.** `mise trust && mise install && mise lock --platform linux-x64,linux-arm64,macos-x64,macos-arm64 && pnpm vitest run && mise run fmt:check && mise run lint:shell && mise run lint:renovate`. Expected: everything exits 0, and `.mise/mise.lock` is created.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "chore: workspace skeleton and pinned toolchain"`

### Task 2: Ratchets and CI parity (`tools/ratchet`)

**Files:**
- Create: `tools/ratchet/package.json` (`@uroboros/ratchet`, bin `ratchet`), `tools/ratchet/src/{main,frozen,lines,suppressions,complexity,pins,ciParity,repo,report}.ts`, `tools/ratchet/frozen.json` (starts as `{ "lines": [], "complexity": [], "suppressions": [] }`), `docs/ratchets.md` (port TPL's, with TS specifics)
- Test: `tools/ratchet/src/*.test.ts`, with fixtures in `tools/ratchet/fixtures/`
- Delete: `tools/smoke.test.ts`

**Interfaces:**
- Produces: `type Frozen = { key: string; value: number; reason: string }`. `evaluate(measured: Map<string, number>, cap: number, frozen: Frozen[]): Finding[]`, where `Finding = { kind: "offender" | "regression" | "slack" | "stale" | "unknown" | "duplicate" | "unjustified"; key: string; value?: number; frozen?: number }`. CLI `ratchet <lines|complexity|suppressions|pins|ci-parity|all>` exits 0, 1 or 2. Tracked files come from `git ls-files`, filtered to `*.{ts,tsx,js,mjs}` and excluding `api/openapi.json`, `**/dist/**` and generated files.
- Consumes: `.mise/config.toml`, `Dockerfile`, `package.json`, `pnpm-workspace.yaml`, `.renovaterc.json5`, `.github/workflows/ci.yml`.

Complexity is measured with `eslint-plugin-sonarjs`'s `cognitive-complexity` rule, which is SonarSource cognitive complexity, the same metric arborist computes. It runs through ESLint's Node API at threshold `0`, so every function reports its score, and each message's score is parsed out. This changes the design doc, because arborist is a Rust crate. Per-file totals are the sum of those scores. Suppressions are counted as occurrences of `eslint-disable`, `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck`.

- [ ] **Step 1: Write the failing tests.** `frozen.test.ts` gets one test per outcome, with these exact cases. Cap 10: measured `{a: 12}` with nothing frozen gives `offender`. Frozen `a=11` and measured 12 gives `regression`. Frozen `a=13` and measured 12 gives `slack`. Frozen `a=9` and measured 9 gives `stale`. Frozen `zzz` (no such key) gives `unknown`. Two entries for `a` give `duplicate`. A reason `"too long"` (≤20 chars) gives `unjustified`. Frozen `a=12` with measured 12 and a 21+ char reason gives `[]`. `lines.test.ts`: a 1001-line fixture is an offender, and a 1000-line one passes. `suppressions.test.ts`: a fixture with 2 `eslint-disable-next-line` and 1 `@ts-expect-error` measures 3. `complexity.test.ts`: fixture `nested.ts` (an `if` inside a `for` inside a function, which scores 3) measures 3 for that function. A file whose functions sum to 201 is a file-sum offender. `pins.test.ts`: fixtures where the mise node is `24.21.0` and the Dockerfile `ARG NODE_VERSION=24.20.0` give a violation naming both files; a pnpm `packageManager` mismatch is a violation; a `minimumReleaseAge` of 4320 against Renovate's `"3 days"` passes, and 1440 fails. `ciParity.test.ts`: the ci.yml steps `{a,b}` against depends `{a,b,c}` give a violation listing `c`, and a missing ci.yml gives exit code 2.
- [ ] **Step 2: Run them to see them fail.** `pnpm -F @uroboros/ratchet vitest run`. Expected: FAIL with modules not found.
- [ ] **Step 3: Implement** the modules with the signatures above. `main.ts` maps findings to exit code 1 and layout errors (missing file, unparseable TOML/JSON5/YAML) to 2.
- [ ] **Step 4: Run them to see them pass.** Expected: PASS. Then run `pnpm -F @uroboros/ratchet exec ratchet all` against the repo. Expected: exit 0.
- [ ] **Step 5: Add the mise tasks.** These are `ratchet:lines`, `ratchet:complexity`, `ratchet:suppressions`, `ratchet:pins`, `ratchet` (all four), `ratchet:test` and `ci:parity`, each a one-liner calling the bin. Add the pre-push hook from TPL.
- [ ] **Step 6: Commit.** `git commit -m "feat(ratchet): port ratchets and ci-parity to TypeScript"`

### Task 3: Wire contract (`packages/contract`)

**Files:**
- Create: `packages/contract/package.json` (`@uroboros/contract`, `exports: { ".": "./src/index.ts" }`), `packages/contract/src/{index,errors,system}.ts`
- Test: `packages/contract/src/contract.test.ts`

**Interfaces:**
- Produces: `ApiErrorCode = z.enum(["bad_request", "unauthorized", "forbidden", "not_found", "conflict", "internal", "unavailable"])`, `ApiErrorBody = z.object({ code: ApiErrorCode, message: z.string() })`, `HealthStatus = z.enum(["ok", "degraded"])`, `DependencyName = z.enum(["database", "valkey"])`, `Health = z.object({ status: HealthStatus, failing: z.array(DependencyName) })` and `Info = z.object({ name: z.literal("uroboros"), version: z.string() })`. Each is registered with `.openapi("<Name>")` and exported with a same-named type via `z.infer`. Also `apiErrorStatus: Record<ApiErrorCode, 400|401|403|404|409|500|503>` maps codes to 400, 401, 403, 404, 409, 500 and 503 in enum order.

- [ ] **Step 1: Write the failing test.** `ApiErrorBody.parse({code:"not_found",message:"x"})` succeeds, and `{code:"teapot"}` throws. `Health.parse({status:"degraded",failing:["valkey"]})` succeeds. `Object.keys(apiErrorStatus).sort()` equals `ApiErrorCode.options.slice().sort()`. A type-level test, `expectTypeOf<Info["name"]>().toEqualTypeOf<"uroboros">()`.
- [ ] **Step 2: Run** `pnpm -F @uroboros/contract vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement** the schemas exactly as listed in Interfaces.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(contract): system and error wire schemas"`

### Task 4: Server config, database, migration runner and test harness

**Files:**
- Create: `apps/server/package.json` (`@uroboros/server`), `apps/server/src/config.ts`, `apps/server/src/db/{kysely,schema}.ts`, `apps/server/src/migrate/{runner,main}.ts`, `apps/server/test/{globalSetup,testDb,testValkey}.ts`, `apps/server/vitest.config.ts`
- Test: `apps/server/src/config.test.ts`, `apps/server/src/migrate/runner.test.ts`, with fixture dirs in `apps/server/test/fixtures/migrations-{ok,edited,bad-sql}/`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config`, where `Config = { bind: { host: string; port: number }; databaseUrl: string; valkeyUrl: string; webDist: string | null }`. It throws `ConfigError` (message lists every missing or invalid var) on a bad env. `createDb(url: string): Kysely<Database>`, where `Database` in `schema.ts` starts empty (`interface Database {}`) and later steps add tables. `runMigrations(db: Kysely<Database>, dir: string): Promise<{ applied: string[] }>`. `migrate/main.ts` exits 0 on success, 1 on `MigrationError` (edited or failed file; the message names the file) and 2 on config error. Test helpers: `TestDb.create(): Promise<{ db: Kysely<Database>; url: string; close(): Promise<void> }>` and `TestValkey.url(): string` (plus `flush()`).

Runner algorithm: take `pg_advisory_lock(hashtext('uroboros_migrate'))` on a dedicated connection. Create `schema_migrations(name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())` if it is absent. For every file already applied, compare its sha256 and throw `MigrationError` on a mismatch. Apply each pending file in its own transaction, in filename order, inserting its row in the same transaction. Unlock in `finally`.

The harness `globalSetup` starts `postgres:18-alpine` and `valkey/valkey:8-alpine` once per run, unless the `UROBOROS_TEST_*` vars are set. It migrates a database called `uroboros_template` from the real `migrations/` and marks it `IS_TEMPLATE`. It provides URLs via vitest `provide`. `TestDb.create` runs `CREATE DATABASE test_<random> TEMPLATE uroboros_template`, and `close` drops it. Containers stop in the globalSetup teardown, and testcontainers' Ryuk reaper covers crashes. This replaces TPL's detached owner process.

- [ ] **Step 1: Write the failing tests.** `config.test.ts`: an empty env throws `ConfigError` whose message contains both `DATABASE_URL` and `VALKEY_URL`. `UROBOROS_BIND="0.0.0.0:9000"` gives `{host:"0.0.0.0",port:9000}`. A missing bind defaults to `127.0.0.1:8080`. `UROBOROS_BIND="nope"` throws. `runner.test.ts` (its database comes from a separate `CREATE DATABASE` with no template, so it starts empty): `migrations-ok` (2 files) applies `["…_a.sql","…_b.sql"]`, and a second run applies `[]`. **Concurrent:** `Promise.all` of two `runMigrations` calls on two separate pools gives exactly one call with 2 applied and one with 0, and no rejection. **Edited:** apply `migrations-ok`, then run against `migrations-edited` (same names, one byte changed in `_a`). It rejects with `MigrationError` whose message contains `_a.sql`. **Bad SQL:** `migrations-bad-sql` (good `_a`, broken `_b`) rejects, `schema_migrations` holds only `_a`, and none of `_b`'s partial effects remain.
- [ ] **Step 2: Run** `pnpm -F @uroboros/server vitest run src/config.test.ts src/migrate`. Expected: FAIL.
- [ ] **Step 3: Implement** `config.ts` (a Zod schema over env), `db/kysely.ts` (`PostgresDialect` with a `pg.Pool`), `migrate/runner.ts`, `migrate/main.ts`, and the test harness.
- [ ] **Step 4: Run.** Expected: PASS. Docker must be available, and the `UROBOROS_TEST_*` path is exercised in CI on Forgejo.
- [ ] **Step 5: Add a placeholder.** Add `migrations/.gitkeep` and mise tasks `dev:deps` (`docker compose -f dev/compose.yaml up postgres valkey`) and `migrate` (`pnpm -F @uroboros/server exec tsx src/migrate/main.ts`).
- [ ] **Step 6: Commit.** `git commit -m "feat(server): config, kysely, locked checksummed migrations, test harness"`

### Task 5: API (`apps/server/src/api`)

**Files:**
- Create: `apps/server/src/api/{app,errors,health,info,spa,main}.ts`
- Test: `apps/server/src/api/app.test.ts` (in-process `app.request`), `apps/server/src/api/e2e.test.ts` (real socket)

**Interfaces:**
- Consumes: `Config`, `createDb`, and the contract schemas.
- Produces: `type Deps = { db: Kysely<Database>; valkey: Redis; version: string }`. `createApp(deps: Deps, opts: { webDist: string | null }): OpenAPIHono`. `class ApiError extends Error { constructor(code: ApiErrorCode, message: string) }`, which the `onError` handler renders as `ApiErrorBody` with `apiErrorStatus[code]`. Any other thrown error becomes `internal`, with the message hidden and the error logged. The routes are `GET /api/health` → `Health`, `GET /api/info` → `Info`, `GET /api/openapi.json`, `GET /api/docs` (Swagger UI) and `ALL /api/*` → 404 `not_found`. With `webDist` set, static files are served, and any other non-`/api` GET falls back to `index.html`. `main.ts` reads config, creates deps, serves via `@hono/node-server`, and closes the server, pool and Valkey on SIGTERM. Logging uses pino as JSON lines.

Health runs `SELECT 1` and `PING` in parallel, each with a 2 s timeout. Any failure gives `degraded` with that dependency in `failing`, and the HTTP status stays 200. The ioredis client uses `lazyConnect: false`, `maxRetriesPerRequest: 1` and `enableOfflineQueue: false`, so a Valkey outage fails fast instead of hanging.

- [ ] **Step 1: Write the failing tests.** In `app.test.ts`, with a `TestDb` and `TestValkey`: health returns 200 with `{status:"ok",failing:[]}`. With a db whose pool points at a closed port, it returns 200 with `{status:"degraded",failing:["database"]}`. With Valkey pointing at a closed port, `failing` is `["valkey"]`, the response arrives in under 3 s, and nothing is thrown. `/api/info` returns `{name:"uroboros",version}`. `GET /api/nope` returns 404, `content-type` JSON, and a body that parses as `ApiErrorBody` with `code:"not_found"`. A test route that throws `new Error("secret")` returns 500 with `code:"internal"`, and the body does not contain `"secret"`. `/api/openapi.json` has `components.schemas` keys that include `Health`, `Info` and `ApiErrorBody`. SPA: with a temp `webDist` holding `index.html` and `assets/a.js`, `GET /library/abc` returns 200 `text/html`, `GET /assets/a.js` returns JS, and `GET /api/nope` is still the JSON 404. `e2e.test.ts` starts `main`'s serve on port 0 and fetches `/api/health`, expecting 200.
- [ ] **Step 2: Run** `pnpm -F @uroboros/server vitest run src/api`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Add the mise task** `dev:api` (`tsx watch src/api/main.ts`, defaulting `DATABASE_URL` and `VALKEY_URL` to the `dev:deps` containers).
- [ ] **Step 6: Commit.** `git commit -m "feat(api): health, info, typed errors, openapi docs, spa fallback"`

### Task 6: Codegen and drift gate

**Files:**
- Create: `apps/server/src/gen/main.ts`, `api/openapi.json` (generated)
- Test: `apps/server/src/gen/gen.test.ts`

**Interfaces:**
- Consumes: `createApp`. The document is built with stub deps that are never called, so no database is needed.
- Produces: `renderOpenApi(): string`, which returns deterministic JSON (keys sorted, 2-space indent, trailing newline) with `info.title` `"Uroboros API"` and `info.version` from `apps/server/package.json`. The CLI is `gen [--check]`. `--check` exits 1 and prints a diff summary when `api/openapi.json` differs. The mise tasks are `gen` and `check:gen`.

- [ ] **Step 1: Write the failing test.** `renderOpenApi()` called twice gives identical strings. The parsed `paths` include `/api/health` and `/api/info`. Every `components.schemas` key is exported from `@uroboros/contract`, compared against `Object.keys(await import("@uroboros/contract"))`, so a schema can't appear on the wire without being in the contract.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests, then `mise run gen && mise run check:gen`.** Expected: PASS and exit 0. Hand-edit `api/openapi.json`, run `check:gen`, and expect exit 1. Then revert the edit.
- [ ] **Step 5: Commit.** `git commit -m "feat(gen): committed openapi.json with drift gate"`

### Task 7: Worker skeleton (`apps/server/src/worker`)

**Files:**
- Create: `apps/server/src/worker/{main,queues,system}.ts`, `apps/server/src/shared/valkey.ts`
- Test: `apps/server/src/worker/worker.test.ts`

**Interfaces:**
- Produces: `createValkey(url: string, role: "api" | "worker"): Redis`. Worker connections use `maxRetriesPerRequest: null`, as BullMQ requires, and API connections use the fail-fast options from Task 5. `QUEUE_NAMES = { system: "system" } as const`, which later steps extend with `download`, `transcode` and `automation`. `startWorker(opts: { valkeyUrl: string; concurrency: number; shutdownGraceMs: number }): Promise<{ close(): Promise<void> }>`. It registers a `system` processor that handles job `ping` (`{ at: string }` → returns `{ pong: true }`). It writes a heartbeat key `uroboros:worker:<hostname>:<pid>` with a 30 s TTL every 10 s. On SIGTERM it calls `worker.close()`, which stops taking jobs and waits for active ones, with `shutdownGraceMs` (default 25000, under Kubernetes' 30 s) as a hard deadline. BullMQ `stalledInterval: 30000` and `maxStalledCount: 2`.

- [ ] **Step 1: Write the failing tests.** Enqueue `ping`, and `waitUntilFinished` returns `{pong:true}`. Heartbeat key exists with TTL ≤ 30. **Graceful:** register a test processor that awaits 500 ms, enqueue it, call `close()` while it runs, and the job completes; a job enqueued after `close()` began stays `waiting`. **Crash:** worker A takes a long job and is closed with `force: true`, which simulates a kill. Worker B, with a short `stalledInterval` for the test, completes the same job. Assert `attemptsMade` and that the processor body ran twice. That proves jobs need to be idempotent, which later steps rely on.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Add the mise task** `dev:worker`.
- [ ] **Step 6: Commit.** `git commit -m "feat(worker): bullmq worker skeleton with graceful shutdown and heartbeat"`

### Task 8: Web shell (`apps/web`)

**Files:**
- Create: port TPL `web/` to `apps/web/` (`package.json` as `@uroboros/web`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `index.html`, `src/main.tsx`, `src/index.css`, `src/test/setup.ts`). Add `src/api/client.ts` (ported), `src/router.tsx`, `src/routes/{root,index}.tsx`, `src/components/ui/*` (shadcn `button`, `badge`, `card`, `sonner`), `src/components/HealthBadge.tsx` and `components.json`.
- Delete from the port: `src/api/generated/`, `src/api/types.ts`, `types.test.ts`.
- Test: `src/api/client.test.ts` (ported), `src/components/HealthBadge.test.tsx`, `src/routes/root.test.tsx`

**Interfaces:**
- Consumes: `@uroboros/contract` (types and schemas). The eslint `no-restricted-imports` blocks `@uroboros/contract/*` deep paths and any `zod` import outside `src/api/`.
- Produces: `getJson<S extends z.ZodType>(path: string, schema: S, init?: RequestInit): Promise<z.infer<S>>`. Unlike TPL, it validates the response with the contract schema. A schema mismatch throws `ApiError(status, …, null)` with `code` `null`. `useHealth()` and `useInfo()`. `isApiErrorCode` uses `ApiErrorCode.options` in place of TPL's hand-listed record, which stays exhaustive because it comes from the enum. The root layout is a sidebar shell (nav: Library, Downloads, Subscriptions, Settings — placeholder routes that render "Coming soon"), a header with `HealthBadge`, dark mode via `prefers-color-scheme` with a toggle stored in localStorage (wrapped in try/catch).

- [ ] **Step 1: Write the failing tests.** Port TPL's `client.test.ts` and adapt it to schema-validated `getJson`. Add a case: a 200 response whose body is `{status:"weird"}` for `Health` throws `ApiError`. `HealthBadge`: mocked `ok` renders text "Healthy", mocked `degraded` with `["valkey"]` renders "Degraded" and "valkey", and a fetch failure renders "Unreachable". `root.test.tsx`: renders the four nav links, and navigating to `/downloads` shows "Coming soon".
- [ ] **Step 2: Run** `pnpm -F @uroboros/web vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement.** Initialize shadcn with Tailwind 4 and the `new-york` style, neutral base, CSS variables. Use TanStack Router's code-based routes (no file-route codegen, so there are no generated files to gate).
- [ ] **Step 4: Run** the tests, then `pnpm -F @uroboros/web build`. Expected: PASS, and `apps/web/dist/index.html` exists.
- [ ] **Step 5: Add the mise tasks** `dev:ui`, `build:ui`, `lint`, `check:types` (`pnpm -r exec tsc -b --noEmit`, using `@typescript/native` as TPL does) and `test` (`pnpm vitest run` at the root, all projects).
- [ ] **Step 6: Commit.** `git commit -m "feat(web): react shell with typed, validated api client and health badge"`

### Task 9: Bundling and container images

**Files:**
- Create: `apps/server/tsdown.config.ts`, `Dockerfile`, `dev/compose.yaml`, `docker/worker-requirements.txt` (pins `yt-dlp==<latest older than 3 days>` with `--hash`)
- Modify: `.renovaterc.json5` (pip_requirements manager for `docker/worker-requirements.txt`; `# renovate:` comments on Dockerfile ARGs)

**Interfaces:**
- Produces: `pnpm -F @uroboros/server build` writes `apps/server/dist/{api,worker,migrate,gen}.mjs`, with all dependencies bundled. The Dockerfile has targets `api` and `worker`. `api`: distroless Node 24 nonroot (`gcr.io/distroless/nodejs24-debian13:nonroot`, or the newest distroless Node 24 tag that exists), holding `dist/*.mjs`, `migrations/` and `web/dist`, with `UROBOROS_WEB_DIST=/app/web`, `UROBOROS_BIND=0.0.0.0:8080`, user `65532:65532`, `ENTRYPOINT ["/nodejs/bin/node"]`, `CMD ["/app/api.mjs"]`. Migrate runs as the same image with `CMD ["/app/migrate.mjs"]`. `worker`: `node:24.21.0-trixie-slim` plus `python3`, `python3-venv` and `ffmpeg` from apt, with yt-dlp installed in `/opt/yt-dlp` venv via `pip install --require-hashes -r`, user 65532, `CMD ["node","/app/worker.mjs"]`, and `YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp`. The worker logs `yt-dlp --version` and ffmpeg's version at startup. That logging is the only spawn in this step, and it runs only in the worker. `dev/compose.yaml` services: `postgres`, `valkey`, `minio`, `migrate`, `api` (2 replicas behind `caddy` on :8080) and `worker` (2 replicas).

- [ ] **Step 1: Add the test.** Add `apps/server/src/worker/versions.test.ts`: `logToolVersions(log, { ytdlp: "/bin/false" })` logs a warning and does not throw, because a missing tool must not crash-loop the worker on startup (download jobs fail later with a clear error instead).
- [ ] **Step 2: Implement** `logToolVersions` and tsdown config. Run `pnpm -F @uroboros/server build && node apps/server/dist/gen.mjs --check`. Expected: exit 0.
- [ ] **Step 3: Build the images.** `docker build --target api -t uroboros-api . && docker build --target worker -t uroboros-worker .`. Expected: both build. `docker run --rm --entrypoint /opt/yt-dlp/bin/yt-dlp uroboros-worker --version` prints the pinned version.
- [ ] **Step 4: Smoke-test.** `docker compose -f dev/compose.yaml up -d --build`, then `curl -s localhost:8080/api/health` returns `{"status":"ok","failing":[]}`, and `curl -s localhost:8080/some/deep/link` returns HTML. `docker compose stop valkey`, then health returns `degraded` with `["valkey"]`, and the api containers are still running (`docker compose ps`). Tear down.
- [ ] **Step 5: Add the mise tasks** `build` (both images) and `dev:stack` (compose up).
- [ ] **Step 6: Commit.** `git commit -m "build: bundled server, distroless api image, worker image with pinned yt-dlp"`

### Task 10: Helm chart

**Files:**
- Create: `chart/uroboros/{Chart.yaml,values.yaml,values.schema.json}`, `chart/uroboros/templates/{_helpers.tpl,api-deployment.yaml,api-service.yaml,api-hpa.yaml,worker-deployment.yaml,migrate-job.yaml,networkpolicy-worker.yaml,serviceaccount.yaml}`, `chart/uroboros/ci/{default,external-secrets}-values.yaml`

**Interfaces:**
- Produces: values `image.{repository,tag}`, `api.{replicas,resources,hpa.{enabled,min,max,cpu}}`, `worker.{replicas,concurrency,resources,scratchSize}`, `database.existingSecret` (key `DATABASE_URL`), `valkey.existingSecret` (key `VALKEY_URL`) and `ingress.*`. The migrate Job uses `helm.sh/hook: pre-install,pre-upgrade` and `hook-delete-policy: before-hook-creation,hook-succeeded`. API liveness probe is a TCP socket check. Readiness is `GET /api/health`, which stays 200 when degraded, so a database blip doesn't pull every pod out of the Service. The worker runs with `terminationGracePeriodSeconds: 30` and an `emptyDir` scratch mount at `/scratch`. The worker NetworkPolicy allows DNS, Postgres, Valkey and `0.0.0.0/0` egress except `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` and `100.64.0.0/10`, because the design's trust model blocks internal ranges. Database and Valkey destinations are configurable, as `networkPolicy.allowCidrs` and selectors, so in-cluster Postgres can still be reached. Every pod has `runAsNonRoot`, `readOnlyRootFilesystem` and dropped capabilities.
- Produces task: `lint:chart`, which runs `helm lint chart/uroboros` and `helm template` with each `ci/*-values.yaml`, piped to `kubeconform -strict -summary`.

- [ ] **Step 1: Write the chart** and the two CI values files.
- [ ] **Step 2: Run** `mise run lint:chart`. Expected: exit 0, with 0 invalid resources. Then set `worker.replicas: "two"` in a scratch values file, and the schema rejects it.
- [ ] **Step 3: Commit.** `git commit -m "feat(chart): api, worker, migrate hook job, worker egress policy"`

### Task 11: CI workflows and the `ci` aggregate

**Files:**
- Create: `.github/workflows/ci.yml` (port TPL's: the jobs `static` and `node` run tests with Docker, plus `chart`, `images` (docker build of both targets, no push) and the aggregate `ci`), `.github/workflows/pr-title.yml` (port as-is)
- Modify: `.mise/config.toml` (`[tasks.ci].depends`)

**Interfaces:**
- Consumes: every task above. `[tasks.ci].depends` is `fmt:check`, `lint:workflows`, `lint:shell`, `lint:renovate`, `ratchet:lines`, `ratchet:suppressions`, `ratchet:complexity`, `ratchet:pins`, `ci:parity`, `ratchet:test`, `check:lock` (`pnpm install --frozen-lockfile --lockfile-only`), `check:audit` (`pnpm audit --audit-level high`), `check:licenses` (allowlist MIT, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, BlueOak-1.0.0, MPL-2.0), `check:gen`, `lint` (eslint, every package, `--max-warnings 0`), `check:types`, `test`, `build:ui`, `lint:chart` and `build:images`.

- [ ] **Step 1: Port `ci.yml`.** Keep TPL's action SHAs, the mise-action `version` and the Forgejo token handling, and put one `- run: mise run <task>` step per gate.
- [ ] **Step 2: Run** `mise run ci:parity`. Expected: exit 0. Remove one step from ci.yml, and expect exit 1 naming that step. Restore it.
- [ ] **Step 3: Run** `mise run ci`. Expected: all gates pass. Fix whatever fails at its root, and don't add frozen exceptions.
- [ ] **Step 4: Update** `README.md` and `CLAUDE.md` (port TPL's structure: definition of done, layout, the tasks table, database and tests, principles) for the TS stack.
- [ ] **Step 5: Commit.** `git commit -m "ci: full gate parity with mise run ci"`
