#!/usr/bin/env bash
# Installs the transcoder, jellyfin-ffmpeg (docs/transcoding.md), from the .deb the Dockerfile's
# jellyfin-ffmpeg stage fetched and checked against its pinned sha256. apt resolves its Debian
# dependencies; the package keeps its own libraries and VA-API drivers under
# /usr/lib/jellyfin-ffmpeg/ and puts nothing on PATH, so `ffmpeg` stays yt-dlp's build. Its
# copyright file stays at /usr/share/doc/jellyfin-ffmpeg8/copyright (Debian's slim images keep
# copyright files); SOURCE.md beside the other licences says where the source is (THIRD_PARTY.md).
#
# Usage: install-jellyfin-ffmpeg.sh <deb> <release tag, e.g. v8.1.3-2>
set -euo pipefail

DEB="${1:?Usage: install-jellyfin-ffmpeg.sh <deb> <version>}"
VERSION="${2:?Usage: install-jellyfin-ffmpeg.sh <deb> <version>}"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${DEB}"
rm -rf /var/lib/apt/lists/*

install -d /usr/share/licenses/jellyfin-ffmpeg
cat > /usr/share/licenses/jellyfin-ffmpeg/SOURCE.md <<NOTE
# jellyfin-ffmpeg ${VERSION}

- Package: jellyfin-ffmpeg8 ${VERSION#v} (Debian 13 "trixie", amd64), from
  https://github.com/jellyfin/jellyfin-ffmpeg/releases/tag/${VERSION}
- Licence: GNU GPL version 3 (built with --enable-gpl --enable-version3); the package's copyright
  file is /usr/share/doc/jellyfin-ffmpeg8/copyright.
- Source: https://github.com/jellyfin/jellyfin-ffmpeg/tree/${VERSION} (FFmpeg with Jellyfin's
  patches and the build scripts that fetch each bundled library's pinned source).
NOTE
