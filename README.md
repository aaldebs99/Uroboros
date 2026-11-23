# Uroboros

A self-hosted web UI, API and download workers for media, replacing ytdl-material. It ships with:

- **API**: [Hono](https://hono.dev) with `GET /api/health` (liveness), `GET /api/ready`
  (readiness), `GET /api/info`, OpenAPI generated from the routes and Swagger UI, typed
  `{ code, message }` errors, and the SPA served behind a deep-link fallback. The api is stateless
  and runs as several replicas; one of them at a time holds the leader lock.
- **Workers**: [BullMQ](https://bullmq.io) on Valkey, with graceful shutdown and a heartbeat. They
  are the only processes that run [yt-dlp](https://github.com/yt-dlp/yt-dlp), the only downloader,
  and ffmpeg.
- **Database**: Postgres through [Kysely](https://kysely.dev), with forward-only migrations named
  by their UTC creation time, applied by the api itself as it starts, under an advisory lock.
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
mise run dev:api             # API on http://127.0.0.1:18081; it applies pending migrations first
mise run dev:worker          # a worker against the same Valkey
mise run dev:ui              # Vite on http://127.0.0.1:18173, proxying /api to :18081
```

`dev:api` and `mise run migrate` (which applies the migrations by hand, without starting the api)
read `DATABASE_URL`, which defaults to the `dev:deps` database,
`postgres://uroboros:uroboros@127.0.0.1:15432/uroboros`.

The worker image takes its ffmpeg from an image in a private registry, so the `docker:*` tasks
(`docker:build`, `docker:smoke`, `docker:up`) need `docker login code.example.com` first.
To run what a deployment runs instead, `mise run docker:up` builds both images and starts
Postgres, Valkey, RustFS, two api replicas (each migrating as it starts) behind Caddy and two workers on
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
chart passes it `DATABASE_URL` already, for the job processors to come). There is no separate
migrate container or Job: the api applies the migrations as it starts, the way Djinn's `serve`
does. It listens at once (so liveness answers), connects on a connection of its own, retrying an
unreachable database every 2 s for `UROBOROS_DB_STARTUP_GRACE_SECS` (0, the default, retries
until it answers; a wrong password or URL fails at once), applies every pending file with no
statement, lock or query timeout, and only then attaches the database and reports ready. Every
replica does this; the runner's advisory lock makes them take turns, and the later ones find
nothing to do. A failed migration is logged and the process exits 1 without ever being ready, so
a rolling update stalls with the old pods still serving. A database ahead of the build (a
rollback) is logged as a warning and the api starts anyway. `mise run migrate` applies them by
hand, failing fast when the server cannot be reached. Until the first release the whole schema is
one file, `migrations/20261122000000_schema.sql`, edited in place; after changing it, delete the
local database (`mise run docker:down`, then `docker volume rm uroboros_postgres-data`), because
the runner refuses a file whose checksum changed after it was applied. From the first release on,
changes are new files made with `mise run migration:new <snake_case_name>`.

`GET /api/health` is liveness: it checks nothing and answers 200 `{"status":"ok"}` while the
process is up. `GET /api/ready` is readiness: 503 `{"status":"starting"}` until the migrations ran,
then 200 with `ok`, or `degraded` and the failing dependencies (a dependency blip keeps the replica
in the Service). Routes that need the database answer 503 `unavailable` while starting. The chart
probes liveness on `/api/health` and readiness and start-up on `/api/ready`; its
`api.startupTimeoutSeconds` (10 minutes) is how long a pod may take to connect and migrate before
the kubelet restarts it, so it must cover the longest migration a release ships.

One api replica at a time leads: it holds a session-level Postgres advisory lock (`URO_LEAD`) on a
connection of its own and pings it every 10 s. When that replica dies or loses its connection, the
server frees the lock and another replica takes it within about 15 s; a stopping replica gives it
up at once. Leadership has no duties yet: BullMQ's job schedulers already run each repeatable job
exactly once, so the leader is for singleton work to come (the media reaper, say). The machinery,
ported from Djinn, is `apps/server/src/shared/leader.ts`, and every lock key is in
`shared/lockKeys.ts`.

From the first release on, migrations are applied while replicas from the previous release are
still serving, so each migration must work with the previous release's code: expand, migrate, then contract across
releases, never renaming or dropping what the running release still reads. Each file runs in one
transaction, so `CREATE INDEX CONCURRENTLY` and other statements that refuse a transaction are not
supported yet; use a plain `CREATE INDEX` while the table is small.

`mise run test` needs Docker and no other setup. The server's vitest global setup starts one
Postgres, one Valkey and one RustFS with testcontainers, migrates a `uroboros_template` database and freezes
it as a template; each test clones it into its own database, so tests never share rows. Set
`UROBOROS_TEST_DATABASE_URL`, `UROBOROS_TEST_VALKEY_URL` and `UROBOROS_TEST_S3_URL` (RustFS with the dev keys) to use servers you provide instead,
which is what CI does.

## Downloads and storage

Paste a video, playlist or channel link on the Downloads page (or the top bar's quick add) and pick
a format profile. A playlist or channel opens a preview (a channel grouped by tab, Shorts and Live
unticked) where you untick what you don't want. Each video is fetched once per profile, however
many people ask for it, and lands in everyone's Library, where it can be saved. Media is stored in
an S3-compatible bucket (RustFS locally) or in organized folders on a shared volume
(`UROBOROS_STORAGE=filesystem`, layout in `UROBOROS_STORAGE_LAYOUT`). Admins manage the format
profiles under Admin › Format profiles. `docs/downloads.md` has the design.

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

| Variable                                                      | Read by                       | Default                                                            | What it is                                                                                    |
| ------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                | api, worker, migrate          | required                                                           | Postgres connection string.                                                                   |
| `VALKEY_URL`                                                  | api, worker                   | required                                                           | Valkey connection string.                                                                     |
| `UROBOROS_BIND`                                               | api                           | `127.0.0.1:18081`                                                  | `host:port` to listen on; the image sets `0.0.0.0:8080`.                                      |
| `UROBOROS_WEB_DIST`                                           | api                           | unset (no SPA)                                                     | The built SPA to serve; the image sets `/app/web`.                                            |
| `UROBOROS_BODY_LIMIT_BYTES`                                   | api                           | `65536`                                                            | Largest request body on `/api/*`; larger gets 413 `payload_too_large`.                        |
| `UROBOROS_SHUTDOWN_GRACE_MS`                                  | api                           | `20000`                                                            | After SIGTERM, how long in-flight requests may run before they are cut and the api exits 1.   |
| `UROBOROS_DB_STARTUP_GRACE_SECS`                              | api                           | `0` (retry until it answers)                                       | How long start-up retries an unreachable Postgres before exiting 1.                           |
| `UROBOROS_PUBLIC_BASE_URL`                                    | api                           | unset (push off)                                                   | The public origin, e.g. `https://uroboros.example.com`, no path; push is on only when https.  |
| `UROBOROS_PUSH_SUBJECT`                                       | api                           | the public URL                                                     | The VAPID contact, a `mailto:` address or an https URL.                                       |
| `UROBOROS_VAPID_PUBLIC_KEY`, `UROBOROS_VAPID_PRIVATE_KEY`     | api                           | generated once, kept in the database                               | A fixed VAPID pair; both or neither. Changing it drops every subscription.                    |
| `UROBOROS_PUSH_ALLOWED_HOSTS`                                 | api                           | Apple, Google, Mozilla, Microsoft push                             | Comma-separated hosts a subscription endpoint may be on (or a subdomain of), against SSRF.    |
| `UROBOROS_PUSH_MAX_DEVICES`                                   | api                           | `10`                                                               | Devices with notifications per user.                                                          |
| `UROBOROS_SESSION_TTL_HOURS`                                  | api                           | `720`                                                              | Fixed session lifetime (docs/auth.md).                                                        |
| `UROBOROS_TRUST_PROXY`                                        | api                           | `false`                                                            | Read the client IP from `X-Forwarded-For` for the per-IP sign-in limit; true behind a proxy.  |
| `UROBOROS_LOCAL_LOGIN`                                        | api                           | `true`                                                             | Local username/password sign-in; with it off, OIDC must be configured.                        |
| `UROBOROS_BOOTSTRAP_USERNAME`, `UROBOROS_BOOTSTRAP_PASSWORD`  | api                           | unset (no bootstrap admin)                                         | The admin re-seeded on every start; both or neither, password 12+ characters.                 |
| `UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD`                      | api                           | `false`                                                            | Accept a shorter bootstrap password (logs a warning). Local dev stacks only; compose sets it. |
| `UROBOROS_OIDC_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`        | api                           | unset (no SSO)                                                     | The OIDC provider; all three or none, and `UROBOROS_PUBLIC_BASE_URL` is required with them.   |
| `UROBOROS_OIDC_DISPLAY_NAME`                                  | api                           | `Authentik`                                                        | The provider's name on the sign-in button.                                                    |
| `UROBOROS_OIDC_ADMIN_GROUPS`                                  | api                           | `authentik Admins`                                                 | Comma-separated groups whose members are admins.                                              |
| `UROBOROS_OIDC_GROUPS_CLAIM`                                  | api                           | `groups`                                                           | The ID-token claim holding the groups.                                                        |
| `UROBOROS_OIDC_SYNC_INTERVAL_SECS`                            | api                           | `900`                                                              | How stale SSO claims may get before the sync refreshes them; `0` turns the sync off.          |
| `UROBOROS_WORKER_CONCURRENCY`                                 | worker                        | `4`                                                                | Parallel jobs per worker process.                                                             |
| `YTDLP_PATH`                                                  | worker                        | `yt-dlp` on `PATH`                                                 | The yt-dlp binary; the image sets `/opt/yt-dlp/bin/yt-dlp`.                                   |
| `UROBOROS_STORAGE`                                            | api, worker                   | required                                                           | Where media is stored: `s3` or `filesystem` (organized folders).                              |
| `UROBOROS_S3_ENDPOINT`, `UROBOROS_S3_BUCKET`                  | api, worker                   | required for `s3`                                                  | The S3-compatible endpoint (RustFS locally) and an existing bucket.                           |
| `UROBOROS_S3_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`             | api, worker                   | required for `s3`                                                  | The S3 access key pair.                                                                       |
| `UROBOROS_S3_REGION`, `UROBOROS_S3_FORCE_PATH_STYLE`          | api, worker                   | `us-east-1`, `true`                                                | The S3 region and path-style addressing.                                                      |
| `UROBOROS_S3_PUBLIC_URL`                                      | api                           | unset (stream through the api)                                     | An endpoint browsers can reach; set, "save file" redirects to a presigned URL.                |
| `UROBOROS_STORAGE_ROOT`                                       | api, worker                   | required for `filesystem`                                          | The absolute path of the shared media volume.                                                 |
| `UROBOROS_STORAGE_LAYOUT`                                     | api, worker                   | `{channel}/{upload_date} {title} [{id}]/{title} [{profile}].{ext}` | The folder layout for `filesystem` (docs/downloads.md lists the tokens).                      |
| `UROBOROS_MAX_ACTIVE_DOWNLOADS_PER_USER`                      | api, worker                   | `3`                                                                | Downloads of one person running at once; the rest wait their turn.                            |
| `UROBOROS_MAX_PLAYLIST_ENTRIES`                               | api, worker                   | `1000`                                                             | Entries kept per playlist or channel-tab preview.                                             |
| `UROBOROS_WORK_DIR`                                           | worker                        | `$TMPDIR/uroboros-work`                                            | Scratch space for downloads in progress (the chart's emptyDir).                               |
| `UROBOROS_YTDLP_COOKIES_FILE`                                 | worker                        | unset                                                              | A Netscape cookies file for yt-dlp (a mounted Secret); yt-dlp gets a private copy.            |
| `UROBOROS_MIGRATIONS_DIR`                                     | api, migrate, `migration:new` | the repo's `migrations/`                                           | Where the SQL files are; the image sets `/app/migrations`.                                    |
| `UROBOROS_TEST_DATABASE_URL`, `_VALKEY_URL`, `_S3_URL`        | tests                         | unset (testcontainers)                                             | Servers for the test run to use instead of starting containers.                               |
| `UROBOROS_WORKER_TEST_QUEUE`, `_PREFIX`, `_GRACE_MS`, `_HANG` | worker (tests)                | unset                                                              | The spawned-worker test's seam; never set in production.                                      |
| `UROBOROS_API_URL`, `UROBOROS_UI_PORT`                        | Vite (`dev:ui`)               | `http://127.0.0.1:18081`, `18173`                                  | Where the dev server proxies `/api`, and its own port.                                        |

The compose host ports (`UROBOROS_PORT` and the others) are under Quickstart. The compose stack
signs in with a dev-only bootstrap admin, `admin` / `admin`, unless you set
`UROBOROS_BOOTSTRAP_USERNAME` and `UROBOROS_BOOTSTRAP_PASSWORD` in the shell.

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
`:main-worker`. `renovate.yml` runs a self-hosted Renovate twice a day. It looks up the ffmpeg image's tags in the
private registry with `RENOVATE_DOCKER_CODE_example_COM_USERNAME` and `_PASSWORD`, user-scope secrets under
`aaldebs99` (a token with `read:package`) that this repository inherits.

The repository needs these Actions variables and secrets:

| Name                        | Kind     | For                                                                                                                        |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `REGISTRY`                  | variable | The registry host the images are pushed to, e.g. `code.example.com`.                                                   |
| `REGISTRY_TOKEN`            | secret   | An access token of the `aaldebs99` account scoped `write:package` (`release.yml` pushes, `ci.yml` pulls the ffmpeg image). |
| `RELEASE_PLEASE_TOKEN`      | secret   | The release bot's token, scoped `write:repository`, `write:issue` and `read:user`.                                         |
| `RENOVATE_TOKEN`            | secret   | The Renovate bot's token, scoped `write:repository`, `write:issue`, `read:user` and `read:organization`.                   |
| `RENOVATE_GITHUB_COM_TOKEN` | secret   | A github.com token with no scopes, so Renovate can look up GitHub-hosted dependencies.                                     |

Accepted risk: `REGISTRY_TOKEN` can write packages, yet `ci.yml` uses it to pull, so builds of same-repository pull requests, Renovate's branches included, can read a write-capable registry token; a read-only token would remove that risk. Pull requests from forks get no secrets, so their `images` job always fails at the ffmpeg pull.

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
