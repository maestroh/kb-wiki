#!/usr/bin/env bash
# Flush: sync the KB on session end. No-op if KB isn't set up.
set -euo pipefail
[ -n "${KNOWLEDGE_BASE:-}" ] || exit 0
[ -d "${KNOWLEDGE_BASE}/.git" ] || exit 0
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/sync.ts" "${KNOWLEDGE_BASE}" >/dev/null 2>&1 || true
exit 0
