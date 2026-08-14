#!/bin/sh
# Refresh the published catalog from a local scheduled job.
#
# Runs the crawler, and pushes only when the data actually changed — the
# crawler compares contentHash (which excludes generatedAt) and writes nothing
# when the catalog is identical, so a quiet run leaves the tree clean and this
# script exits without a commit.
#
#   sh scripts/refresh.sh              # incremental, labels the changed entries
#   sh scripts/refresh.sh --no-llm     # rules only, no model spend
#   sh scripts/refresh.sh --dry-run    # write to .tmp/, never touch git
#
# Credentials: GITHUB_TOKEN is taken from the `gh` CLI when unset; the LLM key
# comes from .env (gitignored). Both stay on this machine — nothing about this
# pipeline runs in CI.

set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

LOG_DIR="${DSH_HUB_LOG_DIR:-$ROOT/.logs}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/refresh-$(date -u +%Y%m%dT%H%M%SZ).log"

# `gh` is the usual source of a token on a developer machine; an exported
# GITHUB_TOKEN wins so a non-interactive job can supply its own.
if [ "${GITHUB_TOKEN:-}" = "" ]; then
  if command -v gh >/dev/null 2>&1; then
    GITHUB_TOKEN=$(gh auth token)
    export GITHUB_TOKEN
  else
    echo "refresh: no GITHUB_TOKEN and no gh CLI to borrow one from" >&2
    exit 1
  fi
fi

echo "refresh: starting $(date -u +%FT%TZ)" | tee "$LOG"
if ! node tools/crawler/cli.ts "$@" 2>&1 | tee -a "$LOG"; then
  echo "refresh: crawler failed — see $LOG" >&2
  exit 1
fi

# --dry-run writes to .tmp/ and must never reach git.
for arg in "$@"; do
  [ "$arg" = "--dry-run" ] && { echo "refresh: dry run, nothing committed" | tee -a "$LOG"; exit 0; }
done

if git diff --quiet -- data/; then
  echo "refresh: catalog unchanged, nothing to publish" | tee -a "$LOG"
  exit 0
fi

git add data/
git commit -q -m "data: refresh catalog

$(node -e "
  const meta = require('./data/v1/meta.json')
  console.log(\`entries=\${meta.count} hash=\${meta.contentHash} generated=\${meta.generatedAt}\`)
")"

# Push is best-effort: a failed push leaves the commit local, and the next run
# picks it up. Losing the network should not lose the crawl.
if git push -q 2>>"$LOG"; then
  echo "refresh: published" | tee -a "$LOG"
else
  echo "refresh: committed locally but push failed — see $LOG" | tee -a "$LOG"
fi

# Keep the log directory from growing without bound.
ls -1t "$LOG_DIR" | tail -n +50 | while read -r old; do rm -f "$LOG_DIR/$old"; done
