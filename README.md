# Uroboros

A self-hosted web UI, API and downloader for media, replacing ytdl-material: one server process,
run as several replicas. It ships with:

- **API**: [Hono](https://hono.dev) with `GET /api/health` (liveness), `GET /api/ready`
  (readiness), `GET /api/info`, OpenAPI generated from the routes and Swagger UI, typed
  `{ code, message }` errors, and the SPA served behind a deep-link fallback. The server is
  stateless and runs as several replicas; one of them at a time holds the leader lock. Personal API
  tokens are scoped to the REST API, the MCP server or both, and may be read-only.
- **MCP server**: `/api/mcp`, for AI tools such as Claude Code, Cursor and VS Code: searching the
  library and its transcripts, saving videos, playlists and subscriptions, as the token's owner. An
  admin turns it on under Admin › Server ([docs/mcp.md](docs/mcp.md)).
- **Download jobs**: a job queue on Postgres ([docs/jobs.md](docs/jobs.md)), consumed by every
  replica beside its HTTP, with a graceful shutdown that hands a running download to another replica.
  They run [yt-dlp](https://github.com/yt-dlp/yt-dlp), the only downloader, and ffmpeg.
- **Database**: Postgres through [Kysely](https://kysely.dev), with forward-only migrations named
  by their UTC creation time, applied by the server itself as it starts, under an advisory lock.
- **Shared types**: every wire shape is a zod schema in `packages/contract`. The server validates
  and documents with it, the UI parses every response with it, and `api/openapi.json` is
  generated from it and committed.
- **UI**: React, Vite, TanStack Router and Query, and Tailwind in `apps/web`.
- **Running it**: one Dockerfile building one image (Debian slim with the pinned yt-dlp and
  ffmpeg), and a compose stack shaped like production.
- **Toolchain and gates**: every tool is pinned in `.mise/config.toml` and locked per platform in
  `.mise/mise.lock`, and every CI step is a `mise run <task>`. The gates are oxfmt, eslint
  (type-aware), tsc, vitest against real Postgres and RustFS, actionlint, zizmor, shellcheck, the
  Renovate validator, lockfile, audit and licence checks, OpenAPI drift, the
  image build, and forward-only [ratchets](docs/ratchets.md).
- **Automation**: [Renovate](.renovaterc.json5) waits 3 days before adopting any release and
  automerges only on green CI; [git-cliff](cliff.toml) drives the changelog and the release PR.
- **Licences**: Uroboros is MIT. The image bundles other software, ffmpeg (GPL) among it; see
  [THIRD_PARTY.md](THIRD_PARTY.md).

## Quickstart

You need [mise](https://mise.jdx.dev), which installs everything else, and Docker for the local
stack and the tests.

```sh
mise trust && mise install   # tools, git hooks, workspace dependencies
mise run dev:deps            # Postgres on 127.0.0.1:15432, RustFS on 127.0.0.1:19000
mise run dev:server          # the server on http://127.0.0.1:18081; it applies pending migrations first
mise run dev:ui              # Vite on http://127.0.0.1:18173, proxying /api to :18081
```

`dev:server` and `mise run migrate` (which applies the migrations by hand, without starting the
server)
read `DATABASE_URL`, which defaults to the `dev:deps` database,
`postgres://uroboros:uroboros@127.0.0.1:15432/uroboros`. Downloads from a host-run server need
yt-dlp and ffmpeg on `PATH`; the compose stacks below have them.

The image takes its ffmpeg from an image in a private registry, so the `docker:*` tasks
(`docker:build`, `docker:smoke`, `docker:up`) need `docker login code.example.com` first.
To run the real thing instead, `mise run docker:up` builds the image and starts Postgres,
RustFS and one uroboros (migrating as it starts, serving and downloading) behind Caddy on
http://127.0.0.1:18080; `docker compose up --scale uroboros=2` runs more replicas, which share the
work. `mise run docker:up:dev` is the same stack with both the server and the
UI hot-reloading from source (Vite behind the same Caddy, so an edit to the UI shows at once and
one to the server restarts the replicas; `mise run docker:up:dev:build` after a dependency or
Dockerfile change), listening on port 18080 on every interface so other devices on the network can
reach it (Postgres and RustFS stay on loopback), and `mise run docker:down` stops either.
Plain `dev:ui` runs Vite on the host, proxying to a host-run `dev:server` on :18081. Every host port can be moved with an environment
variable (`UROBOROS_PORT`, `UROBOROS_POSTGRES_PORT`, `UROBOROS_S3_PORT`,
`UROBOROS_S3_CONSOLE_PORT`, `UROBOROS_UI_PORT`, `UROBOROS_BIND`).

Before you push, run the same gates CI runs:

```sh
mise run ci
```

`mise tasks` lists every task, and [CLAUDE.md](CLAUDE.md) has the table.

## Database and tests

The server reads `DATABASE_URL`; Postgres is its only service besides storage. There is no separate migrate step: the server
applies the migrations as it starts, the way Djinn's `serve` does. It listens at once (so liveness answers), connects on a connection of its own, retrying an
unreachable database every 2 s for `UROBOROS_DB_STARTUP_GRACE_SECS` (0, the default, retries
until it answers; a wrong password or URL fails at once), applies every pending file with no
statement, lock or query timeout, and only then attaches the database and reports ready. Every
replica does this; the runner's advisory lock makes them take turns, and the later ones find
nothing to do. A failed migration is logged and the process exits 1 without ever being ready, so
the replicas of the previous build keep serving. A database ahead of the build (a rollback) is
logged as a warning and the server starts anyway. The job consumers start only once the
migrations ran, so no job runs against an older schema. `mise run migrate` applies them by
hand, failing fast when the server cannot be reached. Until the first release the whole schema is
one file, `migrations/20261122000000_schema.sql`, edited in place; after changing it, delete the
local database (`mise run docker:down`, then `docker volume rm uroboros_postgres-data`), because
the runner refuses a file whose checksum changed after it was applied. From the first release on,
changes are new files made with `mise run migration:new <snake_case_name>`.

`GET /api/health` is liveness: it checks nothing and answers 200 `{"status":"ok"}` while the
process is up. `GET /api/ready` is readiness: 503 `{"status":"starting"}` until the migrations ran,
then 200 with `ok`, or `degraded` and the failing dependencies (a dependency blip keeps the replica
behind the proxy). Routes that need the database answer 503 `unavailable` while starting. The
compose healthcheck probes `/api/ready`, and Caddy waits for it before taking traffic.

One replica at a time leads: it holds a session-level Postgres advisory lock (`URO_LEAD`) on a
connection of its own and pings it every 10 s. When that replica dies or loses its connection, the
server frees the lock and another replica takes it within about 15 s; a stopping replica gives it
up at once. The leader sweeps expired sessions, sign-ins and short-lived rows, re-adds download jobs
that went missing, puts back jobs whose worker vanished, and queues the subscriptions' due checks.
The machinery,
ported from Djinn, is `apps/server/src/shared/leader.ts`, and every lock key is in
`shared/lockKeys.ts`.

From the first release on, migrations are applied while replicas from the previous release are
still serving, so each migration must work with the previous release's code: expand, migrate, then contract across
releases, never renaming or dropping what the running release still reads. Each file runs in one
transaction, so `CREATE INDEX CONCURRENTLY` and other statements that refuse a transaction are not
supported yet; use a plain `CREATE INDEX` while the table is small.

`mise run test` needs Docker and no other setup. The server's vitest global setup starts one
Postgres and one RustFS with testcontainers, migrates a `uroboros_template` database and freezes
it as a template; each test clones it into its own database, so tests never share rows. Set
`UROBOROS_TEST_DATABASE_URL` and `UROBOROS_TEST_S3_URL` (RustFS with the dev keys) to use servers you provide instead,
which is what CI does.

## Downloads and storage

Paste a video, playlist or channel link on the Downloads page (or the top bar's Add › Download) and
pick a format profile. A playlist or channel opens a preview (a channel grouped by tab, Shorts and Live
unticked) where you untick what you don't want. Each video is fetched once per profile, however
many people ask for it, and lands in everyone's Library, where it can be saved. Media is stored in
an S3-compatible bucket (RustFS locally) or in organized folders on a shared volume
(`UROBOROS_STORAGE=filesystem`, layout in `UROBOROS_STORAGE_LAYOUT`). Everyone starts with the
built-in format profiles and manages their own under Settings › Profiles: changing a built-in
changes it for them alone. `docs/downloads.md` has the design.

Add › Upload puts a video of your own in your library: a file, its title, description, creator,
tags and a thumbnail (or a frame of the video), which you can edit later from its page. The browser
sends it in 8 MiB parts straight into the store, so a reverse proxy in front must accept request
bodies of 8 MiB (nginx's default is 1 MiB: `client_max_body_size 16m;`); files go up to
`UROBOROS_UPLOAD_MAX_BYTES` (10 GiB). `docs/uploads.md` has the design.

The Library searches what you downloaded or uploaded (the top bar's search), filters by watched state and tag,
browses by channel and playlist, and plays videos in the browser with chapters and subtitles,
resuming where you left off. `docs/library.md` has the design.

## Installable app and push notifications

The UI is an installable web app: a static manifest, icons, and a service worker (vite-plugin-pwa,
`injectManifest`) that precaches the shell and shows Web Push notifications. Settings,
Notifications turns them on per browser or phone, sends a test, and turns a device off. Push is on
only when the server knows its public https address, `UROBOROS_PUBLIC_BASE_URL`; the push variables
are in the Configuration table below.

The icons are generated from `assets/logos/uroboros-transparent.svg` by `mise run icons` and
committed; run it again after changing the logo. [docs/push.md](docs/push.md) has the design: the
payload, the key bootstrap, the allowlist, the iPhone setup and what comes later.

## Configuration

Every environment variable the code reads. The server and migrate processes read theirs
through `apps/server/src/config.ts`, which refuses a bad value at startup (exit 2) and treats an
empty optional one as unset; the test and Vite variables at the bottom are read by the test setup,
and `vite.config.ts`. The compose stack sets them for you.

[`.env.example`](.env.example) lists every one of them with its default, says which ones compose
passes through, and walks through the setups: the local stack, transcoding on an NVIDIA or AMD
GPU, organized folders, a host-run server, and what to change before others use it. Copy it to
`.env` (gitignored), which compose reads, and uncomment what you change.

| Variable                                                     | Read by                       | Default                                                            | What it is                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                               | server, migrate               | required                                                           | Postgres connection string.                                                                                                                                                                                                                                                          |
| `UROBOROS_BIND`                                              | server                        | `127.0.0.1:18081`                                                  | `host:port` to listen on; the image sets `0.0.0.0:8080`.                                                                                                                                                                                                                             |
| `UROBOROS_WEB_DIST`                                          | server                        | unset (no SPA)                                                     | The built SPA to serve; the image sets `/app/web`.                                                                                                                                                                                                                                   |
| `UROBOROS_BODY_LIMIT_BYTES`                                  | server                        | `65536`                                                            | Largest request body on `/api/*`; larger gets 413 `payload_too_large`.                                                                                                                                                                                                               |
| `UROBOROS_SHUTDOWN_GRACE_MS`                                 | server                        | `20000`                                                            | After SIGTERM, how long in-flight requests may run before they are cut (running downloads get 25 s, then go back to the queue).                                                                                                                                                      |
| `UROBOROS_DB_STARTUP_GRACE_SECS`                             | server                        | `0` (retry until it answers)                                       | How long start-up retries an unreachable Postgres before exiting 1.                                                                                                                                                                                                                  |
| `UROBOROS_PUBLIC_BASE_URL`                                   | server                        | unset (push off)                                                   | The public origin, e.g. `https://uroboros.example.com`, no path; push is on only when https.                                                                                                                                                                                         |
| `UROBOROS_PUSH_SUBJECT`                                      | server                        | the public URL                                                     | The VAPID contact, a `mailto:` address or an https URL.                                                                                                                                                                                                                              |
| `UROBOROS_VAPID_PUBLIC_KEY`, `UROBOROS_VAPID_PRIVATE_KEY`    | server                        | generated once, kept in the database                               | A fixed VAPID pair; both or neither. Changing it drops every subscription.                                                                                                                                                                                                           |
| `UROBOROS_PUSH_ALLOWED_HOSTS`                                | server                        | Apple, Google, Mozilla, Microsoft push                             | Comma-separated hosts a subscription endpoint may be on (or a subdomain of), against SSRF.                                                                                                                                                                                           |
| `UROBOROS_PUSH_MAX_DEVICES`                                  | server                        | `10`                                                               | Devices with notifications per user.                                                                                                                                                                                                                                                 |
| `UROBOROS_SESSION_TTL_HOURS`                                 | server                        | `720`                                                              | Fixed session lifetime (docs/auth.md).                                                                                                                                                                                                                                               |
| `UROBOROS_TRUST_PROXY`                                       | server                        | `false`                                                            | Read the client IP from `X-Forwarded-For` for the per-IP sign-in limit; true behind a proxy.                                                                                                                                                                                         |
| `UROBOROS_LOCAL_LOGIN`                                       | server                        | `true`                                                             | Local username/password sign-in; with it off, OIDC must be configured.                                                                                                                                                                                                               |
| `UROBOROS_BOOTSTRAP_USERNAME`, `UROBOROS_BOOTSTRAP_PASSWORD` | server                        | unset (no bootstrap admin)                                         | The admin re-seeded on every start; both or neither, password 12+ characters.                                                                                                                                                                                                        |
| `UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD`                     | server                        | `false`                                                            | Accept a shorter bootstrap password (logs a warning). Local dev stacks only; compose sets it.                                                                                                                                                                                        |
| `UROBOROS_OIDC_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`       | server                        | unset (no SSO)                                                     | The OIDC provider; all three or none, and `UROBOROS_PUBLIC_BASE_URL` is required with them.                                                                                                                                                                                          |
| `UROBOROS_OIDC_DISPLAY_NAME`                                 | server                        | `Authentik`                                                        | The provider's name on the sign-in button.                                                                                                                                                                                                                                           |
| `UROBOROS_OIDC_ADMIN_GROUPS`                                 | server                        | `authentik Admins`                                                 | Comma-separated groups whose members are admins.                                                                                                                                                                                                                                     |
| `UROBOROS_OIDC_GROUPS_CLAIM`                                 | server                        | `groups`                                                           | The ID-token claim holding the groups.                                                                                                                                                                                                                                               |
| `UROBOROS_OIDC_SYNC_INTERVAL_SECS`                           | server                        | `900`                                                              | How stale SSO claims may get before the sync refreshes them; `0` turns the sync off.                                                                                                                                                                                                 |
| `UROBOROS_WORKER_CONCURRENCY`                                | server                        | `4`                                                                | Parallel download jobs per replica.                                                                                                                                                                                                                                                  |
| `YTDLP_PATH`                                                 | server                        | `yt-dlp` on `PATH`                                                 | The yt-dlp binary; the image sets `/opt/yt-dlp/bin/yt-dlp`.                                                                                                                                                                                                                          |
| `UROBOROS_STORAGE`                                           | server                        | required                                                           | Where media is stored: `s3` or `filesystem` (organized folders).                                                                                                                                                                                                                     |
| `UROBOROS_S3_ENDPOINT`, `UROBOROS_S3_BUCKET`                 | server                        | required for `s3`                                                  | The S3-compatible endpoint (RustFS locally) and an existing bucket.                                                                                                                                                                                                                  |
| `UROBOROS_S3_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`            | server                        | required for `s3`                                                  | The S3 access key pair.                                                                                                                                                                                                                                                              |
| `UROBOROS_S3_REGION`, `UROBOROS_S3_FORCE_PATH_STYLE`         | server                        | `us-east-1`, `true`                                                | The S3 region and path-style addressing.                                                                                                                                                                                                                                             |
| `UROBOROS_S3_PUBLIC_URL`                                     | server                        | unset (stream through the api)                                     | An endpoint browsers can reach; set, "save file" redirects to a presigned URL.                                                                                                                                                                                                       |
| `UROBOROS_STORAGE_ROOT`                                      | server                        | required for `filesystem`                                          | The absolute path of the shared media volume.                                                                                                                                                                                                                                        |
| `UROBOROS_STORAGE_LAYOUT`                                    | server                        | `{channel}/{upload_date} {title} [{id}]/{title} [{profile}].{ext}` | The folder layout for `filesystem` (docs/downloads.md lists the tokens).                                                                                                                                                                                                             |
| `UROBOROS_MAX_ACTIVE_DOWNLOADS_PER_USER`                     | server                        | `3`                                                                | Downloads of one person running at once; the rest wait their turn.                                                                                                                                                                                                                   |
| `UROBOROS_MAX_PLAYLIST_ENTRIES`                              | server                        | `1000`                                                             | Entries kept per playlist or channel-tab preview.                                                                                                                                                                                                                                    |
| `UROBOROS_MIN_CHECK_INTERVAL_MINUTES`                        | server                        | `60`                                                               | The shortest check interval a subscription may have, in minutes.                                                                                                                                                                                                                     |
| `UROBOROS_UPLOAD_MAX_BYTES`                                  | server                        | `10737418240` (10 GiB)                                             | The largest video a person may upload, in bytes; at most 80 GiB (10,000 parts of 8 MiB). A reverse proxy in front must take 8 MiB request bodies (docs/uploads.md).                                                                                                                  |
| `UROBOROS_TRANSCODE_CONCURRENCY`                             | server                        | `2`                                                                | Playback sessions this replica transcodes or remuxes at once; `0` runs none here, so only GPU replicas need it (docs/transcoding.md). A paused viewer holds one while their tab is open.                                                                                             |
| `UROBOROS_TRANSCODE_HWACCEL`                                 | server                        | `none`                                                             | This replica's GPU for playback sessions: `none` (the CPU, libx264), `nvenc` (NVIDIA: give the service the GPU, `compose/gpu/nvidia.yaml`) or `vaapi` (AMD, and Intel untested: the render node, `compose/gpu/vaapi.yaml`). A GPU that fails its startup test falls back to the CPU. |
| `UROBOROS_TRANSCODE_VAAPI_DEVICE`                            | server                        | `/dev/dri/renderD128`                                              | The VA-API render node, with `UROBOROS_TRANSCODE_HWACCEL=vaapi`.                                                                                                                                                                                                                     |
| `UROBOROS_GENERATE_PREVIEWS`                                 | server                        | `true`                                                             | Whether videos get hover preview clips (a short silent 480p clip of snippets from across each, cut on the CPU by replicas with `UROBOROS_TRANSCODE_CONCURRENCY` above 0; docs/library.md). `false` makes none; those already made still play.                                        |
| `UROBOROS_WORK_DIR`                                          | server                        | `$TMPDIR/uroboros-work`                                            | Scratch space for downloads in progress (a tmpfs in compose).                                                                                                                                                                                                                        |
| `UROBOROS_SECRETS_KEY`                                       | server                        | unset (saving site logins off)                                     | 32 random bytes in base64 (`openssl rand -base64 32`) sealing saved site logins; keep it, a new key voids them.                                                                                                                                                                      |
| `UROBOROS_SUBTITLE_LANGS`, `UROBOROS_AUTO_SUBTITLES`         | server                        | `en.*`, `true`                                                     | Subtitles saved with each download (yt-dlp `--sub-langs`, at most 190 characters; empty saves none), and whether automatic captions count (YouTube's transcripts; search reads both, docs/library.md).                                                                               |
| `UROBOROS_MIGRATIONS_DIR`                                    | api, migrate, `migration:new` | the repo's `migrations/`                                           | Where the SQL files are; the image sets `/app/migrations`.                                                                                                                                                                                                                           |
| `UROBOROS_TEST_DATABASE_URL`, `_S3_URL`                      | tests                         | unset (testcontainers)                                             | Servers for the test run to use instead of starting containers.                                                                                                                                                                                                                      |
| `UROBOROS_API_URL`, `UROBOROS_UI_PORT`                       | Vite (`dev:ui`)               | `http://127.0.0.1:18081`, `18173`                                  | Where the dev server proxies `/api`, and its own port.                                                                                                                                                                                                                               |

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
`apps/server/package.json`, `package.json` and `api/openapi.json`, and the changelog
section prepended. Merging it publishes the release, and `release.yml` then builds the image,
smoke-tests it, and pushes `<REGISTRY>/aaldebs99/uroboros:X.Y.Z`, `:X.Y` and `:latest`. Pushes to
main publish `:main`. `renovate.yml` runs a self-hosted Renovate twice a day. It looks up the ffmpeg image's tags in the
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
apps/server          @uroboros/server    the server, migrate and gen; bin/{server,migrate,gen}.ts
apps/web             @uroboros/web       React + Vite UI
packages/contract    @uroboros/contract  zod wire schemas shared by server and UI
tools/ratchet        @uroboros/ratchet   ratchets and ci-parity (docs/ratchets.md)
migrations/                              forward-only SQL migrations
api/openapi.json                         generated, committed
compose.yaml, compose.dev.yaml           local stack and its hot-reload overlay
scripts/image/                           image tooling and the image smoke test
scripts/release/                         release PR and release cut
.mise/config.toml                        tool pins and every task
```
