---
name: kb-sync
description: Sync the knowledge base with its GitHub remote. Delegates to sync.ts (stage → commit → pull --rebase → push) and resolves conflicts.
---

# Sync Knowledge Base

Commit and sync all knowledge base changes with the configured GitHub remote. The deterministic git work is done by `sync.ts`; this skill handles validation and conflict resolution.

## Environment
`$KNOWLEDGE_BASE` must be set. Scripts live at `${CLAUDE_PLUGIN_ROOT}/scripts/`.

## Usage
`/kb-sync` — no arguments; operates on the entire knowledge base.

## Behavior

### 1. Validate
- Check `$KNOWLEDGE_BASE` is set and the directory exists.
- Check it's a git repo: `git -C "$KNOWLEDGE_BASE" rev-parse --git-dir`.
- Check a remote is configured: `git -C "$KNOWLEDGE_BASE" remote`. If none:
  ```
  No remote configured. Add one with: git remote add origin <url>
  ```
  Exit without further action.

### 2. Sync
Delegate to the script, which stages → commits (if dirty) → `pull --rebase` → pushes, in that order, and injects `KNOWLEDGE_GIT_TOKEN` into the push URL when set (headless auth):
```bash
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/sync.ts" "$KNOWLEDGE_BASE"
```
Report its `{committed, pushed, files}`. If nothing changed, tell the user "Nothing to sync — knowledge base is up to date."

### 3. Conflict fallback
If `sync.ts` exits non-zero due to a rebase conflict, resolve using these rules, then re-run `sync.ts`:

| File type | Strategy | How |
|-----------|----------|-----|
| `_index.md` files | Union merge — accept both sides | `git checkout --theirs <file>`, then re-add local additions |
| Wiki articles (`*/wiki/*.md` except `_index.md`) | Keep remote, preserve local as `<name>.local.md` | Copy working tree version to `<name>.local.md`, then `git checkout --theirs <file>` |
| Raw sources (`*/raw/**`) | Keep remote | `git checkout --theirs <file>` |

After applying these rules, stage resolved files, run `git -C "$KNOWLEDGE_BASE" rebase --continue`, then re-run `sync.ts`. If auto-resolution fails on any file, list the remaining conflicts and ask the user what to do. Do NOT force-push.

### 4. Report
Tell the user what was committed and pushed (from the script result), any conflicts that were auto-resolved (and how), and the current sync state.

## What This Skill Does NOT Do
- Create GitHub repos or configure remotes
- Handle git authentication beyond `KNOWLEDGE_GIT_TOKEN`
- Sync selectively — it always syncs the entire knowledge base
