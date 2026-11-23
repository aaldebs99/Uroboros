#!/usr/bin/env bash
# Shared helpers for scripts/release/propose.sh and publish.sh. Sourced, not run.
#
# Ported from Djinn (which took them from quire, where they replaced release-please once the
# repository lived on a forge the action cannot talk to). The shape: the version main carries is
# the source of truth, a release is cut for it when none exists, and the next one is proposed as
# a pull request a person merges.
#
# Environment:
#   FORGE_API              forge API root, e.g. https://code.example.com/api/v1
#                          (CI passes github.api_url)
#   FORGE_REPO             owner/name (CI passes github.repository)
#   RELEASE_PLEASE_TOKEN   the release bot's access token: write:repository,
#                          write:issue, and read:user for bot_identity below
#   DRY_RUN                optional. "1" logs every write (API call, git push) instead
#                          of performing it; reads still happen. Run it in a scratch
#                          clone: propose.sh commits to a branch of whatever checkout
#                          it runs in.
#
# Every failure is fatal. There is deliberately no retry or fallback here: a half-made release
# (branch pushed, PR not opened; tag created, release not published) is worse than a loud red
# job, and the workflow that calls these is idempotent, so the fix for a red run is always a
# rerun.

set -euo pipefail

: "${FORGE_API:?FORGE_API is required}"
: "${FORGE_REPO:?FORGE_REPO is required}"
: "${RELEASE_PLEASE_TOKEN:?RELEASE_PLEASE_TOKEN is required}"
DRY_RUN="${DRY_RUN:-0}"

# Every path below is relative to the repository root, wherever this was run.
cd "$(git rev-parse --show-toplevel)"

# A release tag is bare semver (`0.1.0`, never `v0.1.0`): what cliff.toml's `tag_pattern` matches
# and what release.yml's metadata step turns into image tags. The version inside the tree is the
# same number.
TAG_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+$'
# The version the tree carries before its first release. publish.sh never cuts it; propose.sh
# proposes the first real version (git-cliff's initial 0.1.0) from it.
UNRELEASED='0.0.0'
# The version's source of truth: the server package, which the api reports on /api/info and
# `mise run gen` writes into the OpenAPI document.
SERVER_PKG='apps/server/package.json'
ROOT_PKG='package.json'
OPENAPI_JSON='api/openapi.json'

log() { printf '%s\n' "$*" >&2; }
die() {
  log "error: $*"
  exit 1
}

# api METHOD PATH [JSON]: prints the response body. Fails (with the body on stderr) on any HTTP
# error. Writes are skipped under DRY_RUN.
api() {
  local method=$1 path=$2 body=${3:-}
  local url="${FORGE_API}${path}"
  if [ "$DRY_RUN" = 1 ] && [ "$method" != GET ]; then
    log "DRY_RUN: $method $url"
    [ -n "$body" ] && log "$(printf '%s' "$body" | jq .)"
    echo '{}'
    return 0
  fi
  local -a args=(-sS --fail-with-body -X "$method"
    -H "Authorization: token ${RELEASE_PLEASE_TOKEN}" -H 'Accept: application/json')
  if [ -n "$body" ]; then
    args+=(-H 'Content-Type: application/json' --data-binary "$body")
  fi
  local out
  if ! out=$(curl "${args[@]}" "$url"); then
    log "$method $url failed:"
    log "$out"
    return 1
  fi
  printf '%s' "$out"
}

# api_probe METHOD PATH: prints the response body, then the HTTP status code on a line of its
# own, and never fails on 4xx/5xx. The caller decides what a status means and has the forge's own
# reason at hand for the ones it did not expect. Split with ${out##*$'\n'} for the status and
# ${out%$'\n'*} for the body; an empty body still leaves the newline, so the split holds.
api_probe() {
  local method=$1 path=$2
  curl -sS -w '\n%{http_code}' -X "$method" \
    -H "Authorization: token ${RELEASE_PLEASE_TOKEN}" "${FORGE_API}${path}"
}

# The newest release tag reachable in this clone (needs `fetch-tags`). Empty when nothing has
# been released yet.
current_tag() {
  # `|| true`: with pipefail, grep's exit 1 on no match would abort the caller before its
  # diagnostic could print.
  git tag --list | { grep -E "$TAG_PATTERN" || true; } | sort -V | tail -n 1
}

# is_unreleased VERSION: true for the placeholder the tree carries before its first release.
is_unreleased() {
  [ "$1" = "$UNRELEASED" ]
}

# The version main carries in source: the value the release script stamped.
version_in_tree() {
  jq -r '.version' "$SERVER_PKG"
}

# The account behind RELEASE_PLEASE_TOKEN, as "login<TAB>email", for the release commit's
# identity and the push URL. Read rather than written down, so these scripts never name the bot.
bot_identity() {
  api GET /user | jq -r '[.login, (.email // "")] | @tsv'
}

# stamp_version FROM TO: rewrite every stamp target in place and prove it.
#
# Targets, and why an anchored sed rather than a structured editor for each:
#   apps/server/package.json   the source of truth. Its one top-level "version" line, at the
#   package.json               two-space indent a package.json has; jq would re-serialise the
#                              whole file.
#   api/openapi.json           `info.version`, the only "version" string at the four-space
#                              indent of the generator's output (a schema property of that name
#                              sits deeper). Editing the one line keeps the file byte-identical
#                              to what `mise run gen` writes from the new package version, which
#                              `check:gen` then verifies on the release PR.
# apps/web, packages/contract and tools/ratchet stay 0.0.0: nothing is published from them.
# CHANGELOG.md is prepended by git-cliff separately.
stamp_version() {
  local from=$1 to=$2
  local from_re=${from//./\\.}
  local target
  for target in "$SERVER_PKG" "$ROOT_PKG"; do
    sed -i -E "s|^(  \"version\": \")${from_re}(\",?)\$|\1${to}\2|" "$target"
  done
  sed -i -E "s|^(    \"version\": \")${from_re}(\",?)\$|\1${to}\2|" "$OPENAPI_JSON"

  # Prove every target moved. A miss here is exactly the failure that shipped broken releases
  # elsewhere before the stamp set was consolidated, so it is fatal.
  for target in "$SERVER_PKG" "$ROOT_PKG"; do
    [ "$(jq -r '.version' "$target")" = "$to" ] || die "${target}: .version is not ${to}"
  done
  [ "$(jq -r '.info.version' "$OPENAPI_JSON")" = "$to" ] || die "${OPENAPI_JSON}: .info.version is not ${to}"
  log "stamped ${from} -> ${to} in ${SERVER_PKG}, ${ROOT_PKG} and ${OPENAPI_JSON}"
}
