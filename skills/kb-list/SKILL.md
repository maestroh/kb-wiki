---
name: kb-list
description: List all topics in the knowledge base with article counts and status summaries.
---

# List Knowledge Base Topics

Show an overview of all topics in the knowledge base.

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

### 2. Scan Topics

List all directories under `$KNOWLEDGE_BASE/topics/`. For each topic:

- Count wiki articles: number of `.md` files in `topics/<name>/wiki/` excluding `_index.md`
- Count pending sources: read `topics/<name>/wiki/_index.md` and count entries under `## Raw Sources (pending)`
- Count compiled sources: read `topics/<name>/wiki/_index.md` and count entries under `## Raw Sources (compiled)`

### 3. Display

Present a table to the user:

```
| Topic          | Articles | Compiled | Pending |
|----------------|----------|----------|---------|
| agent-design   | 5        | 8        | 2       |
| css            | 3        | 4        | 0       |
```

If no topics exist, say:
```
No topics yet. Use `/kb-topic create <name>` to create one.
```

After the table, show a one-line summary:
```
<N> topics, <M> total articles, <P> sources pending compilation
```

If any topics have pending sources, suggest running `/kb-compile <topic>`.
