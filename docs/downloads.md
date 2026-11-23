# Downloads and storage

How a pasted link becomes a stored file in someone's library. The api never runs yt-dlp; the
workers do.

## Flow

1. `POST /api/downloads {url, profileId?}` records a `download_requests` row (`probing`) and adds
   `probe|<requestId>` to the `probe` queue. Without `profileId` the default format profile is
   used.
2. A worker probes the link with `--flat-playlist` (`src/worker/probe.ts`):
   - a **video** upserts its `media` row, creates one `downloads` row and dispatches it; the
     request becomes `queued`;
   - a **playlist** becomes `choosing`, with one preview group, every entry ticked;
   - a **channel's main URL** lists its tabs; each tab is probed and becomes a group (Videos
     ticked, Shorts and Live unticked);
   - a group is cut at `UROBOROS_MAX_PLAYLIST_ENTRIES` (1000), and says so;
   - a failure marks the request `failed` with its error kind.
3. `POST /api/downloads/requests/{id}/queue {entryIds}` turns the ticked entries into downloads.
   Entries the person already has, or is already getting, are skipped and counted. A preview
   nobody queues expires after a day (the leader's sweeper deletes it).
4. Queueing a download (`queueDownload` in `src/downloads/dispatch.ts`) snapshots the profile's
   arguments and revision on the row. If the rendition is already stored, the download is `done`
   at once and a library entry is added; otherwise it waits as `queued`.
5. **Dispatch** (`dispatchFor`): under a per-user transaction lock, a person's oldest waiting
   downloads are dispatched until `UROBOROS_MAX_ACTIVE_DOWNLOADS_PER_USER` (3) of theirs are
   dispatched and active. Dispatching adds the fetch job, whose BullMQ job id is the **fetch key**
   `fetch|<extractor>|<videoId>|<profileId>|<revision>` (each part URI-encoded; BullMQ refuses `:`).
   A second add of a live id is ignored, so two people asking for the same video and profile at
   once share one fetch. Whenever a download settles, its owner's next one is dispatched.
6. **Fetch** (`src/worker/fetch.ts`): in a scratch directory under `UROBOROS_WORK_DIR`, yt-dlp
   downloads with the snapshot's arguments (plus a jpg thumbnail and the `.info.json`), ffprobe
   reads the codecs, and the file and its sidecars go to the store. Then one transaction records
   the rendition (`ON CONFLICT DO NOTHING`), marks every download waiting on the fetch key `done`
   and adds their library entries. The scratch directory is removed whatever happens.
7. **Failures**: `rate_limited`, `network`, `timed_out`, `unknown` and `storage` retry up to 3
   attempts with exponential backoff (the downloads stay `running`, `attempts` counts); every other
   kind, or the last attempt, marks them `failed` with a server message and the redacted stderr
   tail. A stalled job (a dead worker) runs again; storage keys are deterministic and the rendition
   and library inserts are idempotent, so a rerun never duplicates anything.

## Cancel and retry

Cancelling marks that person's download `cancelled`. Only when no other active download waits on
the fetch key is the fetch stopped: a waiting job is removed, a running one gets a message on
`<prefix>:downloads:cancel`, and the worker running it aborts (yt-dlp's process group is killed and
its partial files removed). Retrying a failed or cancelled download queues it again from scratch.
Members act on their own downloads; admins on anyone's.

## Live progress

The worker publishes progress (at most twice a second per fetch, plus every phase change:
downloading, merging, postprocessing, storing) and state changes on `<prefix>:downloads:events`,
and keeps the latest progress in `<prefix>:progress:<fetchKey>` for a minute. Every api replica
subscribes once (`src/downloads/sse.ts`); `GET /api/downloads/events` streams `DownloadEvent`s for
the caller's downloads (`?all=true`: everyone's, admins only). The web app falls back to
refetching the list when the stream drops.

## Format profiles

Admin-defined yt-dlp presets (`format_profiles`): a format selector, a container to merge into, or
audio-only with an audio format, and extra arguments from the wrapper's allowlist (checked by the
api with `@uroboros/ytdlp/flags` when saved, and again by the worker). `revision` hashes the
file-shaping arguments, and renditions are keyed by it, so editing a profile makes new downloads
fetch a fresh file instead of reusing one made with the old arguments; files already in libraries
stay. Exactly one profile is the default. A profile in use cannot be deleted. Seeded: "Best up to
1080p (MP4)" (default), "Best available", "Audio only (Opus)".

## Storage

`UROBOROS_STORAGE` picks the backend (`src/storage/`); both pass one contract test suite.

- **s3**: any S3-compatible service (RustFS locally and in tests, never MinIO), opaque keys:
  `media/<mediaId>/<profileId>-<revision>.<ext>`, `media/<mediaId>/thumbnail.jpg`,
  `media/<mediaId>/info.json`. The bucket must exist (compose's `rustfs-init` creates it).
- **filesystem**: organized folders on a volume the api and the workers share, from
  `UROBOROS_STORAGE_LAYOUT` (default
  `{channel}/{upload_date} {title} [{id}]/{title} [{profile}].{ext}`), with the thumbnail and
  `.info.json` beside the media file. Tokens: `channel`, `uploader`, `title`, `id`, `extractor`,
  `upload_date` (YYYY-MM-DD, or `unknown-date`), `year`, `profile`, `ext`. Every token value, and
  then every path segment, is sanitized: no separators or control characters, no leading dots, at
  most 100 bytes on a character boundary, never empty. Writes go to a temp file and are renamed
  into place. The stored key is the relative path, so a new layout affects new files only.

`GET /api/library/{id}/file` streams the file with range support, named
`<title> [<profile>].<ext>`; with `UROBOROS_S3_PUBLIC_URL` set it redirects to a URL presigned
against that endpoint for 15 minutes instead. `GET /api/library/{id}/thumbnail` serves the
thumbnail. Removing a library entry deletes the row only; the file stays until the reaper (with
subscriptions and retention) deletes unreferenced renditions.

## Not yet

Push notifications for finished downloads, per-site rate limits, per-user cookies, and the reaper.
