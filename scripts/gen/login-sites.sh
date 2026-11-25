#!/bin/sh
# Writes packages/contract/src/generated/loginSites.ts from the yt-dlp pinned in an image (default
# uroboros:local; build it first with `mise run docker:build`): see login-sites.py.
#
# Usage: login-sites.sh [image] [--print]
#   --print writes to stdout instead of the file (the smoke test compares it with the commit).
set -eu
IMAGE="${1:-uroboros:local}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
OUT="${ROOT}/packages/contract/src/generated/loginSites.ts"
# The script goes in on stdin rather than as a bind mount: where the Docker daemon is a sidecar (the
# forge's *-dind runners), a mounted path is looked up on the daemon's side, which hasn't the file.
run() {
    docker run --rm -i --network none --entrypoint /opt/yt-dlp/bin/python3 "${IMAGE}" -I - \
        < "${HERE}/login-sites.py"
}
if [ "${2:-}" = "--print" ]; then
    run
else
    mkdir -p "$(dirname "${OUT}")"
    run > "${OUT}.tmp"
    mv "${OUT}.tmp" "${OUT}"
    echo "wrote ${OUT}"
fi
