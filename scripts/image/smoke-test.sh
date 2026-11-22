#!/usr/bin/env bash
# Smoke test for the built images, against throwaway Postgres and Valkey containers:
#
#   api     runs as 65532:65532, starts on an empty database and applies the migrations itself,
#           answers {"status":"ok"} on /api/health (liveness) and {"status":"ok","failing":[]} on
#           /api/ready, takes the leader lock, after which the manual migrate finds nothing to do
#           and exits 0; it serves its OpenAPI document and the Swagger UI bundle it ships, falls
#           back to the SPA's index.html on a deep link, and carries the npm notices under
#           /usr/share/licenses/uroboros.
#   worker  runs as uid 65532, `yt-dlp --version` and `ffmpeg -version` answer, no other
#           downloader is installed, ffmpeg and ffprobe are the pinned mirror's yt-dlp build (a GPL build, with its
#           licence, SOURCE.md, notices and library licences under /usr/share/licenses/ffmpeg), and the worker process starts, logs
#           both tool versions and its "worker started" line under tini as PID 1, and exits 0 on
#           SIGTERM.
#
# Usage: smoke-test.sh <api-image> <worker-image>
set -euo pipefail

API_IMAGE="${1:?Usage: smoke-test.sh <api-image> <worker-image>}"
WORKER_IMAGE="${2:?Usage: smoke-test.sh <api-image> <worker-image>}"

# The compose file's pins (exact tag and digest), so the smoke test runs what the stack runs.
POSTGRES_IMAGE="$("$(dirname "$0")/compose-image.sh" postgres)"
VALKEY_IMAGE="$("$(dirname "$0")/compose-image.sh" valkey)"

# The Node the images must run: the Dockerfile's pin, which `mise run ratchet:pins` ties to mise.
NODE_VERSION="$(sed -n 's/^ARG NODE_VERSION=//p' "$(dirname "$0")/../../Dockerfile")"

# The ffmpeg build the worker must carry: the tag of the mirror image the Dockerfile's ffmpeg stage
# is FROM (autobuild-YYYY-MM-DD-HH-MM). yt-dlp's builds stamp the date into `ffmpeg -version`:
# "ffmpeg version N-<count>-g<hash>-YYYYMMDD".
FFMPEG_TAG="$(sed -n 's/^FROM .*\/ffmpeg-ytdlp:\([^@ ]*\)@sha256:[0-9a-f]* AS ffmpeg$/\1/p' "$(dirname "$0")/../../Dockerfile")"
test -n "${FFMPEG_TAG}" || { echo "no ffmpeg-ytdlp mirror pin in the Dockerfile" >&2; exit 1; }
FFMPEG_DATE="$(echo "${FFMPEG_TAG}" | sed -n 's/^autobuild-\([0-9]*\)-\([0-9]*\)-\([0-9]*\)-.*$/\1\2\3/p')"

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

ready_ok() {
    api_fetch /api/ready | grep -qF '{"status":"ok","failing":[]}'
}

live_ok() {
    api_fetch /api/health | grep -qF '{"status":"ok"}'
}

api_logged() {
    docker logs "${API}" 2>&1 | grep -qF "\"msg\":\"$1\""
}

openapi_ok() {
    api_fetch /api/openapi.json | grep -q '"openapi"'
}

docs_bundle_ok() {
    api_fetch /api/docs/swagger-ui-bundle.js | sed -n 1p | grep -q '^200 text/javascript'
}

deep_link_is_html() {
    api_fetch /some/deep/link | sed -n 1p | grep -q 'text/html'
}

worker_started() {
    docker logs "${WORKER}" 2>&1 | grep -qF '"worker started"'
}

