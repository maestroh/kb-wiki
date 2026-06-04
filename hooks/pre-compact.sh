#!/usr/bin/env bash
# Before context is summarized: persist recent transcript to raw, then sync.
# Receives hook JSON on stdin (includes transcript_path). Lossless: over-capture
# is fine — compile distills later. Reads active project from $KNOWLEDGE_BASE/.kb-active.
set -euo pipefail
[ -n "${KNOWLEDGE_BASE:-}" ] || exit 0
[ -d "${KNOWLEDGE_BASE}/.git" ] || exit 0
INPUT="$(cat)"
printf '%s\n' "$INPUT" | npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/hook-precompact.ts" "${KNOWLEDGE_BASE}" >/dev/null 2>&1 || true
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/sync.ts" "${KNOWLEDGE_BASE}" >/dev/null 2>&1 || true
exit 0
