# Third-party software in the image

Uroboros itself is MIT licensed (see [LICENSE](LICENSE)). The container image also carries other
software under its own licences. This file lists what it ships; the licence texts are the
authority. The Dockerfile has the exact pins.

## The image (`uroboros`)

Built `FROM node:<version>-trixie-slim` (Debian 13).

| Component                      | Licence                                               | Source                                                                                   |
| ------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Node.js                        | MIT, with the licences of its bundled dependencies    | The official `node` image, https://github.com/nodejs/node                                |
| Debian base                    | Debian packages, each under its own licence           | Copyright files under `/usr/share/doc/<package>/`; sources at https://sources.debian.org |
| Python 3 and its venv module   | Python Software Foundation License                    | Debian's `python3` packages                                                              |
| yt-dlp (`/opt/yt-dlp`)         | Unlicense (public domain)                             | https://github.com/yt-dlp/yt-dlp, pinned in `scripts/image/requirements.txt`             |
| ffmpeg and ffprobe             | GNU GPL version 3                                     | yt-dlp's FFmpeg build, see below                                                         |
| tini (PID 1)                   | MIT                                                   | Debian's `tini` package; copyright under `/usr/share/doc/tini/`                          |
| The server bundle (`/app`)     | MIT (Uroboros), plus the bundled npm dependencies     | `/usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt`, see below                        |
| The web app (`/app/web`)       | MIT (Uroboros), plus React and the other npm packages | `/usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt`                                   |
| Fonts in the web app           | SIL Open Font License 1.1 (Roboto)                    | `@fontsource-variable/roboto`; OFL text in `THIRD_PARTY_NOTICES.txt`                     |
| Swagger UI (`/app/swagger-ui`) | Apache-2.0, served at `/api/docs`                     | `swagger-ui-dist`; its `LICENSE` and `NOTICE` ship beside it                             |

yt-dlp is the only downloader the image ships.

## npm packages

The image build runs `pnpm licenses list --prod` over the server, the web app and the contract,
and `apps/server/src/notices/notices.ts` turns the result into
`/usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt`: every production npm package the bundles
and the web app carry, with its version, licence and the licence and notice files its package
ships (the fonts' OFL text among them). Uroboros' own licence is beside it as `LICENSE`.
`check:licenses` keeps every one of those licences on the allowlist.

### ffmpeg

`/usr/local/bin/ffmpeg` and `/usr/local/bin/ffprobe` are yt-dlp's static, patched GPL build from
https://github.com/yt-dlp/FFmpeg-Builds, copied unmodified from a mirror image published from the
`apps/ffmpeg-ytdlp` directory of the upstream-builder repository
(`code.example.com/aaldebs99/ffmpeg-ytdlp`). The Dockerfile pins that image by tag and index
digest in its `ffmpeg` stage. The build links its libraries statically except the C library and
libgcc_s, which the image's Debian base provides; run `ffmpeg -version` in the image to see the
configuration.

The image contains, under `/usr/share/licenses/ffmpeg/`, what the mirror image holds there:

- `LICENSE`: the licence text shipped in the build archive (GNU GPL version 3).
- `SOURCE.md`: the version, the upstream release, the build scripts commit, the FFmpeg commit, the
  archive checksums and the runtime requirements.
- `NOTICES.md`: the linked libraries, their licences and where their texts are.
- `libs/`: the licence files of those libraries.

The image is therefore linux/amd64 only: the mirror carries yt-dlp's linux64 build and no arm64 one.

Corresponding source: the complete corresponding source of the binaries is at
`/usr/src/ffmpeg-ytdlp/` inside the pinned mirror image, which lives in the same private registry
as the Uroboros image; the image does not copy it. That directory holds the FFmpeg source,
the build scripts, the source each library stage downloads, the build recipe and a manifest of
checksums. Distributing the Uroboros image outside that registry means making that source
available alongside it on the same terms, for instance by distributing the pinned mirror image
too. Building the image needs a login to the registry (`docker login code.example.com`).

### Future: transcoding

Transcoding, when it exists, will use jellyfin-ffmpeg (https://github.com/jellyfin/jellyfin-ffmpeg,
GPL) instead of this build. This file will list it when the image does.
