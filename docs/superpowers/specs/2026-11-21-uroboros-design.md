# Uroboros: a TypeScript replacement for ytdl-material

## Context

ytdl-material (`/PM9A3/.repos/ytdl-material`) is unstable, looks dated, depends on MariaDB, and lacks many features the user wants. Uroboros (`/PM9A3/.repos/Uroboros`, currently empty, not yet a git repo) replaces it with an all-TypeScript app that still uses yt-dlp to fetch media. yt-dlp and ffmpeg run as separate programs, which is also how ytdl-material uses them (`backend/youtube-dl.js`, `backend/downloader.js`). No Python code is written; Python exists only inside the worker image as yt-dlp's runtime.

Success means it runs as several replicas on Kubernetes without losing or duplicating work, presents a modern UI, and ships v1 with all of: a library/media server, automation, multi-user with SSO, a public API, and replica support.

Anti-goals: a port of ytdl-material's code or data model; any single-node assumption (local-disk state, in-memory locks, in-process schedulers) in the core path; the API process ever spawning yt-dlp.

## Approaches considered

A: separate API and worker services in one TypeScript monorepo, with a React SPA. B: Next.js full-stack plus a worker (SSR adds little to a logged-in media app; streaming and WebSocket progress are awkward). C: NestJS plus a React SPA (heavy Angular-like structure). **The user picked: the stack of `/PM9A3/.repos/rust-ui-template` with the Rust part removed.** That makes A the shape, with the template's tooling and principles carried over and the Rust backend replaced by a TypeScript one.

## Stack (from rust-ui-template, Rust replaced)

What carries over unchanged from the template: mise as the only source of tool pins and tasks (`.mise/config.toml`, `mise.lock`, `mise run ci` = definition of done, `ci:parity`), pnpm 12, Node 24, React 19 + Vite 8 + TanStack Query + Tailwind 4 (`web/package.json` versions), vitest + Testing Library, eslint flat config with `--max-warnings 0`, both TypeScript packages the template pins (`typescript` and `@typescript/native`), oxfmt, lefthook, Renovate with its 3-day soak, git-cliff, actionlint/zizmor/shellcheck, GitHub plus Forgejo/Gitea CI workflows that only call `mise run <task>`, a distroless runtime image, and the ratchets (file lines ≤1000, cognitive complexity 25/function and 200/file sum, suppression counts, pin agreement) with the frozen-exception rules in `docs/ratchets.md`.

What replaces the Rust: the rest of this section, with each choice paired to the Rust piece it stands in for.

| Template (Rust) | Uroboros (TypeScript), my call |
| --- | --- |
| axum router | Hono on `@hono/node-server` |
| utoipa + ts-rs (one source for wire types) | Zod schemas in `packages/contract` via `@hono/zod-openapi`; `mise run gen` writes `api/openapi.json`, committed, `check:gen` fails on drift. The UI imports wire types only from the contract package barrel (eslint-enforced), same rule as the template. |
| `ApiErrorBody {code,message}` + `ApiErrorCode` enum | Same shape; `code` a Zod enum, exhaustive `satisfies Record<ApiErrorCode, …>` in the UI |
| sqlx runtime queries + SQL migrations applied on startup | Kysely (typed query builder over `pg`) + plain `.sql` migrations in `migrations/`, forward-only, never edited once shipped. Applied by a one-shot `migrate` command (Helm pre-install/upgrade Job), not on every replica's startup, to avoid races between replicas. |
| testcontainers + nextest setup script + per-test template DB clone | vitest `globalSetup` starting `@testcontainers/postgresql` and Valkey once per run, migrating `app_template`, each test `CREATE DATABASE … TEMPLATE app_template`. `APP_TEST_DATABASE_URL` override kept for Forgejo runners. |
| clippy + cargo-deny | typescript-eslint strict-type-checked, plus `pnpm audit` and a license allowlist check |
| xtask ratchets | Ratchets reimplemented as a small TS package `tools/ratchet` (complexity via eslint-plugin-sonarjs cognitive-complexity, the same SonarSource metric arborist computes; arborist itself is a Rust crate) |
| rust-embed single binary | The API image serves `web/dist` statically; one image, two entrypoints (see below) |

New pieces the template doesn't have: Valkey + BullMQ (queues, repeatable/scheduled jobs, rate limits), `ioredis` pub/sub for cross-replica events, OIDC via `openid-client` with sessions in Valkey, S3-compatible object storage via `@aws-sdk/client-s3` (with a local-disk adapter behind the same interface, dev only), TanStack Router for the SPA, shadcn/ui on Tailwind 4 for components, Vidstack for the player.

## Layout

```text
apps/server       one package, two entrypoints: `api` (Hono) and `worker` (BullMQ consumers); plus `migrate`
apps/web          React SPA
packages/contract Zod wire schemas + generated OpenAPI; imported by server and web
packages/ytdlp    typed yt-dlp/ffmpeg wrapper: spawn, progress parsing (--progress-template JSON), info.json validation with Zod, cancellation
tools/ratchet     ratchets + ci-parity
migrations/       SQL
chart/            Helm chart (api Deployment + HPA, worker Deployment, migrate Job)
```

## Runtime architecture

