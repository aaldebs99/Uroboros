#!/usr/bin/env bash
# Installs yt-dlp's patched static ffmpeg and ffprobe (the GPL linux build from
# https://github.com/yt-dlp/FFmpeg-Builds) into /usr/local/bin, with the licence text and a
# SOURCE.md pointing at the corresponding source in /usr/share/licenses/ffmpeg.
#
# The release tag and the sha256 of its checksums.sha256 asset are pinned in the Dockerfile. The
# checksums file is checked against that pin, and the archive against the checksums file, so the
# one pinned digest covers both architectures. Needs curl and xz-utils.
set -euo pipefail

TAG="${1:?Usage: install-ffmpeg.sh <release-tag> <checksums-sha256>}"
CHECKSUMS_SHA256="${2:?Usage: install-ffmpeg.sh <release-tag> <checksums-sha256>}"

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

curl -fsSL "${BASE}/checksums.sha256" -o "${TMP}/checksums.sha256"
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

curl -fsSL "${BASE}/${ASSET}" -o "${TMP}/${ASSET}"
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

cat > "${LICENSE_DIR}/SOURCE.md" << MD
# ffmpeg in this image

\`ffmpeg\` and \`ffprobe\` in /usr/local/bin are yt-dlp's static GPL build of FFmpeg
(${VERSION}, FFmpeg git commit ${COMMIT}), unmodified. The licence is in LICENSE.txt beside
this file (GNU General Public License, version 3).

Corresponding source: the build scripts and patches that produced the binaries, and the pinned
versions of FFmpeg and every library linked into them, are in the release's git tag.

- Release: ${REPO}/releases/tag/${TAG}
- Tag: ${TAG}
- Build scripts and patches at that tag: ${REPO}/tree/${TAG}
- FFmpeg source commit: https://github.com/FFmpeg/FFmpeg/commit/${COMMIT}
- Archives installed from ${BASE}/:
${ARCHIVES}
- Checksums file: \`checksums.sha256\` in the same release, sha256 \`${CHECKSUMS_SHA256}\`

Built for ${ARCH} from \`${ASSET}\`.
MD
