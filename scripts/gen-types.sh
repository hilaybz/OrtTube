#!/bin/sh
# Regenerate lib/supabase/types.ts from the LINKED REMOTE schema.
#
# Read docs/CLAUDE.md's ordering rule before using this: `supabase db push`
# first, then this. Generating before pushing silently produces types for the
# pre-migration schema.
#
# Two things this handles that a bare `supabase gen types ... > types.ts` does
# not:
#
#   1. The redirect truncates the target BEFORE the command runs, so any
#      failure — a config key the CLI can't parse, an expired token, no
#      network — leaves types.ts empty rather than untouched. We generate to a
#      temp file and move it into place only on success.
#   2. `npx supabase` silently falls back to whatever version npm has cached
#      when the pinned devDependency isn't installed, and an older CLI rejects
#      newer config.toml keys. Prefer the pinned binary, fall back to the one
#      on PATH, and say so.

set -eu

TARGET="lib/supabase/types.ts"
TMP="$TARGET.tmp"

if [ -x node_modules/.bin/supabase ]; then
  SUPABASE=node_modules/.bin/supabase
elif command -v supabase >/dev/null 2>&1; then
  SUPABASE=supabase
  echo "gen:types: node_modules/.bin/supabase is missing; using $(command -v supabase)." >&2
  echo "gen:types: run \`npm install\` to use the version pinned in package.json." >&2
else
  echo "gen:types: no supabase CLI found." >&2
  echo "gen:types: run \`npm install\`, or install the CLI (\`brew install supabase/tap/supabase\`)." >&2
  exit 1
fi

trap 'rm -f "$TMP"' EXIT

"$SUPABASE" gen types typescript --linked > "$TMP"

# A CLI that exits 0 having written nothing would otherwise blank the file.
if [ ! -s "$TMP" ]; then
  echo "gen:types: generated output was empty; leaving $TARGET unchanged." >&2
  exit 1
fi

mv "$TMP" "$TARGET"
echo "gen:types: wrote $TARGET ($(wc -l < "$TARGET" | tr -d ' ') lines)."
