#!/usr/bin/env bash
# Prints the `image:` of a service in compose.yaml, the one place the third-party images
# (Postgres, RustFS, Caddy) are pinned by exact tag and digest; Renovate's docker-compose
# manager keeps them current. CI and smoke-test.sh read them through this, the test setup through
# apps/server/test/composeImage.ts.
#
# Usage: compose-image.sh <service>
set -euo pipefail

SERVICE="${1:?Usage: compose-image.sh <service>}"
COMPOSE="$(dirname "$0")/../../compose.yaml"

image="$(awk -v svc="  ${SERVICE}:" '
    $0 == svc { inside = 1; next }
    inside && /^  [^ ]/ { exit }
    inside && $1 == "image:" { print $2; exit }
' "${COMPOSE}")"
if [ -z "${image}" ]; then
    echo "compose.yaml has no image for a service named ${SERVICE}" >&2
    exit 1
fi
echo "${image}"
