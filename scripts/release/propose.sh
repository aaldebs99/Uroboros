#!/usr/bin/env bash
# Keep the release PR in sync with main. Run on every push to main by
# .github/workflows/release-pr.yml, after publish.sh.
#
#   1. Ask git-cliff for the next version from the conventional commits since the
#      newest tag. Nothing to release -> exit 0.
#   2. Rebuild the `release/next` branch from HEAD: stamp the version into every
#      target (lib.sh: the server and root package.json, api/openapi.json and the
#      chart's appVersion), prepend the new CHANGELOG section, one commit.
#   3. Force-push it and open (or refresh) the `chore(release): X.Y.Z` PR.
#
# Everything the release touches lands in that ONE commit, so the PR is either
# complete or absent.
#
# Requires: git-cliff, jq, curl on PATH; a full clone with tags; lib.sh's env.
# Extra env:  FORGE_URL       the forge's web root (CI passes github.server_url);
#                             the push URL is built from it, the bot's login and
#                             the token.
#             RELEASE_REMOTE  a push URL to use instead of building one.
#             Under DRY_RUN the push and the PR call are logged, not made.

set -euo pipefail
# shellcheck source=scripts/release/lib.sh
. "$(dirname "$0")/lib.sh"

BRANCH="release/next"
BASE="main"

current=$(current_tag)
in_tree=$(version_in_tree)
if [ -z "$current" ]; then
  # Before the first release the tree carries the 0.0.0 placeholder, and git-cliff proposes its
  # initial version (0.1.0) from the whole history. Any other version with no tag means a
  # release was merged whose publish has not succeeded yet.
  is_unreleased "$in_tree" || die "main carries version ${in_tree} but no release tag exists: publish.sh must succeed before a new release can be proposed"
  current=$in_tree
fi
[ "$in_tree" = "$current" ] || die "main carries version ${in_tree} but the newest tag is ${current}: publish.sh must succeed before a new release can be proposed"

# git-cliff bumps the patch for ANY conventional commit, but a release is only
# worth cutting for a releasing type: feat, fix, perf, revert, deps, or a
# breaking change. Build and CI commits are typed ci/chore/build precisely so
# they never mint a version. Gate on the commit types first; the bump itself is
# then git-cliff's, and non-releasing commits still appear in the changelog of
# the release that eventually carries them.
if ! git-cliff --unreleased --context 2>/dev/null | jq -e '
      [.[].commits[] | select(.breaking == true or
        (.group // "" | test("Features|Bug Fixes|Performance Improvements|Reverts|Dependencies")))]
      | length > 0' >/dev/null; then
  log "nothing to release: no feat/fix/perf/revert/deps/breaking commits since ${current}"
  exit 0
fi

next=$(git-cliff --bumped-version 2>/dev/null)
[[ "$next" =~ $TAG_PATTERN ]] || die "git-cliff produced an unexpected version: '${next}'"
[ "$next" != "$current" ] || die "releasable commits found but git-cliff did not bump ${current}"
log "proposing ${current} -> ${next}"

# The PR body and the CHANGELOG section are the same text, rendered once.
section=$(git-cliff --unreleased --tag "$next" --strip all)
[ -n "$section" ] || die "git-cliff rendered an empty section for ${next}"

# The commit is authored as the bot, so the branch and the PR are attributed to
# it and the forge links the commit to the account. CI has no identity of its
# own; a developer's dry run keeps theirs.
IFS=$'\t' read -r bot_login bot_email < <(bot_identity)
[ -n "$bot_login" ] || die "could not read the bot's login from ${FORGE_API}/user"
if [ -z "$(git config user.email || true)" ]; then
  forge_host=${FORGE_API#*://}
  forge_host=${forge_host%%/*}
  git config user.name "$bot_login"
  git config user.email "${bot_email:-${bot_login}@noreply.${forge_host}}"
fi

git checkout -q -B "$BRANCH"
stamp_version "$in_tree" "$next"
git-cliff --unreleased --tag "$next" --prepend CHANGELOG.md
head -n 3 CHANGELOG.md | grep -q "^## \[${next//./\\.}\]" || die "CHANGELOG.md does not start with the ${next} section after prepend"

git add "$SERVER_PKG" "$ROOT_PKG" "$OPENAPI_JSON" "$CHART_YAML" CHANGELOG.md
if git diff --cached --quiet; then
  die "stamping ${next} produced no diff"
fi
git commit -q -m "chore(release): ${next}"
log "committed $(git rev-parse --short HEAD) chore(release): ${next}"

if [ "$DRY_RUN" = 1 ]; then
  log "DRY_RUN: git push --force <remote> ${BRANCH}"
else
  if [ -z "${RELEASE_REMOTE:-}" ]; then
    : "${FORGE_URL:?FORGE_URL (the forge web root) or RELEASE_REMOTE is required}"
    RELEASE_REMOTE="${FORGE_URL%%://*}://${bot_login}:${RELEASE_PLEASE_TOKEN}@${FORGE_URL#*://}/${FORGE_REPO}.git"
  fi
  git push --force --quiet "$RELEASE_REMOTE" "HEAD:refs/heads/${BRANCH}"
fi

title="chore(release): ${next}"
existing=$(api GET "/repos/${FORGE_REPO}/pulls?state=open&limit=50" \
  | jq -r --arg h "$BRANCH" '.[] | select(.head.ref == $h) | .number' | head -n 1)
if [ -n "$existing" ]; then
  payload=$(jq -n --arg t "$title" --arg b "$section" '{title: $t, body: $b}')
  api PATCH "/repos/${FORGE_REPO}/pulls/${existing}" "$payload" >/dev/null
  log "refreshed PR #${existing}: ${title}"
else
  payload=$(jq -n --arg t "$title" --arg b "$section" --arg h "$BRANCH" --arg base "$BASE" \
    '{title: $t, body: $b, head: $h, base: $base}')
  num=$(api POST "/repos/${FORGE_REPO}/pulls" "$payload" | jq -r '.number // "dry-run"')
  log "opened PR #${num}: ${title}"
fi
