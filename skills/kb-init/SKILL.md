---
name: kb-init
description: Initialize a new knowledge base. Creates directory structure, CLAUDE.md, indexes, Obsidian config, and git repo. Run once to set up.
---

# Initialize Knowledge Base

Create a new knowledge base at the specified path or at `$KNOWLEDGE_BASE`.

## Environment

The knowledge base path is determined by:
1. An explicit path argument: `/kb-init /path/to/kb`
2. The `$KNOWLEDGE_BASE` environment variable
3. If neither is set, ask the user where they want to create the knowledge base

## Usage

- `/kb-init` — Initialize at `$KNOWLEDGE_BASE`
- `/kb-init /path/to/my-kb` — Initialize at a specific path

## Behavior

### 1. Validate

- Determine the target path (argument > `$KNOWLEDGE_BASE` > ask user)
- If the directory already contains a `CLAUDE.md` and `_index.md`, warn that a knowledge base already exists here and exit without overwriting
- Create the target directory if it doesn't exist

### 2. Create Directory Structure

Create the following empty directory tree:

```
<path>/
├── topics/
├── .obsidian/
└── docs/
```

The `topics/` directory starts empty — topics are created via `/topic create <name>`.

### 3. Create CLAUDE.md

Write `<path>/CLAUDE.md`:

```markdown
# Knowledge Base

This is an LLM-maintained personal knowledge base. The LLM writes and maintains all wiki content — you rarely edit it directly.

## Directory Structure

topics/<topic-name>/
  raw/          — Original + preprocessed source materials
    notes/      — Handwritten notes (.md)
    documents/  — PDFs, PPTs, DOCs + their .md conversions
    videos/     — Video files + transcript .md files
    links/      — Web clippings saved as .md
    images/     — Referenced images
    _archive/   — Outdated sources excluded from compilation
  wiki/         — LLM-compiled articles
    _index.md   — Topic index with article summaries
    *.md        — Individual concept articles
_index.md       — Master index across all topics
_health.md      — Latest lint report

## Rules

- Never edit files in raw/ — they are source-of-truth originals
- Never delete raw sources — move outdated ones to raw/_archive/
- Wiki articles are synthesized from multiple sources, not 1:1 copies
- Always update _index.md files after any wiki change
- Use [[wikilinks]] for same-topic links
- Use [[topic-name/article]] for cross-topic links
- Each wiki article must have a "Sources" section listing contributing raw files

## Index Navigation

When answering questions or compiling:
1. Read root _index.md first to find relevant topics
2. Read topic wiki/_index.md to find specific articles
3. Read articles as needed
4. Go deeper into raw/ sources only if articles lack sufficient detail

## Wiki Article Format

Each wiki article should follow this structure:
- Clear title as H1
- One-line summary in italics below the title
- Core content with [[wikilinks]] to related articles
- ## Sources section at the bottom listing raw files that contributed
```

### 4. Create Root _index.md

Write `<path>/_index.md`:

```markdown
# Knowledge Base Index

## Topics

_No topics yet. Use `/topic create <name>` to create one._

## Cross-Topic Connections

_None yet._
```

### 5. Create .obsidian Config

Write `<path>/.obsidian/app.json`:

```json
{
  "useMarkdownLinks": false,
  "showUnsupportedFiles": false,
  "userIgnoreFilters": ["docs/"]
}
```

Write `<path>/.obsidian/graph.json`:

```json
{
  "collapse-filter": false,
  "search": "",
  "showTags": false,
  "showAttachments": true,
  "hideUnresolved": false,
  "showOrphans": true,
  "collapse-color-groups": false,
  "colorGroups": [],
  "collapse-display": false,
  "lineSizeMultiplier": 1,
  "nodeSizeMultiplier": 1,
  "textFadeMultiplier": 0,
  "collapse-forces": false,
  "centerStrength": 0.518713248970312,
  "repelStrength": 10,
  "linkStrength": 1,
  "linkDistance": 250,
  "scale": 1,
  "close": false
}
```

### 6. Create .gitignore

Write `<path>/.gitignore`:

```
.obsidian/workspace.json
.obsidian/workspace-mobile.json
```

### 7. Initialize Git

Run `git init` in the target directory, then stage and commit all files:

```bash
cd <path>
git init
git add -A
git commit -m "feat: initialize knowledge base"
```

### 8. Guide the User

Tell the user:

1. Knowledge base created at `<path>`
2. If `$KNOWLEDGE_BASE` is not set, tell them to add it to their shell profile:
   ```bash
   export KNOWLEDGE_BASE="<path>"
   ```
3. Open `<path>` as an Obsidian vault to browse the wiki
4. Next step: run `/topic create <name>` to create your first topic
