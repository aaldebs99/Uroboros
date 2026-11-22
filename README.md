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

## Quickstart

You need [mise](https://mise.jdx.dev), which installs everything else, and Docker for the local
stack and the tests.

```sh
mise trust && mise install   # tools, git hooks, workspace dependencies
mise run dev:deps            # Postgres on 127.0.0.1:15432, Valkey on 127.0.0.1:16379
mise run migrate             # with DATABASE_URL pointing at it
mise run dev:api             # API on http://127.0.0.1:18081
mise run dev:worker          # a worker against the same Valkey
mise run dev:ui              # Vite on http://127.0.0.1:18173, proxying /api to :18081
```

`mise run migrate` reads `DATABASE_URL`; for the `dev:deps` database that is
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

The api and the worker read `DATABASE_URL` and `VALKEY_URL`. The api never migrates; the migrate
entrypoint does, as a one-shot compose service or a Helm hook Job, and every replica can start
it safely because it takes an advisory lock and applies each file exactly once. Add a migration
with `mise run migration:new <snake_case_name>`, which writes
`migrations/<YYYYMMDDHHMMSS>_<name>.sql` with the current UTC time. A migration is never edited
once shipped: the runner refuses a file whose checksum changed after it was applied.

`mise run test` needs Docker and no other setup. The server's vitest global setup starts one
Postgres and one Valkey with testcontainers, migrates a `uroboros_template` database and freezes
it as a template; each test clones it into its own database, so tests never share rows. Set
`UROBOROS_TEST_DATABASE_URL` and `UROBOROS_TEST_VALKEY_URL` to use servers you provide instead,
which is what CI does.

## Installable app and push notifications

The UI is an installable web app: a static manifest, icons, and a service worker (vite-plugin-pwa,
`injectManifest`) that precaches the shell and shows Web Push notifications. Settings,
Notifications turns them on per browser or phone, sends a test, and turns a device off. Push is on
only when the api knows its public https address:

| Variable                                                  | Default                                | What it is                                                                                 |
| --------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `UROBOROS_PUBLIC_BASE_URL`                                | unset (push off)                       | The public origin, e.g. `https://uroboros.example.com`; push is on only when it is https.  |
| `UROBOROS_PUSH_SUBJECT`                                   | the public URL                         | The VAPID contact, a `mailto:` address or an https URL.                                    |
| `UROBOROS_VAPID_PUBLIC_KEY`, `UROBOROS_VAPID_PRIVATE_KEY` | generated once, kept in the database   | A fixed VAPID pair; both or neither. Changing it drops every subscription.                 |
| `UROBOROS_PUSH_ALLOWED_HOSTS`                             | Apple, Google, Mozilla, Microsoft push | Comma-separated hosts a subscription endpoint may be on (or a subdomain of), against SSRF. |
| `UROBOROS_PUSH_MAX_DEVICES`                               | `10`                                   | Devices with notifications per user.                                                       |

The icons are generated from `assets/logos/uroboros-transparent.svg` by `mise run icons` and
committed; run it again after changing the logo. [docs/push.md](docs/push.md) has the design: the
payload, the key bootstrap, the allowlist, the iPhone setup and what comes later.

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
