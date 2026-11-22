#!/usr/bin/env bash
# Installs yt-dlp's patched static ffmpeg and ffprobe (the GPL linux build from
# https://github.com/yt-dlp/FFmpeg-Builds) into /usr/local/bin, with the licence text and a
# SOURCE.md pointing at the corresponding source in /usr/share/licenses/ffmpeg.
#
# The release tag and the sha256 of its checksums.sha256 asset are pinned in the Dockerfile. The
# checksums file is checked against that pin, and the archive against the checksums file, so the
# one pinned digest covers both architectures. The commit the tag points at is pinned too and
# recorded in SOURCE.md. Needs curl and xz-utils.
set -euo pipefail

USAGE="Usage: install-ffmpeg.sh <release-tag> <checksums-sha256> <tag-commit>"
TAG="${1:?${USAGE}}"
CHECKSUMS_SHA256="${2:?${USAGE}}"
TAG_COMMIT="${3:?${USAGE}}"

ARCH="$(dpkg --print-architecture)"
case "${ARCH}" in
    amd64) PLATFORM="linux64" ;;
    arm64) PLATFORM="linuxarm64" ;;
    *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;;
esac

REPO="https://github.com/yt-dlp/FFmpeg-Builds"
BASE="${REPO}/releases/download/${TAG}"
LICENSE_DIR="/usr/share/licenses/ffmpeg"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

curl --proto '=https' --proto-redir '=https' -fsSL "${BASE}/checksums.sha256" -o "${TMP}/checksums.sha256"
echo "${CHECKSUMS_SHA256}  ${TMP}/checksums.sha256" | sha256sum -c

# The asset names carry the ffmpeg version (ffmpeg-N-<count>-g<commit>-<platform>-gpl.tar.xz), so
# read them from the verified checksums file rather than pinning them a second time.
asset_line() {
    grep -E "  ffmpeg-.*-${1}-gpl\.tar\.xz\$" "${TMP}/checksums.sha256"
}
LINE="$(asset_line "${PLATFORM}")"
ASSET="${LINE#*  }"
STAGE="${ASSET%.tar.xz}"
VERSION="${STAGE#ffmpeg-}"
VERSION="${VERSION%-"${PLATFORM}"-gpl}"
COMMIT="${VERSION##*-g}"
# The release builds are stamped with the tag's date: `ffmpeg -version` prints N-<count>-g<hash>-YYYYMMDD.
DATE="$(echo "${TAG}" | sed -n 's/^autobuild-\([0-9]*\)-\([0-9]*\)-\([0-9]*\)-.*$/\1\2\3/p')"
REPORTED="${VERSION}-${DATE}"

curl --proto '=https' --proto-redir '=https' -fsSL "${BASE}/${ASSET}" -o "${TMP}/${ASSET}"
(cd "${TMP}" && echo "${LINE}" | sha256sum -c)
tar -xJf "${TMP}/${ASSET}" -C "${TMP}" --strip-components=1 \
    "${STAGE}/bin/ffmpeg" "${STAGE}/bin/ffprobe" "${STAGE}/LICENSE.txt"

install -m 755 "${TMP}/bin/ffmpeg" "${TMP}/bin/ffprobe" /usr/local/bin/
install -d -m 755 "${LICENSE_DIR}"
install -m 644 "${TMP}/LICENSE.txt" "${LICENSE_DIR}/LICENSE.txt"

ARCHIVES=""
while read -r SUM NAME; do
    ARCHIVES+="    - \`${NAME}\`, sha256 \`${SUM}\`"$'\n'
done < <(grep -E "  ffmpeg-.*-(linux64|linuxarm64)-gpl\.tar\.xz\$" "${TMP}/checksums.sha256")
ARCHIVES="${ARCHIVES%$'\n'}"
if [ -z "${ARCHIVES}" ]; then
    echo "No linux archives listed in checksums.sha256" >&2
    exit 1
fi

cat > "${LICENSE_DIR}/SOURCE.md" << MD
# ffmpeg in this image

\`ffmpeg\` and \`ffprobe\` in /usr/local/bin are yt-dlp's static GPL build of FFmpeg, unmodified.
The licence of FFmpeg and of this GPL build is in LICENSE.txt beside this file (GNU General Public
License, version 3). The binaries statically link many other libraries under their own licences;
those notices are not included here (see THIRD_PARTY.md in the Uroboros repository).

- Version: ${REPORTED}
- FFmpeg commit: https://github.com/FFmpeg/FFmpeg/commit/${COMMIT}
- Release: ${REPO}/releases/tag/${TAG}
- Tag: ${TAG}
- Build scripts commit the tag points at: ${REPO}/tree/${TAG_COMMIT} (${TAG_COMMIT})
- Archives installed from ${BASE}/:
${ARCHIVES}
- Checksums file: \`checksums.sha256\` in the same release, sha256 \`${CHECKSUMS_SHA256}\`

The build scripts (scripts.d/ and patches/ in the repository at that commit) clone FFmpeg's master
branch and fetch each library by the references they list; they are the build recipe and source
references, not a copy of the source. A durable mirror of the full corresponding source is being
added.

Built for ${ARCH} from \`${ASSET}\`.
MD
