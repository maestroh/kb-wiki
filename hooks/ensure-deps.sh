#!/usr/bin/env bash
# Bootstrap: install the plugin's TypeScript dependencies on first use.
# Plugin install/update copies scripts/ to a fresh cache dir WITHOUT running
# npm install, so the contract lib (gray-matter, js-yaml) is missing until this
# runs. Every script except sync.ts imports it, so without this the skills/hooks
# fail on first invocation. No-op once node_modules exists; never fails a session.
set -euo pipefail
SCRIPTS="${CLAUDE_PLUGIN_ROOT:-}/scripts"
[ -n "${CLAUDE_PLUGIN_ROOT:-}" ] || exit 0
[ -d "$SCRIPTS" ] || exit 0
[ -f "$SCRIPTS/package.json" ] || exit 0
if [ ! -d "$SCRIPTS/node_modules" ]; then
  (cd "$SCRIPTS" && npm install --silent >/dev/null 2>&1) || true
fi
exit 0
