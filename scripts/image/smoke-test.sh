#!/usr/bin/env bash
# Smoke test for the built images, against throwaway Postgres and Valkey containers:
#
#   api     runs as 65532:65532, migrate applies the migrations and exits 0, the api starts and
#           reports {"status":"ok","failing":[]} on /api/health, serves its OpenAPI document and
#           falls back to the SPA's index.html on a deep link.
#   worker  runs as uid 65532, `yt-dlp --version` and `ffmpeg -version` answer, no other
#           downloader is installed, and the worker process starts, logs both tool versions and
#           its "worker started" line.
#
# Usage: smoke-test.sh <api-image> <worker-image>
set -euo pipefail

API_IMAGE="${1:?Usage: smoke-test.sh <api-image> <worker-image>}"
WORKER_IMAGE="${2:?Usage: smoke-test.sh <api-image> <worker-image>}"

# Version tags are pinned like the compose file's; keep them in step with it.
POSTGRES_IMAGE="postgres:18-alpine"
VALKEY_IMAGE="valkey/valkey:8-alpine"

# The Node the images must run: the Dockerfile's pin, which `mise run ratchet:pins` ties to mise.
NODE_VERSION="$(sed -n 's/^ARG NODE_VERSION=//p' "$(dirname "$0")/../../Dockerfile")"

SUFFIX="$$"
NETWORK="uroboros-smoke-${SUFFIX}"
PG="uroboros-smoke-pg-${SUFFIX}"
VK="uroboros-smoke-vk-${SUFFIX}"
API="uroboros-smoke-api-${SUFFIX}"
WORKER="uroboros-smoke-worker-${SUFFIX}"
DATABASE_URL="postgres://uroboros:uroboros@${PG}:5432/uroboros"
VALKEY_URL="redis://${VK}:6379"
FAILED=0

cleanup() {
    docker rm -f "${API}" "${WORKER}" "${PG}" "${VK}" > /dev/null 2>&1 || true
    docker network rm "${NETWORK}" > /dev/null 2>&1 || true
}
trap cleanup EXIT

pass() { echo "  ok $1"; }
fail() {
    echo "  FAIL $1"
    FAILED=1
}

# check <description> <command...>: ok when the command succeeds.
check() {
    local description="$1"
    shift
    if "$@" > /dev/null 2>&1; then
        pass "${description}"
    else
        fail "${description}"
    fi
}

