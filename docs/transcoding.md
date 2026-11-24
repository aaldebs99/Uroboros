# Transcoding: playback sessions

Every downloaded video should play in any browser. Most downloads are VP9 or AV1 with Opus in WebM
or MKV. Chrome and Firefox play the WebM ones, Safari and iOS often can't, and no browser plays MKV
reliably. Uroboros works as Jellyfin does:

- It plays the file as it is when the browser can (**direct play**).
- Otherwise, or when the viewer picks a lower quality, it runs a **playback session**. A session
  remuxes the file (**direct stream**) or transcodes it to H.264 on the fly. It works on the CPU or
  a GPU, from wherever the viewer is, and can seek anywhere.

The library is in [library.md](library.md), public links in [sharing.md](sharing.md), and
storage and the reaper in [downloads.md](downloads.md) and [automation.md](automation.md).

## Deciding how to play

When a video is downloaded, the fetch consumer records each stream's exact RFC 6381 codec string
on the rendition. It uses ffprobe's own `mime_codec_string` where there is one, and works the
string out from profile, level and bit depth otherwise (`src/transcode/codecs.ts`).
`GET /api/library/{id}` (and a public link's item) carries:

- those strings (`videoCodecs`, `audioCodecs`) with the `container`;
- the size;
- the rungs the video offers (`qualities`);
- `playbackUrl`.

The watch page (`apps/web/src/library/playable.ts`) asks the browser about the file itself with
`canPlayType`. `maybe` or `probably` plays the original, and MKV never does. If the original fails
to play anyway, the player reports the error, and the page starts a session from where playback
stopped, transcoding the video.

The player's settings menu has a **Quality** submenu:

- **Original**: direct play, or the smallest change that plays.
- **2160p, 1440p, 1080p, 720p, 480p and 360p**, up to the video's short side, so a vertical video
  gets the same rungs. Each rung has a bitrate cap: 20, 12, 8, 4, 1.5 and 0.8 Mb/s.

Picking a rung starts a session at the current position. Picking Original goes back. The menu takes
the place of the skin's own, which lists only an HLS stream's renditions, through a slot that
`patches/@videojs__react.patch` adds (`SettingsMenuSlot`).

A line under the player says how it plays:

- "Direct play";
- "Direct stream", with "· converting the audio" when only the audio is converted;
- "Transcoding to 720p · NVIDIA GPU", with the reason when it is not your pick ("this browser
  can't play VP9").

## Sessions

`POST {playbackUrl}` takes `{quality, start, copyVideo, copyAudio}`. The page sets `copyVideo` and
`copyAudio` by asking whether this browser decodes the file's codecs from fragmented MP4: MSE's
`isTypeSupported`, or `canPlayType` where it plays HLS natively. The server plans the session from
the stored rendition (`src/transcode/sessionPlan.ts`):

- **remux** when the quality is Original, the browser decodes the video, and fragmented MP4 carries
  it (H.264, HEVC, VP9 or AV1). The video is copied (an MKV becomes fMP4 untouched), and so is the
  audio when the browser plays it; otherwise the audio becomes AAC stereo 160 kb/s.
- **encode** otherwise: H.264 High at the rung, or at the source's size up to 1080 lines for
  Original, with the rung's cap and the H.264 level that carries that size at 60 fps. The same
  level goes into the playlist's CODECS.
- **audio** for an audio file.

Each session is one viewer's (`playback_sessions`): a signed-in person, or a public link's code. A
person's new session of an entry stops their earlier one. A link plays on at most 3 screens at
once (429 beyond), since nobody is signed in to tell its viewers apart. Every request checks that
the viewer may still see the entry (`visibleEntry`), so a share or link that ends ends its sessions
at once; turning a link off also deletes them.

The session's routes live under `{playbackUrl}/sessions/{sid}`:

- `GET` reports the session's state (`queued`, `starting`, `running`, `stopped` or `failed`), its
  encoder and why it was made. Asking keeps it alive. `DELETE` stops it.
- `master.m3u8` is a one-variant multivariant playlist (the codecs and the size), which Video.js's
  HLS engine needs. It names no audio codec for a silent video.
- `index.m3u8` is the **whole video as a VOD playlist, ended, from the first request**:
  - an encode cuts every 6 s, forcing keyframes there;
  - a remux cuts at the first keyframe at or after each 6 s mark, from the rendition's keyframe
    index (`rendition_keyframes`, read from the packets by the fetch consumer, or by the first
    session of a rendition stored before);
  - a last piece under a second joins the segment before it.
- `init.mp4` and `seg-N.m4s`. A segment already stored streams from the MediaStore, cached for good
  under the session's own URL. One not made yet holds the request, as described in
  [How a segment gets made](#how-a-segment-gets-made).

The player's timeline is therefore the source's own: resume, chapters, subtitles and progress work
as in direct play, and a seek goes anywhere at once.

The page keeps a session alive by pinging it every 20 s, in a background tab too. A session that
was stopped or lost is started again at the current position, once. Leaving the page stops it (a
`keepalive` fetch on `pagehide`).

## How a segment gets made

Segment requests can land on any replica. The session's **runner** is one BullMQ job
(`playback|<id>`) on the `playback` queue, taken by any replica whose
`UROBOROS_TRANSCODE_CONCURRENCY` is above 0, so only GPU replicas need to transcode. The replicas
talk over Valkey:

- a request publishes `want N` on the playback bus;
- the runner publishes `ready N` once segment N is stored, and sets its bit in the session's stored
  map;
- a request waits for that, looking again every 2 s, for up to 45 s, then answers 503 (the page
  starts again).

The runner (`src/worker/session.ts`, `sessionLoop.ts`):

1. **Reads the source in place.** That is the file's path on the filesystem store, or a 6-hour
   presigned URL on S3's own endpoint, which ffmpeg reads with range requests and reconnects. The
   file is never copied to scratch.
2. **Runs jellyfin-ffmpeg from the segment that holds the viewer's position.**
   - It writes fragmented MP4 to stdout on the source's timeline (`-copyts`).
   - A later run starts at its boundary, and its audio comes from a second input 0.25 s earlier.
     Otherwise the audio of the segment before would stop a few frames short and the browser
     would stall on the gap; the overlap is simply replaced.
   - The runner reads the fragments as they come and puts each into the segment that its
     presentation time falls in, so segments land exactly on the playlist's boundaries whatever
     the encoder does.
   - It stores each segment once the next begins, after checking that it still holds the
     session's run token, so a stalled runner never overwrites a new one's files.
3. **Restarts when the player asks for a segment far from the run.** That is a segment behind the
   run's start, or more than 4 past what it has made. The runner waits 250 ms first, so a scrub
   settles.
4. **Pauses when it is 20 segments ahead of the player** (it stops reading, and ffmpeg blocks), and
   reads on once the player is within 10.
5. **Skips work already done.** A run that reaches 5 segments already stored in a row jumps past
   them. Once the end is made, the runner idles until a segment no run made is asked for.
6. **Ends** when the viewer goes (no request or ping for 60 s), when the session is stopped, or
   when it fails. On the way out it records how it ended, tells waiting requests, and deletes the
   session's folder and keys. A replica shutting down puts the session back in the queue without
   spending an attempt.

Every minute the leader (`src/transcode/sessionDuties.ts`) looks after sessions:

- A live session whose run is gone (a replica that died, a flushed Valkey) gets it back while its
  viewer is there. Once the viewer is gone too, it is stopped and its folder trashed.
- Ended sessions are forgotten after an hour.
- A trigger on the table trashes a session's folder whenever its row goes, so nothing is left
  behind. That includes a row deleted with its entry, rendition or link.

The folders are `.transcodes/<id>/` at the store's root, a dot folder out of the organized folders
that media servers read.

## CPU or GPU

The transcoder is jellyfin-ffmpeg, from Jellyfin's Debian package (THIRD_PARTY.md), at
`/usr/lib/jellyfin-ffmpeg/`. It brings the NVENC and VA-API encoders, the GPU scalers and tone
mappers, and its own Mesa and Intel VA-API drivers. yt-dlp's ffmpeg stays for downloads.

Each replica's `UROBOROS_TRANSCODE_HWACCEL` names its GPU, and each choice gives a chain of
pipelines (`packages/ytdlp/src/ffmpegVideo.ts`):

- **`none`**: the CPU, libx264 `veryfast` at CRF 23 under the rung's cap.
- **`nvenc`** (NVIDIA):
  1. decode, scale and tone-map on the GPU (`scale_cuda`, `tonemap_cuda`), encode with
     `h264_nvenc`;
  2. decode on the CPU and upload, encode on the GPU;
  3. the CPU.
- **`vaapi`** (AMD; Intel untested), on `UROBOROS_TRANSCODE_VAAPI_DEVICE`:
  1. decode and scale on the GPU (`scale_vaapi`), tone-map on the CPU between a download and an
     upload, encode with `h264_vaapi`;
  2. decode on the CPU and upload, encode on the GPU;
  3. the CPU.

A replica that runs sessions tries its GPU at start with a second of generated video. A GPU that
can't encode is logged, and every run on that replica uses the CPU.

A pipeline that fails before writing anything moves to the next one in the chain. The replica
remembers the failure for that kind of source (codec and pixel format); for example, no GPU decodes
10-bit H.264. A run that fails after writing is retried twice from the next segment it didn't make,
and then the session fails with ffmpeg's own reason (the stderr line that isn't a generic closing
line).

An HDR source (PQ or HLG) is tone-mapped to BT.709 after scaling. The encoder a session ended up on
shows in its state and on the status line.

Giving a replica a GPU in compose:

- `compose/gpu/nvidia.yaml` passes the NVIDIA GPU through the Container Device Interface
  (`nvidia-ctk cdi generate`).
- `compose/gpu/vaapi.yaml` passes the render node and the host's `render` group
  (`UROBOROS_RENDER_GID`).

Safari's native HLS, and VA-API on Intel, are built to spec but untested.

## Configuration

| Variable                          | Default               | Meaning                                                  |
| --------------------------------- | --------------------- | -------------------------------------------------------- |
| `UROBOROS_TRANSCODE_CONCURRENCY`  | `2`                   | Sessions this replica runs at once; `0` runs none here   |
| `UROBOROS_TRANSCODE_HWACCEL`      | `none`                | This replica's GPU: `none` (the CPU), `nvenc` or `vaapi` |
| `UROBOROS_TRANSCODE_VAAPI_DEVICE` | `/dev/dri/renderD128` | The VA-API render node                                   |

A paused viewer's session holds its slot while their tab is open, but its run is paused, so it
costs nothing.

## Not yet

Not built yet:

- converting a stored file to another format profile (re-download with that profile);
- adaptive bitrate (one variant per session; the viewer picks the rung);
- burned-in subtitles;
- an admin view of running sessions.
