#!/usr/bin/env bash
# One-time repository cleanup (issue #6). Run from a local clone with push
# rights AFTER the cleanup PR is merged into main.
#
#   bash scripts/repo-cleanup.sh          # dry run: prints what it would do
#   bash scripts/repo-cleanup.sh --apply  # tag, push tags, delete branches
#
# Every branch it deletes is either fully contained in main or preserved as a
# tag first, so nothing is lost.
set -euo pipefail

APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true
run() { echo "+ $*"; if $APPLY; then "$@"; fi; }

git fetch origin --prune --tags

# tag  target  message
TAGS=(
  "v0.1.0|origin/milestone/react-canonical-v0.1|Milestone 0.1 — React canonical state"
  "v0.2.0|origin/milestone/mcp-shared-memory-v0.2|Milestone 0.2 — MCP shared memory"
  "v0.3.0|origin/milestone/real-shared-room-v0.3|Milestone 0.3 — Real Shared Room + Cloudflare demo"
  "v0.4.0|a96c2db|Milestone 0.4 — orchestration modes, remote MCP, repository adoption"
  "archive/v0.5-lifecycle|origin/ccr-00e0be58-t5hpg7|Archived tip of ccr-00e0be58-t5hpg7 (v0.5 work, now on main)"
  "archive/demo-scenario|origin/feature/demo-scenario|Archived tip of feature/demo-scenario (ported to main)"
)

BRANCHES=(
  milestone/react-canonical-v0.1
  milestone/mcp-shared-memory-v0.2
  milestone/real-shared-room-v0.3
  prototype/mcp-shared-memory-v1
  feature/cloudflare-demo
  feature/demo-scenario
  ccr-00e0be58-t5hpg7
  claude/zen-knuth-ge01j8
)

pushed=()
for entry in "${TAGS[@]}"; do
  IFS='|' read -r tag target message <<<"$entry"
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "= tag $tag exists"
  elif git rev-parse -q --verify "$target^{commit}" >/dev/null; then
    run git tag -a "$tag" "$target" -m "$message"
  else
    echo "! cannot resolve $target for $tag — skipping (branch already deleted?)"
    continue
  fi
  pushed+=("$tag")
done
[[ ${#pushed[@]} -gt 0 ]] && run git push origin "${pushed[@]}"

for branch in "${BRANCHES[@]}"; do
  if git rev-parse -q --verify "refs/remotes/origin/$branch" >/dev/null; then
    run git push origin --delete "$branch"
  fi
done

$APPLY || echo -e "\nDry run. Re-run with --apply to make these changes."
