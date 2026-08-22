#!/usr/bin/env bash
set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "master" ]; then
  echo "refusing to push migrations from '$branch' — only master is deployable." >&2
  echo "a migration applied from a feature branch leaves the remote ledger ahead" >&2
  echo "of every checkout, which is how 140_class_subject reached production." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to push migrations with a dirty tree — commit or stash first." >&2
  exit 1
fi

if ! git diff --quiet HEAD "@{upstream}" -- supabase/migrations 2>/dev/null; then
  echo "refusing to push: local migrations differ from @{upstream}." >&2
  echo "push the branch first so the ledger matches what teammates have." >&2
  exit 1
fi

remote_only="$(
  supabase migration list 2>/dev/null \
    | grep -o '{"local":"","remote":"[0-9]*"' \
    | grep -o '[0-9]*' \
    | tr '\n' ' '
)"
if [ -n "${remote_only// /}" ]; then
  echo "remote has migrations with no local file: $remote_only" >&2
  echo "reconcile before pushing (merge the branch that owns them, or" >&2
  echo "revert them remotely and run: supabase migration repair --status reverted <version>)" >&2
  exit 1
fi

if [ ! -t 0 ] && [[ " $* " != *" --yes "* ]]; then
  echo "refusing to push: supabase db push prompts for confirmation and stdin is" >&2
  echo "not a terminal, so it would exit having applied nothing." >&2
  echo "re-run as: npm run db:push -- --yes" >&2
  exit 1
fi

supabase db push --dry-run "$@"
exec supabase db push "$@"