# wait_for <seconds> <command...>: retries once a second until the command succeeds.
wait_for() {
    local seconds="$1"
    shift
    local i
    for ((i = 0; i < seconds; i++)); do
        if "$@" > /dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# The api image is distroless (no shell, no curl): probe it with its own node, from inside.
api_fetch() {
    docker exec "${API}" /usr/local/bin/node -e "
        fetch('http://127.0.0.1:8080' + process.argv[1]).then(async (r) => {
            process.stdout.write(r.status + ' ' + (r.headers.get('content-type') ?? '') + '\n' + (await r.text()));
        });" "$1"
}

health_ok() {
    api_fetch /api/health | grep -qF '{"status":"ok","failing":[]}'
}

openapi_ok() {
    api_fetch /api/openapi.json | grep -q '"openapi"'
}

deep_link_is_html() {
    api_fetch /some/deep/link | sed -n 1p | grep -q 'text/html'
}

worker_started() {
    docker logs "${WORKER}" 2>&1 | grep -qF '"worker started"'
}

# worker_logged_version <tool>: the worker's startup log has a "tool version" line for the tool.
worker_logged_version() {
    docker logs "${WORKER}" 2>&1 | grep -F '"tool version"' | grep -qF "\"tool\":\"$1\""
}

# in_worker <sh -c script>: runs a script in a fresh worker container, prints its first line.
in_worker() {
    docker run --rm --entrypoint sh "${WORKER_IMAGE}" -c "$1" 2>/dev/null | sed -n 1p
}

echo "Starting throwaway Postgres and Valkey..."
docker network create "${NETWORK}" > /dev/null
docker run -d --name "${PG}" --network "${NETWORK}" \
    -e POSTGRES_USER=uroboros -e POSTGRES_PASSWORD=uroboros -e POSTGRES_DB=uroboros \
    "${POSTGRES_IMAGE}" > /dev/null
docker run -d --name "${VK}" --network "${NETWORK}" "${VALKEY_IMAGE}" > /dev/null
if ! wait_for 60 docker exec "${PG}" pg_isready -U uroboros -d uroboros; then
    echo "Postgres did not become ready" >&2
    exit 1
fi
if ! wait_for 60 docker exec "${VK}" valkey-cli ping; then
    echo "Valkey did not become ready" >&2
    exit 1
fi

echo "Smoke testing ${API_IMAGE}..."
if [ "$(docker image inspect --format '{{.Config.User}}' "${API_IMAGE}")" = "65532:65532" ]; then
    pass "api user is 65532:65532"
else
    fail "api user is not 65532:65532"
fi

# The image's CMD is the api; the migrate Job is the same image with another CMD.
if docker run --rm --network "${NETWORK}" -e DATABASE_URL="${DATABASE_URL}" \
    "${API_IMAGE}" /app/migrate.mjs > /dev/null; then
    pass "migrate applied the migrations and exited 0"
else
    fail "migrate"
fi

docker run -d --name "${API}" --network "${NETWORK}" \
    -e DATABASE_URL="${DATABASE_URL}" -e VALKEY_URL="${VALKEY_URL}" \
    "${API_IMAGE}" > /dev/null
if wait_for 60 health_ok; then
    pass "api health is {\"status\":\"ok\",\"failing\":[]}"
else
    fail "api health did not reach ok"
    docker logs "${API}" 2>&1 | tail -20 || true
fi
api_node="$(docker run --rm --entrypoint /usr/local/bin/node "${API_IMAGE}" --version)"
if [ "${api_node}" = "v${NODE_VERSION}" ]; then
    pass "api runs node ${api_node}, the Dockerfile's NODE_VERSION"
else
    fail "api runs node ${api_node}, expected v${NODE_VERSION}"
fi
check "api serves /api/openapi.json" openapi_ok
check "api falls back to the SPA's HTML on a deep link" deep_link_is_html

echo "Smoke testing ${WORKER_IMAGE}..."
if [ "$(docker image inspect --format '{{.Config.User}}' "${WORKER_IMAGE}")" = "65532:65532" ]; then
    pass "worker user is 65532:65532"
else
    fail "worker user is not 65532:65532"
fi

TESTS=(
    "test \"\$(id -u)\" = 65532 && echo \"uid 65532\""
    "\"\$YTDLP_PATH\" --version"
    "ffmpeg -version"
    "node --version"
)
for cmd in "${TESTS[@]}"; do
    if OUT=$(in_worker "${cmd}") && [ -n "${OUT}" ]; then
        pass "${cmd}: ${OUT}"
    else
        fail "${cmd}"
    fi
done
# yt-dlp is the only downloader; none of its forks may be on the image.
check "no youtube-dl or youtube-dlc on PATH" docker run --rm --entrypoint sh "${WORKER_IMAGE}" -c \
    '! command -v youtube-dl && ! command -v youtube-dlc'

docker run -d --name "${WORKER}" --network "${NETWORK}" -e VALKEY_URL="${VALKEY_URL}" \
    "${WORKER_IMAGE}" > /dev/null
if wait_for 60 worker_started; then
    pass "worker process started"
else
    fail "worker process did not start"
    docker logs "${WORKER}" 2>&1 | tail -20 || true
fi
check "worker process runs as uid 65532" test "$(docker exec "${WORKER}" id -u)" = 65532
check "worker logged the yt-dlp version" worker_logged_version yt-dlp
check "worker logged the ffmpeg version" worker_logged_version ffmpeg

if [ "${FAILED}" -eq 1 ]; then
    echo "some smoke tests failed" >&2
    exit 1
fi
echo "all smoke tests passed"