API pods are stateless: HTTP, auth, DB reads and writes, enqueueing jobs, streaming media from S3 (HTTP range requests proxied, or presigned redirect, configurable), and an SSE endpoint fed by Valkey pub/sub so progress reaches a user regardless of which replica they're connected to. Worker pods run yt-dlp and ffmpeg into a per-job scratch `emptyDir`, then upload results and thumbnails to S3 and write rows in a transaction. A job is idempotent on `(source_video_id, format_profile)`, so a retry after a worker crash never duplicates a library item. Scheduled automation uses BullMQ job schedulers, so exactly one replica fires each schedule. The worker image is a separate Docker target (Debian slim + Node + Python + pinned yt-dlp + ffmpeg). yt-dlp is pinned and bumped by Renovate like everything else, with an admin-visible version and a manual "update yt-dlp" path that is off by default.

## v1 features, in build order

Each step rests on the one before it. These are my proposals for what each feature area contains.

1. **Foundation**: repo from the template, contract/gen pipeline, migrations, test harness, Helm chart, CI green.
2. **Users and SSO**: OIDC login (any provider; tested against Authentik/Keycloak), optional local accounts, roles admin/user, group→role mapping from OIDC claims, API tokens per user for the public API.
3. **Downloads**: paste URL (video, playlist, channel), format profiles (admin-defined presets: e.g. best ≤1080p mp4, audio-only opus), queue view with live progress, cancel, retry, error surfacing with the yt-dlp stderr.
4. **Library / media server**: media is stored once and deduplicated by extractor+video id; each user has their own library view onto shared media (so two users downloading the same video costs one copy). Browse by channel, playlist, tags; full-text search (Postgres `tsvector`); in-browser playback with chapters and subtitles; per-user watch progress and watched state; thumbnails.
4b. **Transcoding**: the `transcode` queue and Deployment, profile conversion, and HLS playback fallback (see "Decided by the user").
5. **Automation**: subscriptions to channels and playlists with check intervals, filters (title regex, duration, date, shorts/live exclusion), per-subscription format profile, SponsorBlock removal, retention rules (keep last N, delete watched after X days).
6. **Sharing and public API**: share links to an item or playlist (optional expiry), the full REST API documented at `/api/docs`, outbound webhooks on download/subscription events (HMAC-signed).

## Decided by the user after review

**Fresh start.** There is no importer and no compatibility with ytdl-material data.

**Storage is configurable per deployment.** A `MediaStore` interface has two production backends. The S3-compatible one uses opaque keys. The shared-filesystem one (an RWX volume or NFS) uses a human-readable layout, `<Channel>/<YYYY-MM-DD> <Title> [<id>]/<rendition>.<ext>`, with a `.nfo` and thumbnail alongside, so Jellyfin and Plex can index it. Both backends support range reads for streaming, atomic finalize (an upload, or a write to a temp file followed by a rename), and delete. The worker always downloads to scratch first and then hands the file to the store. The contract tests run against both backends.

**Transcoding is kept in v1.** It runs as a separate `transcode` worker queue using ffmpeg. It converts a rendition to another profile on demand, and it offers optional playback transcoding to H.264/AAC HLS for browsers that can't play the source codec, cached as its own rendition. Transcode workers get their own Deployment so CPU and GPU sizing are independent of the download workers. Everything else ytdl-material has (AI transcription, Twitch chat, zip export, notifications beyond webhooks, audio cutting beyond SponsorBlock) is out of v1.

**No API compatibility.** The new API is designed freely. Rebuilding a browser extension or an MCP server against it comes after v1.

## Calls made on the builder's questions (my calls, correctable)

**Shared media model.** A `media` row per extractor+video id holds one or more `renditions`, one per format profile, so two users who pick different profiles share one item with two files. A user's library is a set of `library_entries` pointing at media. Per-user retention and "delete" only remove that user's entry. A rendition's file is physically deleted only when no entry and no subscription still references it, by a reaper job.

**yt-dlp auth.** v1 uses admin-supplied cookies (Kubernetes Secret, mounted into workers), plus optional PO-token provider settings. BullMQ rate limits are keyed per extractor. Per-user cookies are deferred.

**Trust model.** Users are trusted (a household or a small team), but workers still get a NetworkPolicy that denies egress to cluster-internal and private ranges, and per-user concurrent-job limits are configurable by admins.

## Left to the builder

Internal module structure, exact library versions (resolve the latest stable, respecting the Renovate soak), UI visual design within shadcn/ui, Helm chart details beyond the three workloads, and how the ratchets get ported.

## Next step once approved

Initialize Uroboros as a git repo. Commit this design as `docs/superpowers/specs/2026-11-21-uroboros-design.md`, then write the step-by-step implementation plan (writing-plans), starting with step 1, the foundation.

## Verification

`mise run ci` passes (lint, typecheck, vitest unit and integration tests against real Postgres and Valkey, gen drift, ratchets). The end-to-end check: start `docker compose` with Postgres, Valkey, MinIO, a Keycloak dev realm, two API replicas behind a proxy, and two workers. Log in via OIDC, download a short Creative Commons video, watch progress arrive on whichever replica serves SSE, play it back, kill a worker mid-download and confirm the job retries without duplicating, then add a subscription and confirm exactly one scheduled check fires. Drive the UI with Playwright for the login → download → play path.
