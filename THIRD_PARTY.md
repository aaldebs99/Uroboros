# Third-party software in the images

Uroboros itself is MIT licensed (see [LICENSE](LICENSE)). The container images also carry other
software under its own licences. This file lists what each image ships; the licence texts are the
authority. The Dockerfile has the exact pins.

## api image (`uroboros-api`)

Built `FROM gcr.io/distroless/cc-debian13:nonroot`, with the Node binary copied in.

| Component                      | Licence                                                 | Source                                                            |
| ------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------- |
| Node.js (the `node` binary)    | MIT, with the licences of its bundled dependencies      | The official `node` image, https://github.com/nodejs/node         |
| distroless base (cc-debian13)  | Debian packages, each under its own licence             | https://github.com/GoogleContainerTools/distroless                |
| Debian packages in the base    | glibc, libstdc++ and libgcc (LGPL, GPL with exceptions) | Copyright files under `/usr/share/doc/<package>/` in the image    |
| The server bundle (`/app`)     | MIT (Uroboros), plus the bundled npm dependencies       | `/usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt`, see below |
| The web app (`/app/web`)       | MIT (Uroboros), plus React and the other npm packages   | `/usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt`            |
| Fonts in the web app           | SIL Open Font License 1.1 (Bricolage Grotesque, Geist)  | `@fontsource-variable/*`; OFL text in `THIRD_PARTY_NOTICES.txt`   |
| Swagger UI (`/app/swagger-ui`) | Apache-2.0, served at `/api/docs`                       | `swagger-ui-dist`; its `LICENSE` and `NOTICE` ship beside it      |

## worker image (`uroboros-worker`)

Built `FROM node:<version>-trixie-slim` (Debian 13).

| Component                    | Licence                                            | Source                                                                                   |
| ---------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Node.js                      | MIT, with the licences of its bundled dependencies | The official `node` image, https://github.com/nodejs/node                                |
| Debian base                  | Debian packages, each under its own licence        | Copyright files under `/usr/share/doc/<package>/`; sources at https://sources.debian.org |
| Python 3 and its venv module | Python Software Foundation License                 | Debian's `python3` packages                                                              |
| yt-dlp (`/opt/yt-dlp`)       | Unlicense (public domain)                          | https://github.com/yt-dlp/yt-dlp, pinned in `scripts/image/requirements.txt`             |
| ffmpeg and ffprobe           | GNU GPL version 3                                  | yt-dlp's FFmpeg build, see below                                                         |
| The server bundle (`/app`)   | MIT (Uroboros), plus the bundled npm dependencies  | `/usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt`, see below                        |
| tini (PID 1)                 | MIT                                                | Debian's `tini` package; copyright under `/usr/share/doc/tini/`                          |

yt-dlp is the only downloader the images ship.

## npm packages in both images

The image build runs `pnpm licenses list --prod` over the server, the web app and the contract,
and `apps/server/src/notices/notices.ts` turns the result into
`/usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt`: every production npm package the bundles
and the web app carry, with its version, licence and the licence and notice files its package
ships (the fonts' OFL text among them). Uroboros' own licence is beside it as `LICENSE`. Both
images carry the same file; `check:licenses` keeps every one of those licences on the allowlist.

### ffmpeg

`/usr/local/bin/ffmpeg` and `/usr/local/bin/ffprobe` are yt-dlp's static, patched GPL build from
https://github.com/yt-dlp/FFmpeg-Builds, installed unmodified from a release archive whose sha256
is checked against a pin in the Dockerfile (`FFMPEG_TAG`, `FFMPEG_CHECKSUMS_SHA256`) by
`scripts/image/install-ffmpeg.sh`. It statically links the libraries its configuration lists; run
`ffmpeg -version` in the image to see the configuration.

The worker image contains, under `/usr/share/licenses/ffmpeg/`:

- `LICENSE.txt`: the licence text shipped in the build archive (GNU GPL version 3).
- `SOURCE.md`: the version, the release URL and tag, the commit of the build scripts the tag points
  at, the FFmpeg commit, and the archive names and checksums.

The archive is checked against a pinned checksums file, which is itself checked against a sha256
pinned in the Dockerfile. The build scripts and patches in the FFmpeg-Builds repository at that
commit are the build recipe and source references: they clone FFmpeg's master branch, and only
the libraries carry a pinned commit. They are not a copy of the source. A durable mirror of the
full corresponding source is being added, as an ffmpeg image built in a separate repository.

Known gap: only FFmpeg's GPL text is shipped. The static binary also links many libraries under
other licences (BSD, MIT and others), and their notices are not yet included. The mirror image is
to cover them.

### Future: transcode workers

Transcode workers, when they exist, will use jellyfin-ffmpeg (https://github.com/jellyfin/jellyfin-ffmpeg,
GPL) instead of this build. This file will list it when that image does.
