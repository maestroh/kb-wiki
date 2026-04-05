---
name: kb-sync
description: Sync the knowledge base with its GitHub remote. Pulls, resolves conflicts, commits, and pushes.
---

# Sync Knowledge Base

Commit and sync all knowledge base changes with the configured GitHub remote.

## Environment

The knowledge base root is at `$KNOWLEDGE_BASE`. If not set, tell the user:
```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

## Usage

`/kb-sync`

No arguments. Operates on the entire knowledge base.

## Behavior

### 1. Validate

- Check `$KNOWLEDGE_BASE` is set and the directory exists
- Check it's a git repo: run `git -C "$KNOWLEDGE_BASE" rev-parse --git-dir`
- Check a remote is configured: run `git -C "$KNOWLEDGE_BASE" remote`
  - If no remote exists, tell the user:
    ```
    No remote configured. Add one with: git remote add origin <url>
    ```
    Exit without further action.

### 2. Pull

Run `git -C "$KNOWLEDGE_BASE" pull --rebase`.

If no conflicts, proceed to step 3.

If conflicts arise, attempt auto-resolution using these rules:

| File type | Strategy | How |
|-----------|----------|-----|
| `_index.md` files | Union merge — accept both sides | `git checkout --theirs <file>`, then re-add local additions |
| Wiki articles (`*/wiki/*.md` except `_index.md`) | Keep remote, preserve local as `<name>.local.md` | Copy working tree version to `<name>.local.md`, then `git checkout --theirs <file>` |
| Raw sources (`*/raw/**`) | Keep remote | `git checkout --theirs <file>` |

After applying these rules, stage resolved files and run `git rebase --continue`.

If auto-resolution fails on any file, list the remaining conflicts and ask the user what to do. Do NOT proceed with commit/push until all conflicts are resolved.

### 3. Commit

- Stage all changes: run `git -C "$KNOWLEDGE_BASE" add -A`
- Check if there are staged changes: run `git -C "$KNOWLEDGE_BASE" diff --cached --quiet`
  - If no changes, tell the user "Nothing to sync — knowledge base is up to date" and exit
- Generate a commit message summarizing what changed by inspecting the staged diff. Format:
  ```
  sync: <summary>
  ```
  Examples:
  - `sync: 3 articles updated in css`
  - `sync: 2 sources ingested, 1 article created in agent-design`
  - `sync: conflict resolved in css/_index.md, 2 articles updated`

### 4. Push

Run `git -C "$KNOWLEDGE_BASE" push`.

If push fails (e.g., rejected due to new remote commits), tell the user and suggest re-running `/kb-sync`.

### 5. Report

Tell the user:
- What was pulled (if anything)
- What was committed and pushed
- Any conflicts that were auto-resolved (and how)
- Current sync state

## What This Skill Does NOT Do

- Create GitHub repos or configure remotes
- Handle git authentication issues
- Sync selectively — it always syncs the entire knowledge base
