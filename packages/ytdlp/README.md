# @uroboros/ytdlp

The typed wrapper the server's job consumers use to run yt-dlp and ffprobe. Request handlers never
spawn either program. The one exception is the subpath `@uroboros/ytdlp/flags`, the pure argument
allowlist (`normalizeExtraArgs`), which the api uses to check a format profile's extra arguments
when an admin saves it. `@uroboros/ytdlp/testing` exports the fake binary's helpers for other
packages' tests. yt-dlp is the only downloader, with no setting and no fallback.

| Export     | What it does                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe`    | `yt-dlp --dump-single-json` (`flat: true` adds `--flat-playlist`). Returns a `VideoInfo` or a `PlaylistInfo` whose `kind` is `video`, `playlist` or `channel`.                                 |
| `download` | Downloads into an absolute `workDir` with a format selector and output template, reports `ProgressEvent`s through `onProgress`, and resolves with each final file and its parsed `.info.json`. |
| `ffprobe`  | A file's container, duration and typed streams.                                                                                                                                                |

Every call takes `binary` (the server passes `YTDLP_PATH`; this package reads no environment
itself), `jsRuntime` (an absolute path to Node, passed as `--js-runtimes node:<path>` so yt-dlp
solves sites' JavaScript challenges with the yt-dlp-ejs scripts; the server passes its own Node), `extraArgs`, `cookiesFile`, `timeoutMs`, `signal`, `env`, `killGraceMs` and
`stderrTailLines`. Every failure is a `YtDlpError` with a closed `kind` (`YTDLP_ERROR_KINDS`) and
`stderrTail`, the last stderr lines with signed URLs, cookies and credentials redacted.

## Behaviour worth knowing

Programs run without a shell, with the URL last behind `--`, and only http(s) URLs are accepted.
Every run passes `--ignore-config --no-update --color never`.

`extraArgs` goes through an allowlist (`ALLOWED_FLAGS`, defined in `src/flags.ts`), not a
block-list. yt-dlp expands shortened long options (`--exe` means `--exec`) and unbundles short
ones (`-ia FILE`), and many of its options run programs or reach files, so no block-list can be
complete. `normalizeExtraArgs` matches each token exactly: `--name`, `--name=value`,
`--name value`, or one of a few whole short spellings such as `-x`. It checks each value against
that flag's pattern and re-emits everything as `--name` or `--name=value`, so yt-dlp only ever
sees spellings the wrapper wrote. Anything else fails as `invalid_arguments` before anything
spawns, including a bare `--` or a positional argument. The basic set covers rate limits,
retries and sleeps, playlist selection and filters, format sorting and remuxing, audio
extraction, subtitles, thumbnails, metadata, chapters, SponsorBlock and filename sanitising. To
allow another flag, add a row to the table. Never add one that takes a path, a URL, a binary, or
arguments for another program (`--exec`, `-o`, `--cookies`, `--downloader`, `--ffmpeg-location`,
`--postprocessor-args`, `--proxy` and the like).

yt-dlp rewrites its cookie jar on exit, so it gets a private copy of `cookiesFile` (removed
afterwards) and a read-only Secret mount is never written.

Each run leads its own process group. A cancel or timeout sends the group SIGTERM, then SIGKILL
after `killGraceMs` (5 s by default), so yt-dlp's ffmpeg children go too, and a stopped download
removes its `.part`, `.part-FragN`, `.ytdl` and `.temp` files from `workDir`.

Progress comes from `--progress-template` lines behind a `[uroboros]` marker. Download progress
goes to stdout and postprocessor progress (`merging` for the `Merger`, `postprocessing` for the
rest) to stderr, so both streams are scanned, and a line split across reads is held until it
completes. The finished files come from `--print after_move:`.

Validation is lenient: unknown fields are stripped, a field that is missing or has the wrong type
becomes null, and a malformed list item is dropped. Only `id` is required, so a yt-dlp release
that adds or retypes fields does not break a job.

## Tests

No test touches the network. `fixtures/fakeBin.ts` is a node executable that stands in for yt-dlp
and ffprobe and replays a scenario: output written in arbitrary chunks, files, an exit code, a
child process in its group, or ignoring SIGTERM. The JSON fixtures are real output, recorded once
with yt-dlp 2026.08.19: the CC-BY Blender videos `aqz-KE-bpKQ`, a Blender playlist and the Blender
channel's videos tab (formats and thumbnails trimmed, signed media URLs and the recording client's
IP scrubbed), an unavailable video, and a download and ffprobe of a clip generated with ffmpeg and
served from localhost. `probe-channel-root.json` (a channel's main URL listing its Videos, Shorts and Live tabs) is
hand-built in the shape yt-dlp gives, not recorded: like the real thing, its `id` is the handle
(`@BlenderOfficial`) and only `channel_id` is the channel's id.
