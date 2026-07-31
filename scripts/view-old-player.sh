#!/usr/bin/env bash
# View the OLD student player from a previous commit, live.
#
# Checks out a past commit into a throwaway git worktree, installs its deps, and
# runs its dev server on :3100 so you can open the old player at
#   http://localhost:3100/watch/aircAruvnKk
# (any 11-char YouTube id works; that one is the 3Blue1Brown neural-nets video).
#
# Usage:  bash scripts/view-old-player.sh [commit-ish]   # default: f9827b9^
set -euo pipefail

COMMIT="${1:-f9827b9^}"
WT="/tmp/ott-old-player"
ROOT="$(git rev-parse --show-toplevel)"

echo "• pinning old player from commit: $COMMIT"
git worktree remove --force "$WT" 2>/dev/null || true
git worktree add --detach "$WT" "$COMMIT"

# The old app reads Supabase env at boot; reuse the current local env.
cp "$ROOT/.env.local" "$WT/.env.local" 2>/dev/null || true

cd "$WT"
echo "• installing old deps (this can take a minute)…"
npm install --no-audit --no-fund

echo "• starting old app on http://localhost:3100"
echo "  → open http://localhost:3100/watch/aircAruvnKk"
exec npm run dev -- -p 3100
