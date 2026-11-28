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
| curl_cffi (in yt-dlp's venv)   | MIT, with its bundled libraries' own                  | `/usr/share/licenses/curl_cffi/`, see below                                              |
| ffmpeg and ffprobe             | GNU GPL version 3                                     | yt-dlp's FFmpeg build, see below                                                         |
| jellyfin-ffmpeg (transcoding)  | GNU GPL version 3, with its bundled libraries' own    | Jellyfin's Debian package, see below                                                     |
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

### curl_cffi

yt-dlp impersonates a browser (which YouTube's subtitles need) through curl_cffi
(https://github.com/lexiforest/curl_cffi, MIT), pinned with the rest of yt-dlp's venv in
`scripts/image/requirements.txt`. Its one native module is statically linked against
curl-impersonate's libcurl (curl licence), BoringSSL (Apache-2.0), nghttp2, nghttp3 and ngtcp2
(MIT), Brotli (MIT), Zstandard (BSD-3-Clause) and zlib (zlib licence), but its wheel ships only
curl_cffi's own licence. The image carries every one of those licence texts, and a `SOURCE.md`
naming each project and version, at `/usr/share/licenses/curl_cffi/` (from
`scripts/image/licenses/curl_cffi/`). The other Python packages in the venv keep their licences in
their `*.dist-info` folders under `/opt/yt-dlp`.

### ffmpeg

`/usr/local/bin/ffmpeg` and `/usr/local/bin/ffprobe` are yt-dlp's static, patched GPL build from
https://github.com/yt-dlp/FFmpeg-Builds, copied unmodified from a mirror image published from the
`apps/ffmpeg-ytdlp` directory of the upstream-builder repository and published publicly as
`ghcr.io/aaldebs99/ffmpeg-ytdlp` (the forge's registry holds the same build). The Dockerfile pins
that image by tag and digest in its `ffmpeg` stage. The build links its libraries statically except the C library and
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
`/usr/src/ffmpeg-ytdlp/` inside the pinned mirror image, which is published beside the Uroboros
image, on the forge's registry and publicly on GHCR; the image does not copy it. That directory holds the FFmpeg source,
the build scripts, the source each library stage downloads, the build recipe and a manifest of
checksums. Both registries the release pushes the Uroboros image to carry the pinned mirror image as well,
and anyone can pull it from GHCR without logging in. Distributing the Uroboros image anywhere else
means making that source available alongside it on the same terms, for instance by distributing
the pinned mirror image too.

### jellyfin-ffmpeg

Playback sessions (docs/transcoding.md) transcode with jellyfin-ffmpeg
(https://github.com/jellyfin/jellyfin-ffmpeg): FFmpeg with Jellyfin's patches, built as a GPL
version 3 build, and the libraries and VA-API drivers it bundles (among them Mesa's radeonsi and
Intel's iHD drivers, dav1d, SVT-AV1 and libass) under `/usr/lib/jellyfin-ffmpeg/`. The image
installs Jellyfin's `jellyfin-ffmpeg8` Debian 13 package from the project's GitHub release, pinned
in the Dockerfile by release tag and the package's sha256; apt adds the Debian libraries it depends
on, each with its own copyright file. It is not on PATH: `ffmpeg` stays yt-dlp's build above.

The image contains the package's Debian copyright file, which lists the licence of every part, at
`/usr/share/doc/jellyfin-ffmpeg8/copyright`, and `/usr/share/licenses/jellyfin-ffmpeg/SOURCE.md`,
which names the release.

Corresponding source: the release's tag in the jellyfin-ffmpeg repository holds the FFmpeg source
with Jellyfin's patches and the build scripts, which fetch each bundled library's pinned source.
The image does not carry that source. Distributing the image means making it available alongside
on the same terms, for instance by mirroring that tag and the library sources it names.
