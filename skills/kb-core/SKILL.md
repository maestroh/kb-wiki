---
name: kb-core
description: Manage core memory — small, always-loaded durable facts about the user that apply across all projects.
---

# Core Memory

Add or list durable cross-project facts about the user (preferences, role, standing context). Stored in `core/_index.md`, deduplicated.

## Usage
- `/kb-core add <fact>` — add a fact (no-op if a duplicate already exists)
- `/kb-core list` — list current facts

## Behavior

**Add:**
```bash
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/core.ts" add "<fact>"
```
Returns `{added: true|false}` (`false` = duplicate). Report which.

**List:**
```bash
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/core.ts" list
```
Returns `{facts: [...]}`.

## When to use
Use for facts true regardless of project ("prefers TypeScript", "works at X"). Project-specific knowledge belongs in that project's wiki via `/kb-ingest`, not here. You may proactively offer to remember a clearly-durable fact you notice in conversation.
