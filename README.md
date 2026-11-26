<p align="center"><img src="assets/logos/uroboros.svg" alt="" width="160"></p>

<h1 align="center">Uroboros</h1>

Uroboros is a cloud-native self-hosted video library. Paste a link to a video, a playlist or a whole channel,
and it downloads to your own server, into a library you can search and watch from any browser, or
from your phone as an app. It replaces [ytdl-material](https://github.com/Tzahi12345/YoutubeDL-Material).

## What it does

- **Saving**: videos, playlists and channels from YouTube and the other sites
  [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports, in the quality you pick.
- **Subscriptions**: follow a channel or a playlist, and its new videos arrive on their own.
- **Watching**: picks up where you left off, with chapters, subtitles and SponsorBlock skips, and a
  preview when you hover over a video. A file your browser can't play is converted as you watch.
- **Uploads**: your own videos, beside the ones you saved.
- **Sharing**: with people, with groups you set up, or by a public link.
- **Notifications** on your phone when a download finishes or something is shared with you.
- **Accounts** for everyone in the household, with single sign-on if you run one.
- **Automation**: an API for scripts, and an MCP server so AI tools such as Claude Code can search
  your library ([docs/mcp.md](docs/mcp.md)).

## Pull requests and issues

**This GitHub repository is a public mirror.** Uroboros is developed on a private forge, and every push
there is copied here, which would replace anything merged on GitHub, so pull requests are turned off. Bug
reports and ideas are welcome as [issues](https://github.com/aaldebs99/Uroboros/issues).

## Under the hood

For developers: one server process serves the web app and its API and runs the downloads, and
several of them can run side by side. It is built from:

- **API**: [Hono](https://hono.dev) with `GET /api/health` (liveness), `GET /api/ready`
  (readiness), `GET /api/info`, OpenAPI generated from the routes and Swagger UI, typed
  `{ code, message }` errors, and the SPA served behind a deep-link fallback. The server is
  stateless and runs as several replicas; one of them at a time holds the leader lock. Personal API
  tokens are scoped to the REST API, the MCP server or both, and may be read-only.
- **MCP server**: `/api/mcp`, for AI tools such as Claude Code, Cursor and VS Code: searching the
  library and its transcripts, saving videos, playlists and subscriptions, as the token's owner. An
  operator can turn it off with `UROBOROS_MCP_ENABLED=false` ([docs/mcp.md](docs/mcp.md)).
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

### Run it with Docker Compose

You need Docker with Compose. Save this as `compose.yaml` in a folder of its own, choose a database
password and an admin password (at least 12 characters), and start it with `docker compose up -d`:

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: uroboros
      POSTGRES_PASSWORD: a-database-password
      POSTGRES_DB: uroboros
    volumes:
      - postgres-data:/var/lib/postgresql

  uroboros:
    image: ghcr.io/aaldebs99/uroboros:latest
    restart: unless-stopped
    depends_on: [postgres]
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://uroboros:a-database-password@postgres:5432/uroboros
      UROBOROS_STORAGE: filesystem
      UROBOROS_STORAGE_ROOT: /media
      UROBOROS_BOOTSTRAP_USERNAME: admin
      UROBOROS_BOOTSTRAP_PASSWORD: an-admin-password
    volumes:
      - media:/media
    # Lets a running download finish or move to another replica when the container stops.
    stop_grace_period: 60s

volumes:
  postgres-data:
  media:
```

Then open http://localhost:8080 and sign in as `admin`. Uroboros creates that account on its first
start and puts its password back on every start, so change it in this file rather than in the app.
Without SSO it won't start without that account; with SSO set up (Configuration) it's optional.
To update, run `docker compose pull && docker compose up -d`: the server applies any database
changes itself as it starts.

- **Releases:** none is out yet, so `:latest` doesn't exist until the first one. Until then, use
  `:main`, which follows every push to main.
- **Your files** are kept in organized folders on the `media` volume. To keep them in a folder you
  can see (for Jellyfin, say), mount that folder at `/media` instead and give it to the container's
  user: `sudo chown -R 65532:65532 /path/to/folder`.
- **Saved site logins**, for sites you must be signed in to, need `UROBOROS_SECRETS_KEY`: 32 random
  bytes from `openssl rand -base64 32`.
- **Behind a reverse proxy**, set `UROBOROS_TRUST_PROXY: "true"`, and set `UROBOROS_PUBLIC_BASE_URL`
  to its https address, which also turns on push notifications. The proxy must accept request
  bodies of 8 MiB for uploads.
- **Every other setting** is in [Configuration](#configuration). The repository's own
  `compose.yaml` is the fuller stack: S3 storage on RustFS, several replicas behind Caddy, and GPU
  transcoding (`compose/gpu/`).

### Develop

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
hand, failing fast when the server cannot be reached. `migrations/20261122000000_schema.sql` is the
schema as first released (0.1.0); every change since is a new file made with
`mise run migration:new <snake_case_name>`, and a committed migration is never edited (the runner
refuses a file whose checksum changed after it was applied).

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
which is what CI does. `mise run test:coverage` runs the same suite with V8 coverage: a summary
in the terminal and an HTML report in `coverage/`, for finding code no test reaches. It is a
report, not a gate.

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

The UI is an installable PWA: a static manifest, icons, and a service worker (vite-plugin-pwa,
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

| Variable                                                     | Read by                       | Default                                                            | What it is                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                               | server, migrate               | required                                                           | Postgres connection string.                                                                                                                                                                                                                                                                                                                                       |
| `UROBOROS_BIND`                                              | server                        | `127.0.0.1:18081`                                                  | `host:port` to listen on; the image sets `0.0.0.0:8080`.                                                                                                                                                                                                                                                                                                          |
| `UROBOROS_WEB_DIST`                                          | server                        | unset (no SPA)                                                     | The built SPA to serve; the image sets `/app/web`.                                                                                                                                                                                                                                                                                                                |
| `UROBOROS_BODY_LIMIT_BYTES`                                  | server                        | `65536`                                                            | Largest request body on `/api/*`; larger gets 413 `payload_too_large`.                                                                                                                                                                                                                                                                                            |
| `UROBOROS_SHUTDOWN_GRACE_MS`                                 | server                        | `20000`                                                            | After SIGTERM, how long in-flight requests may run before they are cut (running downloads get 25 s, then go back to the queue).                                                                                                                                                                                                                                   |
| `UROBOROS_DB_STARTUP_GRACE_SECS`                             | server                        | `0` (retry until it answers)                                       | How long start-up retries an unreachable Postgres before exiting 1.                                                                                                                                                                                                                                                                                               |
| `UROBOROS_PUBLIC_BASE_URL`                                   | server                        | unset (push off)                                                   | The public origin, e.g. `https://uroboros.example.com`, no path; push is on only when https.                                                                                                                                                                                                                                                                      |
| `UROBOROS_PUSH_SUBJECT`                                      | server                        | the public URL                                                     | The VAPID contact, a `mailto:` address or an https URL.                                                                                                                                                                                                                                                                                                           |
| `UROBOROS_VAPID_PUBLIC_KEY`, `UROBOROS_VAPID_PRIVATE_KEY`    | server                        | generated once, kept in the database                               | A fixed VAPID pair; both or neither. Changing it drops every subscription.                                                                                                                                                                                                                                                                                        |
| `UROBOROS_PUSH_ALLOWED_HOSTS`                                | server                        | Apple, Google, Mozilla, Microsoft push                             | Comma-separated hosts a subscription endpoint may be on (or a subdomain of), against SSRF.                                                                                                                                                                                                                                                                        |
| `UROBOROS_PUSH_MAX_DEVICES`                                  | server                        | `10`                                                               | Devices with notifications per user.                                                                                                                                                                                                                                                                                                                              |
| `UROBOROS_SESSION_TTL_HOURS`                                 | server                        | `720`                                                              | Fixed session lifetime (docs/auth.md).                                                                                                                                                                                                                                                                                                                            |
| `UROBOROS_TRUST_PROXY`                                       | server                        | `false`                                                            | Read the client IP from `X-Forwarded-For` for the per-IP sign-in limit; true behind a proxy.                                                                                                                                                                                                                                                                      |
| `UROBOROS_LOCAL_LOGIN`                                       | server                        | `true`                                                             | Local username/password sign-in; with it off, OIDC must be configured.                                                                                                                                                                                                                                                                                            |
| `UROBOROS_BOOTSTRAP_USERNAME`, `UROBOROS_BOOTSTRAP_PASSWORD` | server                        | unset; required without OIDC                                       | The admin re-seeded on every start; both or neither, password 12+ characters. Optional with OIDC, whose groups make the admins.                                                                                                                                                                                                                                   |
| `UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD`                     | server                        | `false`                                                            | Accept a shorter bootstrap password (logs a warning). Local dev stacks only; the dev overlay, `docker:up` and `dev:server` set it.                                                                                                                                                                                                                                |
| `UROBOROS_OIDC_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET`       | server                        | unset (no SSO)                                                     | The OIDC provider; all three or none, and `UROBOROS_PUBLIC_BASE_URL` is required with them.                                                                                                                                                                                                                                                                       |
| `UROBOROS_OIDC_DISPLAY_NAME`                                 | server                        | `Authentik`                                                        | The provider's name on the sign-in button.                                                                                                                                                                                                                                                                                                                        |
| `UROBOROS_OIDC_ADMIN_GROUPS`                                 | server                        | `authentik Admins`                                                 | Comma-separated groups whose members are admins.                                                                                                                                                                                                                                                                                                                  |
| `UROBOROS_OIDC_GROUPS_CLAIM`                                 | server                        | `groups`                                                           | The ID-token claim holding the groups.                                                                                                                                                                                                                                                                                                                            |
| `UROBOROS_OIDC_AUTO_CREATE`                                  | server                        | `true`                                                             | Make an account at someone's first SSO sign-in; `false` lets in only existing SSO accounts (turn it on while someone new signs in once).                                                                                                                                                                                                                          |
| `UROBOROS_OIDC_SYNC_INTERVAL_SECS`                           | server                        | `900`                                                              | How stale SSO claims may get before the sync refreshes them; `0` turns the sync off.                                                                                                                                                                                                                                                                              |
| `UROBOROS_MCP_ENABLED`                                       | server                        | `true`                                                             | The MCP server at `/api/mcp` ([docs/mcp.md](docs/mcp.md)); read at start, so set it the same on every replica.                                                                                                                                                                                                                                                    |
| `UROBOROS_WORKER_CONCURRENCY`                                | server                        | `4`                                                                | Parallel download jobs per replica.                                                                                                                                                                                                                                                                                                                               |
| `YTDLP_PATH`                                                 | server                        | `yt-dlp` on `PATH`                                                 | The yt-dlp binary; the image sets `/opt/yt-dlp/bin/yt-dlp`.                                                                                                                                                                                                                                                                                                       |
| `UROBOROS_STORAGE`                                           | server                        | required                                                           | Where media is stored: `s3` or `filesystem` (organized folders).                                                                                                                                                                                                                                                                                                  |
| `UROBOROS_S3_ENDPOINT`, `UROBOROS_S3_BUCKET`                 | server                        | required for `s3`                                                  | The S3-compatible endpoint (RustFS locally) and an existing bucket.                                                                                                                                                                                                                                                                                               |
| `UROBOROS_S3_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`            | server                        | required for `s3`                                                  | The S3 access key pair.                                                                                                                                                                                                                                                                                                                                           |
| `UROBOROS_S3_REGION`, `UROBOROS_S3_FORCE_PATH_STYLE`         | server                        | `us-east-1`, `true`                                                | The S3 region and path-style addressing.                                                                                                                                                                                                                                                                                                                          |
| `UROBOROS_S3_PUBLIC_URL`                                     | server                        | unset (stream through the api)                                     | An endpoint browsers can reach; set, "save file" redirects to a presigned URL.                                                                                                                                                                                                                                                                                    |
| `UROBOROS_STORAGE_ROOT`                                      | server                        | required for `filesystem`                                          | The absolute path of the shared media volume.                                                                                                                                                                                                                                                                                                                     |
| `UROBOROS_STORAGE_LAYOUT`                                    | server                        | `{channel}/{upload_date} {title} [{id}]/{title} [{profile}].{ext}` | The folder layout for `filesystem` (docs/downloads.md lists the tokens).                                                                                                                                                                                                                                                                                          |
| `UROBOROS_MAX_ACTIVE_DOWNLOADS_PER_USER`                     | server                        | `3`                                                                | Downloads of one person running at once; the rest wait their turn.                                                                                                                                                                                                                                                                                                |
| `UROBOROS_MAX_PLAYLIST_ENTRIES`                              | server                        | `1000`                                                             | Entries kept per playlist or channel-tab preview.                                                                                                                                                                                                                                                                                                                 |
| `UROBOROS_MIN_CHECK_INTERVAL_MINUTES`                        | server                        | `60`                                                               | The shortest check interval a subscription may have, in minutes.                                                                                                                                                                                                                                                                                                  |
| `UROBOROS_UPLOAD_MAX_BYTES`                                  | server                        | `10737418240` (10 GiB)                                             | The largest video a person may upload, in bytes; at most 80 GiB (10,000 parts of 8 MiB). A reverse proxy in front must take 8 MiB request bodies (docs/uploads.md).                                                                                                                                                                                               |
| `UROBOROS_LARGE_DOWNLOAD_BYTES`                              | server                        | `32212254720` (30 GiB)                                             | A download yt-dlp expects to be larger than this, in bytes, waits for its owner's OK before it is fetched, and they are told (a notice, pushed); `0` never asks (docs/downloads.md "Large downloads").                                                                                                                                                            |
| `UROBOROS_TRANSCODE_CONCURRENCY`                             | server                        | `10`                                                               | Playback sessions this replica transcodes or remuxes at once; `0` runs none here, so only GPU replicas need it (docs/transcoding.md). A paused viewer holds one while their tab is open.                                                                                                                                                                          |
| `UROBOROS_TRANSCODE_HWACCEL`                                 | server                        | `none`                                                             | This replica's GPU for playback sessions: `none` (the CPU, libx264), `nvenc` (NVIDIA: give the service the GPU, `compose/gpu/nvidia.yaml`) or `vaapi` (AMD, and Intel untested: the render node, `compose/gpu/vaapi.yaml`). A GPU that fails its startup test falls back to the CPU.                                                                              |
| `UROBOROS_TRANSCODE_VAAPI_DEVICE`                            | server                        | `/dev/dri/renderD128`                                              | The VA-API render node, with `UROBOROS_TRANSCODE_HWACCEL=vaapi`.                                                                                                                                                                                                                                                                                                  |
| `UROBOROS_TRANSCODE_MAX_HEIGHT`                              | server                        | `2160`                                                             | The tallest a playback session encodes, on the short side: `2160`, `1440`, `1080`, `720`, `480` or `360`. A video the browser can't decode plays at its own size up to this, and the Quality menu offers nothing taller. A CPU can't encode 4K in real time, so a server without a GPU should set `1080`. Set it the same on every replica (docs/transcoding.md). |
| `UROBOROS_GENERATE_PREVIEWS`                                 | server                        | `true`                                                             | Whether videos get stored hover previews (the whole video at 480p with sound, made by replicas with `UROBOROS_TRANSCODE_CONCURRENCY` above 0; docs/library.md). `false` makes none, downloading and encoding nothing; the rest preview from the original or a live session.                                                                                       |
| `UROBOROS_PREVIEW_METHOD`                                    | server                        | `download`                                                         | How hover previews are made: `download` fetches a 480p copy from the video's site (kept as it is when it is H.264 with AAC), `transcode` encodes the stored file on the CPU, as uploads and cut files always are. Ignored when `UROBOROS_GENERATE_PREVIEWS` is `false`.                                                                                           |
| `UROBOROS_WORK_DIR`                                          | server                        | `<root>/.uroboros-work` (filesystem), `$TMPDIR/uroboros-work` (S3) | Scratch space for downloads in progress. With filesystem storage the default is in the storage root, so a finished file is moved into place, never copied; on another disk it is copied. Compose keeps S3's in a tmpfs.                                                                                                                                           |
| `UROBOROS_SECRETS_KEY`                                       | server                        | unset (saving site logins roff)                                    | 32 random bytes in base64 (`openssl rand -base64 32`) sealing saved site logins; keep it, a new key voids them.                                                                                                                                                                                                                                                   |
| `UROBOROS_SUBTITLE_LANGS`, `UROBOROS_AUTO_SUBTITLES`         | server                        | `en.*`, `true`                                                     | Subtitles saved with each download (yt-dlp `--sub-langs`, at most 190 characters; empty saves none), and whether automatic captions count (YouTube's transcripts; search reads both, docs/library.md).                                                                                                                                                            |
| `UROBOROS_MIGRATIONS_DIR`                                    | api, migrate, `migration:new` | the repo's `migrations/`                                           | Where the SQL files are; the image sets `/app/migrations`.                                                                                                                                                                                                                                                                                                        |
| `UROBOROS_TEST_DATABASE_URL`, `_S3_URL`                      | tests                         | unset (testcontainers)                                             | Servers for the test run to use instead of starting containers.                                                                                                                                                                                                                                                                                                   |
| `UROBOROS_API_URL`, `UROBOROS_UI_PORT`                       | Vite (`dev:ui`)               | `http://127.0.0.1:18081`, `18173`                                  | Where the dev server proxies `/api`, and its own port.                                                                                                                                                                                                                                                                                                            |

The compose host ports (`UROBOROS_PORT` and the others) are under Quickstart. `compose.yaml` has no
default account: without OIDC, set `UROBOROS_BOOTSTRAP_USERNAME` and `UROBOROS_BOOTSTRAP_PASSWORD`
(12+ characters) in the shell. `mise run docker:up`, `docker:up:dev` and `dev:server` sign in with
a dev-only `admin` / `admin` unless you set them.

## CI and releases

The repository is hosted on a private, self-hosted Gitea and mirrored to
https://github.com/aaldebs99/Uroboros, and the workflows in `.github/workflows` run on the
forge's Actions runners (Actions are off on the mirror). `ci.yml` runs every gate as one
`mise run <task>` step, and its `CI` job is the required status check. `pr-title.yml` requires a
conventional-commit PR title. Its `mirror` job copies `main` and its tags to the GitHub mirror
once every gate has passed, among them `ratchet:forge-host`, which reads the whole history for
the forge's domain.

Releases come from a PR. On every push to main, `release-pr.yml` proposes the next version as a
`chore(release): X.Y.Z` PR from the `release/next` branch, with the version stamped into
`apps/server/package.json`, `package.json` and `api/openapi.json`, and the changelog
section prepended. Merging it publishes the release, and `release.yml` then builds the image,
smoke-tests it, and pushes `:X.Y.Z`, `:X.Y` and `:latest` to both `<REGISTRY>/aaldebs99/uroboros`
and `ghcr.io/aaldebs99/uroboros`, one build with one digest. Pushes to main publish `:main` to
both. `renovate.yml` runs a self-hosted Renovate twice a day.

The repository needs these Actions variables and secrets:

| Name                        | Kind     | For                                                                                                        |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `REGISTRY`                  | variable | The forge's registry host the images are pushed to (kept out of the repository).                           |
| `REGISTRY_TOKEN`            | secret   | An access token of the `aaldebs99` account scoped `write:package`, which `release.yml` pushes with.        |
| `GHCR_TOKEN`                | secret   | A GitHub personal access token (classic) of `aaldebs99` scoped `write:packages`, for the GHCR copy.        |
| `GH_MIRROR_TOKEN`           | secret   | A GitHub token with Contents and Workflows write on the mirror, which `ci.yml`'s `mirror` job pushes with. |
| `RELEASE_PLEASE_TOKEN`      | secret   | The release bot's token, scoped `write:repository`, `write:issue` and `read:user`.                         |
| `RENOVATE_TOKEN`            | secret   | The Renovate bot's token, scoped `write:repository`, `write:issue`, `read:user` and `read:organization`.   |
| `RENOVATE_GITHUB_COM_TOKEN` | secret   | A github.com token with no scopes, so Renovate can look up GitHub-hosted dependencies.                     |

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

## What Does The Name Mean?

Uroboros is named after the [Mask of Uroboros](https://witcher.fandom.com/wiki/Mask_of_Uroboros) from The Witcher 3 game.
In the game, the mask is used to "rewatch" incidents of magic cataclysms.
