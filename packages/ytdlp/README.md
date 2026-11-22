# @uroboros/ytdlp

The typed wrapper the workers use to run yt-dlp and ffprobe. Only workers import it: the api never
spawns either program. yt-dlp is the only downloader, with no setting and no fallback.

| Export     | What it does                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe`    | `yt-dlp --dump-single-json` (`flat: true` adds `--flat-playlist`). Returns a `VideoInfo` or a `PlaylistInfo` whose `kind` is `video`, `playlist` or `channel`.                                 |
| `download` | Downloads into an absolute `workDir` with a format selector and output template, reports `ProgressEvent`s through `onProgress`, and resolves with each final file and its parsed `.info.json`. |
| `ffprobe`  | A file's container, duration and typed streams.                                                                                                                                                |

Every call takes `binary` (the worker passes `YTDLP_PATH`; this package reads no environment
itself), `extraArgs`, `cookiesFile`, `timeoutMs`, `signal`, `env`, `killGraceMs` and
`stderrTailLines`. Every failure is a `YtDlpError` with a closed `kind` (`YTDLP_ERROR_KINDS`) and
`stderrTail`, the last stderr lines with signed URLs, cookies and credentials redacted.

## Behaviour worth knowing

Programs run without a shell, with the URL last behind `--`, and only http(s) URLs are accepted.
`extraArgs` refuses the options that run commands or load arguments from elsewhere (`--exec*`,
`--batch-file`, `--config-location`, `--netrc-cmd`, `--update`, `--plugin-dirs`,
`--cookies-from-browser` and so on). Every run passes `--ignore-config --no-update --color never`.

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
served from localhost.
