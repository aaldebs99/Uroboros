# Uroboros

A self-hosted web UI, API and download workers for media, replacing ytdl-material. It ships with:

- **API**: [Hono](https://hono.dev) with `GET /api/health`, `GET /api/info`, OpenAPI generated
  from the routes and Swagger UI, typed `{ code, message }` errors, and the SPA served behind a
  deep-link fallback. The api is stateless and runs as several replicas.
- **Workers**: [BullMQ](https://bullmq.io) on Valkey, with graceful shutdown and a heartbeat. They
  are the only processes that run [yt-dlp](https://github.com/yt-dlp/yt-dlp), the only downloader,
  and ffmpeg.
- **Database**: Postgres through [Kysely](https://kysely.dev), with forward-only migrations named
  by their UTC creation time, applied by a separate migrate entrypoint under an advisory lock.
- **Shared types**: every wire shape is a zod schema in `packages/contract`. The server validates
  and documents with it, the UI parses every response with it, and `api/openapi.json` is
  generated from it and committed.
- **UI**: React, Vite, TanStack Router and Query, and Tailwind in `apps/web`.
- **Deployment**: one Dockerfile with a distroless `api` image and a `worker` image, a compose
  stack shaped like production, and a Helm chart in `chart/uroboros`.
- **Toolchain and gates**: every tool is pinned in `.mise/config.toml` and locked per platform in
  `.mise/mise.lock`, and every CI step is a `mise run <task>`. The gates are oxfmt, eslint
  (type-aware), tsc, vitest against real Postgres and Valkey, actionlint, zizmor, shellcheck, the
  Renovate validator, helm and kubeconform, lockfile, audit and licence checks, OpenAPI drift, the
  image builds, and forward-only [ratchets](docs/ratchets.md).
- **Automation**: [Renovate](.renovaterc.json5) waits 3 days before adopting any release and
  automerges only on green CI; [git-cliff](cliff.toml) drives the changelog and the release PR.
- **Licences**: Uroboros is MIT. The images bundle other software, ffmpeg (GPL) among it; see
  [THIRD_PARTY.md](THIRD_PARTY.md).

## Quickstart

You need [mise](https://mise.jdx.dev), which installs everything else, and Docker for the local
stack and the tests.

```sh
mise trust && mise install   # tools, git hooks, workspace dependencies
mise run dev:deps            # Postgres on 127.0.0.1:15432, Valkey on 127.0.0.1:16379
mise run migrate             # against the dev:deps database unless DATABASE_URL says otherwise
mise run dev:api             # API on http://127.0.0.1:18081
mise run dev:worker          # a worker against the same Valkey
mise run dev:ui              # Vite on http://127.0.0.1:18173, proxying /api to :18081
```

`mise run migrate` reads `DATABASE_URL`, which defaults to the `dev:deps` database,
`postgres://uroboros:uroboros@127.0.0.1:15432/uroboros`.

To run what a deployment runs instead, `mise run docker:up` builds both images and starts
Postgres, Valkey, RustFS, the migrate job, two api replicas behind Caddy and two workers on
http://127.0.0.1:18080. `mise run docker:up:dev` is the same stack with the api reloading from
source, and `mise run docker:down` stops either. For the UI against either stack, run
`mise run dev:ui:docker`, which is `dev:ui` with `UROBOROS_API_URL=http://127.0.0.1:18080`
(plain `dev:ui` proxies to a host-run `dev:api` on :18081). Every host port can be moved with an environment
variable (`UROBOROS_PORT`, `UROBOROS_POSTGRES_PORT`, `UROBOROS_VALKEY_PORT`, `UROBOROS_S3_PORT`,
`UROBOROS_S3_CONSOLE_PORT`, `UROBOROS_UI_PORT`, `UROBOROS_BIND`).

Before you push, run the same gates CI runs:

```sh
mise run ci
```

`mise tasks` lists every task, and [CLAUDE.md](CLAUDE.md) has the table.

## Database and tests

The api reads `DATABASE_URL` and `VALKEY_URL`; the worker reads only `VALKEY_URL` so far (the
chart passes it `DATABASE_URL` already, for the job processors to come). The api never migrates; the migrate
entrypoint does, as a one-shot compose service or a Helm hook Job, and every replica can start
it safely because it takes an advisory lock and applies each file exactly once. Add a migration
with `mise run migration:new <snake_case_name>`, which writes
`migrations/<YYYYMMDDHHMMSS>_<name>.sql` with the current UTC time. A migration is never edited
once shipped: the runner refuses a file whose checksum changed after it was applied.

Kubernetes migrates in a `pre-upgrade` hook while the previous release still serves, so each
migration must work with the previous release's code: expand, migrate, then contract across
releases, never renaming or dropping what the running release still reads. Each file runs in one
transaction, so `CREATE INDEX CONCURRENTLY` and other statements that refuse a transaction are not
supported yet; use a plain `CREATE INDEX` while the table is small.

`mise run test` needs Docker and no other setup. The server's vitest global setup starts one
Postgres and one Valkey with testcontainers, migrates a `uroboros_template` database and freezes
it as a template; each test clones it into its own database, so tests never share rows. Set
`UROBOROS_TEST_DATABASE_URL` and `UROBOROS_TEST_VALKEY_URL` to use servers you provide instead,
which is what CI does.

## Installable app and push notifications

The UI is an installable web app: a static manifest, icons, and a service worker (vite-plugin-pwa,
`injectManifest`) that precaches the shell and shows Web Push notifications. Settings,
Notifications turns them on per browser or phone, sends a test, and turns a device off. Push is on
only when the api knows its public https address, `UROBOROS_PUBLIC_BASE_URL`; the push variables
are in the Configuration table below.

The icons are generated from `assets/logos/uroboros-transparent.svg` by `mise run icons` and
committed; run it again after changing the logo. [docs/push.md](docs/push.md) has the design: the
payload, the key bootstrap, the allowlist, the iPhone setup and what comes later.

## Configuration

Every environment variable the code reads. The api, worker and migrate processes read theirs
through `apps/server/src/config.ts`, which refuses a bad value at startup (exit 2) and treats an
empty optional one as unset; the test and Vite variables at the bottom are read by the test setup,
the worker's test seam and `vite.config.ts`. The compose stack and the chart set them for you.

| Variable                                                      | Read by                  | Default                                | What it is                                                                                    |
| ------------------------------------------------------------- | ------------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                | api, migrate             | required                               | Postgres connection string. The chart also gives it to the worker, which does not use it yet. |
| `VALKEY_URL`                                                  | api, worker              | required                               | Valkey connection string.                                                                     |
| `UROBOROS_BIND`                                               | api                      | `127.0.0.1:18081`                      | `host:port` to listen on; the image sets `0.0.0.0:8080`.                                      |
| `UROBOROS_WEB_DIST`                                           | api                      | unset (no SPA)                         | The built SPA to serve; the image sets `/app/web`.                                            |
| `UROBOROS_BODY_LIMIT_BYTES`                                   | api                      | `65536`                                | Largest request body on `/api/*`; larger gets 413 `payload_too_large`.                        |
| `UROBOROS_SHUTDOWN_GRACE_MS`                                  | api                      | `20000`                                | After SIGTERM, how long in-flight requests may run before they are cut and the api exits 1.   |
| `UROBOROS_PUBLIC_BASE_URL`                                    | api                      | unset (push off)                       | The public origin, e.g. `https://uroboros.example.com`, no path; push is on only when https.  |
| `UROBOROS_PUSH_SUBJECT`                                       | api                      | the public URL                         | The VAPID contact, a `mailto:` address or an https URL.                                       |
| `UROBOROS_VAPID_PUBLIC_KEY`, `UROBOROS_VAPID_PRIVATE_KEY`     | api                      | generated once, kept in the database   | A fixed VAPID pair; both or neither. Changing it drops every subscription.                    |
| `UROBOROS_PUSH_ALLOWED_HOSTS`                                 | api                      | Apple, Google, Mozilla, Microsoft push | Comma-separated hosts a subscription endpoint may be on (or a subdomain of), against SSRF.    |
| `UROBOROS_PUSH_MAX_DEVICES`                                   | api                      | `10`                                   | Devices with notifications per user.                                                          |
| `UROBOROS_WORKER_CONCURRENCY`                                 | worker                   | `4`                                    | Parallel jobs per worker process.                                                             |
| `YTDLP_PATH`                                                  | worker                   | `yt-dlp` on `PATH`                     | The yt-dlp binary; the image sets `/opt/yt-dlp/bin/yt-dlp`.                                   |
| `UROBOROS_MIGRATIONS_DIR`                                     | migrate, `migration:new` | the repo's `migrations/`               | Where the SQL files are; the image sets `/app/migrations`.                                    |
| `UROBOROS_TEST_DATABASE_URL`, `UROBOROS_TEST_VALKEY_URL`      | tests                    | unset (testcontainers)                 | Servers for the test run to use instead of starting containers.                               |
| `UROBOROS_WORKER_TEST_QUEUE`, `_PREFIX`, `_GRACE_MS`, `_HANG` | worker (tests)           | unset                                  | The spawned-worker test's seam; never set in production.                                      |
| `UROBOROS_API_URL`, `UROBOROS_UI_PORT`                        | Vite (`dev:ui`)          | `http://127.0.0.1:18081`, `18173`      | Where the dev server proxies `/api`, and its own port.                                        |

The compose host ports (`UROBOROS_PORT` and the others) are under Quickstart.

## CI and releases

The repository is hosted on Forgejo at https://code.example.com/aaldebs99/Uroboros, and the
workflows in `.github/workflows` run on its Actions runners. `ci.yml` runs every gate as one
`mise run <task>` step, and its `CI` job is the required status check. `pr-title.yml` requires a
conventional-commit PR title.

Releases come from a PR. On every push to main, `release-pr.yml` proposes the next version as a
`chore(release): X.Y.Z` PR from the `release/next` branch, with the version stamped into
`apps/server/package.json`, `package.json`, `api/openapi.json` and the chart, and the changelog
section prepended. Merging it publishes the release, and `release.yml` then builds both images,
smoke-tests them, and pushes `<REGISTRY>/aaldebs99/uroboros:X.Y.Z`, `:X.Y` and `:latest` (the
api) and the same tags with `-worker` appended (the worker). Pushes to main publish `:main` and
`:main-worker`. `renovate.yml` runs a self-hosted Renovate twice a day.

The repository needs these Actions variables and secrets:

| Name                        | Kind     | For                                                                                                      |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `REGISTRY`                  | variable | The registry host the images are pushed to, e.g. `code.example.com`.                                 |
| `REGISTRY_TOKEN`            | secret   | An access token of the `aaldebs99` account scoped `write:package`.                                       |
| `RELEASE_PLEASE_TOKEN`      | secret   | The release bot's token, scoped `write:repository`, `write:issue` and `read:user`.                       |
| `RENOVATE_TOKEN`            | secret   | The Renovate bot's token, scoped `write:repository`, `write:issue`, `read:user` and `read:organization`. |
| `RENOVATE_GITHUB_COM_TOKEN` | secret   | A github.com token with no scopes, so Renovate can look up GitHub-hosted dependencies.                   |

The bots must be ordinary accounts with write access: anything a workflow's own token creates
fires no workflow events, so a release PR opened with it would show no checks and a release
created with it would build no images.

## Layout

```text
apps/server          @uroboros/server    api, worker, migrate and gen; bin/{api,worker,migrate,gen}.ts
apps/web             @uroboros/web       React + Vite UI
packages/contract    @uroboros/contract  zod wire schemas shared by server and UI
tools/ratchet        @uroboros/ratchet   ratchets and ci-parity (docs/ratchets.md)
migrations/                              forward-only SQL migrations
api/openapi.json                         generated, committed
chart/uroboros/                          Helm chart
compose.yaml, compose.dev.yaml           local stack and its hot-reload overlay
scripts/image/                           worker image tooling and the image smoke test
scripts/release/                         release PR and release cut
.mise/config.toml                        tool pins and every task
```
