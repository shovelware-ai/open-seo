#!/bin/sh
# deploy-guard v1 — canonical copy: shovelware-team/docs/deploy/deploy-guard.sh
# Copy it to scripts/deploy-guard.sh in each product; don't edit the copy.
#
# Refuses to deploy unless the checkout is clean, committed and pushed
# (ISMS DC-02, risk R-10, audit action A-037). Then runs the deploy command
# with --message "git:<sha>", so every Cloudflare Worker version records the
# commit it came from. dex's daily check flags live versions without a stamp.
#
# Usage, in package.json:
#   "deploy":      "sh scripts/deploy-guard.sh wrangler deploy"
#   "deploy:prod": "sh scripts/deploy-guard.sh wrangler deploy --env production"
#   OpenNext:      "sh scripts/deploy-guard.sh check && opennextjs-cloudflare build && sh scripts/deploy-guard.sh opennextjs-cloudflare deploy"
#
# "check" only checks. Anything else is the deploy command to run.
# There is no override: if you must ship, commit and push first.

set -eu

fail() {
  echo "deploy-guard: REFUSED — $1" >&2
  echo "deploy-guard: deploys must come from a clean, committed, pushed checkout (DC-02)." >&2
  exit 1
}

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "not inside a git checkout"

dirty=$(git status --porcelain --untracked-files=normal)
if [ -n "$dirty" ]; then
  echo "$dirty" | head -20 >&2
  fail "uncommitted or untracked files (listed above)"
fi

sha=$(git rev-parse HEAD)

git remote | grep -q . || fail "this repo has no remote, so nothing is pushed off the box"
git fetch --quiet --all 2>/dev/null || fail "could not fetch from the remote to check the push"
[ -n "$(git branch -r --contains "$sha" 2>/dev/null)" ] || fail "commit ${sha} is not on any remote branch: push it first"

echo "deploy-guard: ok — clean and pushed at ${sha}" >&2

[ "${1:-check}" = "check" ] && exit 0

exec "$@" --message "git:${sha}"
