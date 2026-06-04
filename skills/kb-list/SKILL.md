---
name: kb-list
description: List all projects in the knowledge base with article counts and status summaries.
---

# List Knowledge Base Projects

Show an overview of all projects in the knowledge base, read from the root registry.

## Environment

The knowledge base root is at `$KNOWLEDGE_BASE`. If not set, tell the user:
```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

## Usage

`/kb-list`

No arguments.

## Behavior

### 1. Validate

- Check `$KNOWLEDGE_BASE` is set and the directory exists
- Check `$KNOWLEDGE_BASE/_index.md` exists (KB has been initialized)

### 2. Read the registry

Read the root `$KNOWLEDGE_BASE/_index.md` frontmatter. The `projects:` array is the source of truth for which projects exist — do NOT scan the filesystem. Each entry has `name`, `description`, `keywords`, `path`, and `articles`. Use the `articles` field for the article count.

For pending/compiled counts, read each project's `projects/<name>/wiki/_index.md` and count entries under `## Raw Sources (pending)` and `## Raw Sources (compiled)`.

### 3. Display

Present a table to the user:

```
| Project        | Articles | Compiled | Pending |
|----------------|----------|----------|---------|
| agent-design   | 5        | 8        | 2       |
| css            | 3        | 4        | 0       |
```

If the registry has no projects, say:
```
No projects yet. They are auto-created on your first `/kb-ingest`, or explicitly with `/kb-project create <name>`.
```

After the table, show a one-line summary:
```
<N> projects, <M> total articles, <P> sources pending compilation
```

If any projects have pending sources, suggest running `/kb-compile <project>`.
