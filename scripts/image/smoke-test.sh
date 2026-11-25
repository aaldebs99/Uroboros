#!/usr/bin/env bash
# Smoke test for the built image, against a throwaway Postgres container:
#
#   image   runs as 65532:65532 with tini as PID 1; `yt-dlp --version` and `ffmpeg -version`
#           answer, no other downloader is installed, ffmpeg and ffprobe are the pinned mirror's
#           yt-dlp build (a GPL build, with its licence, SOURCE.md, notices and library licences
#           under /usr/share/licenses/ffmpeg), jellyfin-ffmpeg is the pinned transcoder package
#           with the encoders and filters playback sessions use, its copyright and SOURCE.md, and
#           writes fragmented MP4 to a pipe, the npm notices are under /usr/share/licenses/uroboros,
#           the committed login-site list is its yt-dlp's, and /media is writable.
#   server  starts on an empty database and applies the migrations itself, answers
#           {"status":"ok"} on /api/health (liveness) and {"status":"ok","failing":[]} on
#           /api/ready, takes the leader lock, starts its job consumers and logs both tool
#           versions and the transcoder's, after which the manual migrate finds nothing to do and exits 0; it serves its
#           OpenAPI document and the Swagger UI bundle it ships, falls back to the SPA's
#           index.html on a deep link, and exits 0 on SIGTERM.
#
# Usage: smoke-test.sh <image>
set -euo pipefail

IMAGE="${1:?Usage: smoke-test.sh <image>}"

# The compose file's pins (exact tag and digest), so the smoke test runs what the stack runs.
POSTGRES_IMAGE="$("$(dirname "$0")/compose-image.sh" postgres)"

# The Node the image must run: the Dockerfile's pin, which `mise run ratchet:pins` ties to mise.
NODE_VERSION="$(sed -n 's/^ARG NODE_VERSION=//p' "$(dirname "$0")/../../Dockerfile")"

# The ffmpeg build the image must carry: the tag of the mirror image the Dockerfile's ffmpeg stage
# is FROM (autobuild-YYYY-MM-DD-HH-MM). yt-dlp's builds stamp the date into `ffmpeg -version`:
# "ffmpeg version N-<count>-g<hash>-YYYYMMDD".
FFMPEG_TAG="$(sed -n 's/^FROM .*\/ffmpeg-ytdlp:\([^@ ]*\)@sha256:[0-9a-f]* AS ffmpeg$/\1/p' "$(dirname "$0")/../../Dockerfile")"
test -n "${FFMPEG_TAG}" || { echo "no ffmpeg-ytdlp mirror pin in the Dockerfile" >&2; exit 1; }
FFMPEG_DATE="$(echo "${FFMPEG_TAG}" | sed -n 's/^autobuild-\([0-9]*\)-\([0-9]*\)-\([0-9]*\)-.*$/\1\2\3/p')"

# The transcoder package the image must carry: the Dockerfile's jellyfin-ffmpeg pin.
JELLYFIN_FFMPEG_VERSION="$(sed -n 's/^ARG JELLYFIN_FFMPEG_VERSION=//p' "$(dirname "$0")/../../Dockerfile")"
test -n "${JELLYFIN_FFMPEG_VERSION}" || { echo "no jellyfin-ffmpeg pin in the Dockerfile" >&2; exit 1; }
JF=/usr/lib/jellyfin-ffmpeg

SUFFIX="$$"
NETWORK="uroboros-smoke-${SUFFIX}"
PG="uroboros-smoke-pg-${SUFFIX}"
SERVER="uroboros-smoke-server-${SUFFIX}"
DATABASE_URL="postgres://uroboros:uroboros@${PG}:5432/uroboros"
FAILED=0