worker_logged_shutdown() {
    docker logs "${WORKER}" 2>&1 | grep -qF '"shutting down"'
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

# The database is empty: the api applies the migrations itself before it reports ready.
docker run -d --name "${API}" --network "${NETWORK}" \
    -e DATABASE_URL="${DATABASE_URL}" -e VALKEY_URL="${VALKEY_URL}" \
    "${API_IMAGE}" > /dev/null
if wait_for 60 ready_ok; then
    pass "api readiness is {\"status\":\"ok\",\"failing\":[]}"
else
    fail "api readiness did not reach ok"
    docker logs "${API}" 2>&1 | tail -20 || true
fi
check "api liveness is {\"status\":\"ok\"}" live_ok
check "api applied the migrations on start" api_logged "migrations applied"
check "api took the leader lock" wait_for 20 api_logged "leader acquired"
# The image's CMD is the api; the manual migrate is the same image with another CMD.
if [ "$(docker run --rm --network "${NETWORK}" -e DATABASE_URL="${DATABASE_URL}" \
    "${API_IMAGE}" /app/migrate.mjs 2>/dev/null)" = "no pending migrations" ]; then
    pass "the manual migrate found nothing pending and exited 0"
else
    fail "manual migrate"
fi
api_node="$(docker run --rm --entrypoint /usr/local/bin/node "${API_IMAGE}" --version 2>/dev/null || true)"
if [ "${api_node}" = "v${NODE_VERSION}" ]; then
    pass "api runs node ${api_node}, the Dockerfile's NODE_VERSION"
else
    fail "api runs node ${api_node}, expected v${NODE_VERSION}"
fi
check "api serves /api/openapi.json" openapi_ok
check "api serves the pinned Swagger UI bundle for /api/docs" docs_bundle_ok
check "api falls back to the SPA's HTML on a deep link" deep_link_is_html
check "api carries the npm notices (fonts included) and Uroboros' licence" docker run --rm \
    --entrypoint /usr/local/bin/node "${API_IMAGE}" -e "
        const fs = require('node:fs');
        const n = fs.readFileSync('/usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt', 'utf8');
        const l = fs.readFileSync('/usr/share/licenses/uroboros/LICENSE', 'utf8');
        process.exit(n.includes('@fontsource-variable/geist@') && n.includes('swagger-ui-dist@') && l.includes('MIT') ? 0 : 1);"

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
# The pinned yt-dlp build of ffmpeg: its date-stamped version, built as a GPL build, with ffprobe
# from the same release, and the licence notices that go with the binary.
check "ffmpeg is the pinned build (${FFMPEG_TAG})" docker run --rm --entrypoint sh "${WORKER_IMAGE}" -c \
    "recorded=\$(sed -n 's/^- Version reported by \`ffmpeg -version\`: \`\(.*\)\`\$/\1/p' /usr/share/licenses/ffmpeg/SOURCE.md) && \
     echo \"\${recorded}\" | grep -Eq '^N-[0-9]+-g[0-9a-f]+-${FFMPEG_DATE}\$' && \
     test \"\$(ffmpeg -version | sed -n 1p | cut -d' ' -f3)\" = \"\${recorded}\" && \
     test \"\$(ffprobe -version | sed -n 1p | cut -d' ' -f3)\" = \"\${recorded}\" && \
     ffmpeg -version | grep -q -- '--enable-gpl'"
# The mirror's licence files, its SOURCE.md (naming the pinned tag and where the source is), the
# notices and the per-library licence texts; not the source itself, which stays in the mirror image.
check "ffmpeg licence, SOURCE.md, notices and library licences are installed, the source is not" \
    docker run --rm --entrypoint sh "${WORKER_IMAGE}" -c \
    "test -s /usr/share/licenses/ffmpeg/LICENSE && grep -q 'GNU GENERAL PUBLIC LICENSE' /usr/share/licenses/ffmpeg/LICENSE && grep -qF '${FFMPEG_TAG}' /usr/share/licenses/ffmpeg/SOURCE.md && grep -q '/usr/src/ffmpeg-ytdlp' /usr/share/licenses/ffmpeg/SOURCE.md && test -s /usr/share/licenses/ffmpeg/NOTICES.md && test -n \"\$(find /usr/share/licenses/ffmpeg/libs -type f)\" && test ! -e /usr/src/ffmpeg-ytdlp"
check "no apt ffmpeg: the binaries are the ones in /usr/local/bin" docker run --rm --entrypoint sh "${WORKER_IMAGE}" -c \
    "test \"\$(command -v ffmpeg)\" = /usr/local/bin/ffmpeg && test \"\$(command -v ffprobe)\" = /usr/local/bin/ffprobe && ! dpkg -s ffmpeg"
check "worker carries the npm notices" docker run --rm --entrypoint sh "${WORKER_IMAGE}" -c \
    "grep -q 'pg@' /usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt && test -s /usr/share/licenses/uroboros/LICENSE"
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
check "tini is the worker's PID 1" test "$(docker exec "${WORKER}" cat /proc/1/comm)" = tini
# docker stop sends SIGTERM; the worker drains (nothing is running) and exits 0 well inside 30 s.
docker stop -t 30 "${WORKER}" > /dev/null
check "worker exits 0 on SIGTERM" test "$(docker inspect --format '{{.State.ExitCode}}' "${WORKER}")" = 0
check "worker logged its shutdown" worker_logged_shutdown

if [ "${FAILED}" -eq 1 ]; then
    echo "some smoke tests failed" >&2
    exit 1
fi
echo "all smoke tests passed"
