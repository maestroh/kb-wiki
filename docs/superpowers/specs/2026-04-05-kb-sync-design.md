# `/kb-sync` Skill Design

## Purpose

Commit and sync knowledge base changes with a configured GitHub remote. Handles pull, conflict resolution, commit, and push in one command.

## Usage

`/kb-sync`

No arguments. Operates on `$KNOWLEDGE_BASE`.

## Behavior

### 1. Validate

- Check `$KNOWLEDGE_BASE` is set and the directory exists
- Check it's a git repo (`git rev-parse --git-dir`)
- Check a remote is configured (`git remote`). If no remote exists, tell the user to add one:
  ```
  No remote configured. Add one with: git remote add origin <url>
  ```
  Exit without further action.

### 2. Pull

Run `git pull --rebase` to incorporate remote changes.

If no conflicts, proceed to step 3.

If conflicts arise, attempt auto-resolution using these rules:

| File type | Strategy | Rationale |
|-----------|----------|-----------|
| `_index.md` files | Union merge (accept both sides) | Append-mostly lists; both additions are valid |
| Wiki articles (`wiki/*.md` except `_index.md`) | Keep remote, save local as `<filename>.local.md` | Remote is the last-synced truth; local draft preserved for manual review |
| Raw sources (`raw/**`) | Keep remote | Raw files are source-of-truth originals and shouldn't diverge |

If auto-resolution fails on any file, list the remaining conflicts and ask the user what to do. Do not proceed with commit/push until all conflicts are resolved.

### 3. Commit

- Stage all changes: `git add -A`
- Generate a descriptive commit message summarizing what changed. Format:
  ```
  sync: <summary>
  ```
  Examples:
  - `sync: 3 articles updated in css`
  - `sync: 2 sources ingested, 1 article created in agent-design`
  - `sync: conflict resolved in css/_index.md, 2 articles updated`

### 4. Push

Run `git push`. If push fails (e.g., rejected due to new remote commits), report the error and suggest re-running `/kb-sync`.

### 5. Report

Tell the user:
- What was pulled (if anything)
- What was committed and pushed
- Any conflicts that were auto-resolved (and how)
- Current sync state (up to date, or issues remaining)

## What This Skill Does NOT Do

- Create GitHub repos or configure remotes (user responsibility)
- Handle authentication issues (user must have git credentials configured)
- Sync selectively — it always syncs the entire knowledge base
