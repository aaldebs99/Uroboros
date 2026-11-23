# Transcoding: the compatible copy

Every downloaded video should play in any browser. Most downloads are VP9 or AV1 with Opus in WebM
or MKV ("Best available", the default profile): Chrome and Firefox play the WebM ones, Safari and
iOS often cannot, and no browser plays MKV reliably. When a browser cannot play an entry's file,
Uroboros makes an H.264/AAC (or AAC-only) HLS copy of it on demand, plays that, and keeps it for
next time. The library is in [library.md](library.md), storage and the reaper in
[downloads.md](downloads.md) and [automation.md](automation.md).

## Deciding

`GET /api/library/{id}` gives the file's `container` (its extension), `videoCodec` and
`audioCodec` (ffprobe's names) and `playbackUrl`. The item page turns them into a MIME type with
RFC 6381 codecs (`video/webm; codecs="vp09.00.40.08, opus"`) and asks the browser's
`canPlayType`; `maybe` or `probably` plays the original, and MKV never does
(`apps/web/src/library/playable.ts`). Under the player, "Problems playing? Use the compatible
version" switches by hand, and "Play the original" switches back.

## Asking for a copy

`POST /api/library/{id}/playback` finds or makes the copy of the entry's file for the current
settings and queues its job; `GET` reports it. Both answer `Playback` (`state`, `mode`,
`readySegments`, `progress` from 0 to 1, `masterUrl`, `error`) and mark the copy as used. A copy
is shared by everyone with that file; two requests at once make one (`transcodes` is unique by
source and settings); asking again after a failure makes a new one. The page polls every 2 s and
shows real progress until the copy is playable: with native HLS (Safari, iOS) once 2 segments are
stored, otherwise once it is done.

## Making it

The `transcode` queue (jobs `transcode|<id>`, newest first) is consumed in every replica, up to
`UROBOROS_TRANSCODE_CONCURRENCY` at a time (0 takes none). The consumer (`src/worker/transcode.ts`):

1. Drops a copy nobody has asked about for 10 minutes that has stored nothing (videos opened and
   left do not hold up the next viewer). A run after a cut (shutdown, a dead replica) writes the
   next attempt and trashes the last one's files.
2. Reads the source in place (filesystem storage) or copies it to scratch (S3), and probes it.
3. Chooses a mode (`src/transcode/plan.ts`): `audio` without video; `remux` for 8-bit H.264 (the
   video is copied: seconds, not minutes); otherwise `encode`, to H.264 with libx264 (`veryfast`,
   CRF 23, high profile, at most 1080 lines, a keyframe every 6 s), or NVENC with
   `UROBOROS_TRANSCODE_HWACCEL=nvenc`. An HDR source (PQ or HLG) is tone-mapped to BT.709. Audio
   that is AAC is copied, anything else becomes AAC 160 kb/s stereo.
4. Runs ffmpeg into fragmented-MP4 HLS (`transcodeHls` in `@uroboros/ytdlp`): `init.mp4`,
   `seg-00001.m4s`… of 6 s, and an `EVENT` playlist.
5. Every 2 s stores what ffmpeg has finished: `init.mp4`, each new segment, then a playlist naming
   only stored segments (`src/transcode/uploader.ts`), so a player never asks for a file that is
   not there; then progress. A copy deleted meanwhile (its source reaped) stops ffmpeg and leaves
   nothing behind. When ffmpeg ends, the playlist gets `#EXT-X-ENDLIST` and the copy is done; a
   failure is recorded with ffmpeg's last line.

The encoder is fixed when a copy is made, and part of its identity with the settings: a copy is
never finished by a different encoder, and changing either makes new copies. A copy's files live
under `.transcodes/<id>/<attempt>/` at the store's root (a dot folder, out of the organized
folders media servers read).

## Serving it

- `GET /api/library/{id}/playback/master.m3u8`: a one-variant multivariant playlist (the codecs,
  the resolution), which Video.js's HLS engine needs; `no-store`.
- `GET /api/library/{id}/playback/{attempt}/index.m3u8`: the stored media playlist; `no-store`
  (it grows).
- `GET /api/library/{id}/playback/{attempt}/{init.mp4 | seg-NNNNN.m4s}`: streamed through the api
  (same origin), `private, max-age=31536000, immutable`; any other name is 404.

The player plays it inside the same skin with chapters, subtitles, resume and progress:
`NativeHlsVideo` where the browser plays HLS itself, `HlsVideo` (Video.js 10's MSE engine, SPF)
elsewhere. The CSP's `media-src` allows `blob:` for MSE.

## Keeping and removing copies

The leader's reaper removes copies unused for `UROBOROS_TRANSCODE_KEEP_DAYS` (30) and failed ones
after a day; a rendition it sweeps takes its copies with it. Every minute the leader re-adds the
job of a copy someone is waiting for (or that was running on a replica that died) whose job is
gone.

## Configuration

| Variable                         | Default | Meaning                                                  |
| -------------------------------- | ------- | -------------------------------------------------------- |
| `UROBOROS_TRANSCODE_CONCURRENCY` | `1`     | Copies made at once by this replica; `0` makes none here |
| `UROBOROS_TRANSCODE_HWACCEL`     | `none`  | `none` (libx264) or `nvenc` (the NVIDIA encoder)         |
| `UROBOROS_TRANSCODE_KEEP_DAYS`   | `30`    | Days an unused copy is kept                              |

NVENC needs the NVIDIA container runtime on the `uroboros` service (in compose,
`deploy.resources.reservations.devices` with the `gpu` capability, or `runtime: nvidia`); the
image's ffmpeg has the encoder and the runtime brings the driver. VAAPI and Quick Sync are not
offered yet: the ffmpeg has those encoders too, but the image has no VA-API or Intel drivers.

## Not yet

Converting a stored file to another format profile (re-download with that profile), converting
ahead of time after each download, more than one rendition per copy (no bitrate ladder), and
playback through MSE while a copy is still being made (only native HLS plays a growing playlist).