cleanup() {
    docker rm -f "${SERVER}" "${PG}" > /dev/null 2>&1 || true
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

# Probes the running server from inside, with its own node (no curl in the image).
api_fetch() {
    docker exec "${SERVER}" node -e "
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

logged() {
    docker logs "${SERVER}" 2>&1 | grep -qF "\"msg\":\"$1\""
}

# logged_version <tool>: the startup log has a "tool version" line for the tool.
logged_version() {
    docker logs "${SERVER}" 2>&1 | grep -F '"tool version"' | grep -qF "\"tool\":\"$1\""
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

# in_image <sh -c script>: runs a script in a fresh container, prints its first line.
in_image() {
    docker run --rm --entrypoint sh "${IMAGE}" -c "$1" 2>/dev/null | sed -n 1p
}

echo "Starting a throwaway Postgres..."
docker network create "${NETWORK}" > /dev/null
docker run -d --name "${PG}" --network "${NETWORK}" \
    -e POSTGRES_USER=uroboros -e POSTGRES_PASSWORD=uroboros -e POSTGRES_DB=uroboros \
    "${POSTGRES_IMAGE}" > /dev/null
if ! wait_for 60 docker exec "${PG}" pg_isready -U uroboros -d uroboros; then
    echo "Postgres did not become ready" >&2
    exit 1
fi

echo "Smoke testing ${IMAGE}..."
if [ "$(docker image inspect --format '{{.Config.User}}' "${IMAGE}")" = "65532:65532" ]; then
    pass "user is 65532:65532"
else
    fail "user is not 65532:65532"
fi

TESTS=(
    "test \"\$(id -u)\" = 65532 && echo \"uid 65532\""
    "\"\$YTDLP_PATH\" --version"
    "ffmpeg -version"
)
for cmd in "${TESTS[@]}"; do
    if OUT=$(in_image "${cmd}") && [ -n "${OUT}" ]; then
        pass "${cmd}: ${OUT}"
    else
        fail "${cmd}"
    fi
done
image_node="$(in_image 'node --version')"
if [ "${image_node}" = "v${NODE_VERSION}" ]; then
    pass "runs node ${image_node}, the Dockerfile's NODE_VERSION"
else
    fail "runs node ${image_node}, expected v${NODE_VERSION}"
fi
# The pinned yt-dlp build of ffmpeg: its date-stamped version, built as a GPL build, with ffprobe
# from the same release, and the licence notices that go with the binary.
check "ffmpeg is the pinned build (${FFMPEG_TAG})" docker run --rm --entrypoint sh "${IMAGE}" -c \
    "recorded=\$(sed -n 's/^- Version reported by \`ffmpeg -version\`: \`\(.*\)\`\$/\1/p' /usr/share/licenses/ffmpeg/SOURCE.md) && \
     echo \"\${recorded}\" | grep -Eq '^N-[0-9]+-g[0-9a-f]+-${FFMPEG_DATE}\$' && \
     test \"\$(ffmpeg -version | sed -n 1p | cut -d' ' -f3)\" = \"\${recorded}\" && \
     test \"\$(ffprobe -version | sed -n 1p | cut -d' ' -f3)\" = \"\${recorded}\" && \
     ffmpeg -version | grep -q -- '--enable-gpl'"
# The mirror's licence files, its SOURCE.md (naming the pinned tag and where the source is), the
# notices and the per-library licence texts; not the source itself, which stays in the mirror image.
check "ffmpeg licence, SOURCE.md, notices and library licences are installed, the source is not" \
    docker run --rm --entrypoint sh "${IMAGE}" -c \
    "test -s /usr/share/licenses/ffmpeg/LICENSE && grep -q 'GNU GENERAL PUBLIC LICENSE' /usr/share/licenses/ffmpeg/LICENSE && grep -qF '${FFMPEG_TAG}' /usr/share/licenses/ffmpeg/SOURCE.md && grep -q '/usr/src/ffmpeg-ytdlp' /usr/share/licenses/ffmpeg/SOURCE.md && test -s /usr/share/licenses/ffmpeg/NOTICES.md && test -n \"\$(find /usr/share/licenses/ffmpeg/libs -type f)\" && test ! -e /usr/src/ffmpeg-ytdlp"
check "no apt ffmpeg: the binaries are the ones in /usr/local/bin" docker run --rm --entrypoint sh "${IMAGE}" -c \
    "test \"\$(command -v ffmpeg)\" = /usr/local/bin/ffmpeg && test \"\$(command -v ffprobe)\" = /usr/local/bin/ffprobe && ! dpkg -s ffmpeg"
# The transcoder: jellyfin-ffmpeg's pinned package (a GPL build), off PATH, with what the playback
# pipelines need (docs/transcoding.md): the CPU, NVENC and VA-API H.264 encoders, the GPU scalers
# and tone mappers, and fragmented MP4 written to a pipe.
check "jellyfin-ffmpeg is the pinned package (${JELLYFIN_FFMPEG_VERSION})" docker run --rm --entrypoint sh "${IMAGE}" -c \
    "test \"\$(dpkg-query -W -f='\${Version}' jellyfin-ffmpeg8)\" = '${JELLYFIN_FFMPEG_VERSION#v}-trixie' && \
     ${JF}/ffmpeg -version | sed -n 1p | grep -q Jellyfin && ${JF}/ffmpeg -version | grep -q -- '--enable-gpl' && \
     ${JF}/ffprobe -version | sed -n 1p | grep -q Jellyfin"
check "jellyfin-ffmpeg has the encoders and filters playback uses" docker run --rm --entrypoint sh "${IMAGE}" -c \
    "e=\$(${JF}/ffmpeg -hide_banner -encoders) && f=\$(${JF}/ffmpeg -hide_banner -filters) && \
     for x in libx264 h264_nvenc h264_vaapi aac; do echo \"\$e\" | grep -q \" \$x \" || exit 1; done && \
     for x in tonemapx scale_cuda tonemap_cuda hwupload_cuda scale_vaapi setparams; do echo \"\$f\" | grep -q \" \$x \" || exit 1; done"
check "jellyfin-ffmpeg's copyright and SOURCE.md are installed" docker run --rm --entrypoint sh "${IMAGE}" -c \
    "grep -q 'Upstream-Name: FFmpeg' /usr/share/doc/jellyfin-ffmpeg8/copyright && grep -qF 'tag/${JELLYFIN_FFMPEG_VERSION}' /usr/share/licenses/jellyfin-ffmpeg/SOURCE.md"
check "jellyfin-ffmpeg writes fragmented MP4 to a pipe" docker run --rm --entrypoint sh "${IMAGE}" -c \
    "test \"\$(${JF}/ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=s=320x180:d=1 -c:v libx264 -f mp4 -movflags +frag_keyframe+empty_moov+default_base_moof pipe:1 2>/dev/null | head -c 8 | tail -c 4)\" = ftyp"
check "carries the npm notices (fonts included) and Uroboros' licence" docker run --rm --entrypoint sh "${IMAGE}" -c \
    "grep -q '@fontsource-variable/roboto@' /usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt && grep -q 'swagger-ui-dist@' /usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt && grep -q 'pg@' /usr/share/licenses/uroboros/THIRD_PARTY_NOTICES.txt && grep -q MIT /usr/share/licenses/uroboros/LICENSE"
# yt-dlp is the only downloader; none of its forks may be on the image.
check "no youtube-dl or youtube-dlc on PATH" docker run --rm --entrypoint sh "${IMAGE}" -c \
    '! command -v youtube-dl && ! command -v youtube-dlc'
# The sites the web offers for saved logins are the image's yt-dlp's: regenerate the list
# (mise run gen:login-sites) whenever a yt-dlp bump changes it.
login_sites_match() {
    "$(dirname "$0")/../gen/login-sites.sh" "${IMAGE}" --print \
        | diff - "$(dirname "$0")/../../packages/contract/src/generated/loginSites.ts"
}
check "the committed login-site list is this yt-dlp's (mise run gen:login-sites)" login_sites_match
# A fresh named volume at /media (filesystem storage) takes the image directory's owner.
check "can write /media (filesystem storage)" docker run --rm --entrypoint sh "${IMAGE}" -c \
    'touch /media/.probe && echo writable'

# The database is empty: the server applies the migrations itself before it reports ready. Without
# OIDC it needs a bootstrap admin to start.
docker run -d --name "${SERVER}" --network "${NETWORK}" \
    -e DATABASE_URL="${DATABASE_URL}" \
    -e UROBOROS_STORAGE=filesystem -e UROBOROS_STORAGE_ROOT=/tmp/media \
    -e UROBOROS_BOOTSTRAP_USERNAME=smoke -e UROBOROS_BOOTSTRAP_PASSWORD=smoke-test-password \
    "${IMAGE}" > /dev/null
if wait_for 60 ready_ok; then
    pass "readiness is {\"status\":\"ok\",\"failing\":[]}"
else
    fail "readiness did not reach ok"
    docker logs "${SERVER}" 2>&1 | tail -20 || true
fi
check "liveness is {\"status\":\"ok\"}" live_ok
check "applied the migrations on start" logged "migrations applied"
check "took the leader lock" wait_for 20 logged "leader acquired"
check "started its job consumers" wait_for 20 logged "job consumers started"
check "logged the yt-dlp version" logged_version yt-dlp
check "logged the ffmpeg version" logged_version ffmpeg
check "logged the transcoder version" logged_version transcoder
check "tini is PID 1" test "$(docker exec "${SERVER}" cat /proc/1/comm)" = tini
check "the server runs as uid 65532" test "$(docker exec "${SERVER}" id -u)" = 65532
# The image's CMD is the server; the manual migrate is the same image with another CMD.
if [ "$(docker run --rm --network "${NETWORK}" -e DATABASE_URL="${DATABASE_URL}" \
    "${IMAGE}" node /app/migrate.mjs 2>/dev/null)" = "no pending migrations" ]; then
    pass "the manual migrate found nothing pending and exited 0"
else
    fail "manual migrate"
fi
check "serves /api/openapi.json" openapi_ok
check "serves the pinned Swagger UI bundle for /api/docs" docs_bundle_ok
check "falls back to the SPA's HTML on a deep link" deep_link_is_html
# docker stop sends SIGTERM; the server drains (nothing is running) and exits 0 well inside 35 s.
docker stop -t 35 "${SERVER}" > /dev/null
check "exits 0 on SIGTERM" test "$(docker inspect --format '{{.State.ExitCode}}' "${SERVER}")" = 0
check "logged its shutdown" logged "shutting down"

if [ "${FAILED}" -eq 1 ]; then
    echo "some smoke tests failed" >&2
    exit 1
fi
echo "all smoke tests passed"
