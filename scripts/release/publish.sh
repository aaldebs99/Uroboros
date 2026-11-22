#!/usr/bin/env bash
# Cut the release main is carrying, if it has not been cut yet. Run on every
# push to main by .github/workflows/release-pr.yml, before propose.sh.
#
# The version on main (apps/server/package.json) is the source of
# truth: when it has no release, this creates one. The forge creates the tag as
# part of the release and fires `release: published`, which is what triggers
# release.yml to build and push the image. Reading the file rather than commit
# messages is what makes this independent of how the release PR was merged.
#
# Idempotent: a version that already has a release is a no-op, so a rerun after
# a partial failure is always safe.
#
# Requires: git-cliff, jq, curl on PATH; a full clone with tags; lib.sh's env.

set -euo pipefail
# shellcheck source=scripts/release/lib.sh
. "$(dirname "$0")/lib.sh"

version=$(version_in_tree)
[[ "$version" =~ $TAG_PATTERN ]] || die "${SERVER_PKG} carries an unexpected version: '${version}'"
if is_unreleased "$version"; then
  log "main carries ${version}, the never-released placeholder; propose.sh opens the first release PR"
  exit 0
fi

lookup="/repos/${FORGE_REPO}/releases/tags/${version}"
probe=$(api_probe GET "$lookup")
status=${probe##*$'\n'}
reason=${probe%$'\n'*}
case "$status" in
  200)
    log "${version} is already released; nothing to do"
    exit 0
    ;;
  404) ;;
  *) die "unexpected HTTP ${status} from GET ${FORGE_API}${lookup}: ${reason}" ;;
esac

# Everything since the previous tag is this release (the whole history for the
# first one). The `chore(release)` commit itself is skipped by cliff.toml.
body=$(git-cliff --unreleased --tag "$version" --strip all)
[ -n "$body" ] || die "git-cliff rendered an empty body for ${version}"

sha=$(git rev-parse HEAD)
payload=$(jq -n --arg t "$version" --arg sha "$sha" --arg b "$body" \
  '{tag_name: $t, target_commitish: $sha, name: $t, body: $b, draft: false, prerelease: false}')
url=$(api POST "/repos/${FORGE_REPO}/releases" "$payload" | jq -r '.html_url // "dry-run"')
log "published ${version} at ${sha:0:7}: ${url}"
