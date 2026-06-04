---
name: kb-init
description: Initialize a new knowledge base. Creates the projects/core layout, CLAUDE.md, root registry index, Obsidian config, and git repo. Run once to set up.
---

# Initialize Knowledge Base

Create a new knowledge base at the path argument or `$KNOWLEDGE_BASE`.

## Behavior

### 1. Validate
- Target path = argument > `$KNOWLEDGE_BASE` > ask the user.
- If a legacy `topics/` directory exists (old layout), run the migration instead — check this BEFORE the "already initialized" guard below, since an old KB also has `CLAUDE.md` + `_index.md`:
  `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.ts" "<path>"` and report its JSON result, then skip to step 7.
- Otherwise, if the new layout already exists (`CLAUDE.md` + `_index.md` present, no `topics/`), warn and exit without overwriting.

### 2. Create directory tree
```
<path>/
├── projects/        # one dir per project (created on demand)
├── core/            # always-loaded core memory
├── .obsidian/
└── docs/
```

### 3. Create `core/_index.md`
```markdown
---
kind: kb-core
version: 1
---

# Core Memory

_Durable, always-loaded facts about the user. Maintained via `/kb-core`._
```

### 4. Create root `_index.md` (the registry)
```markdown
---
kind: kb-root
version: 1
projects: []
---

# Knowledge Base Index

## Projects

_No projects yet. They are created automatically the first time you ingest, or explicitly with `/kb-project create <name>`._

## Cross-Project Connections

_None yet._
```

### 5. Create `CLAUDE.md`
```markdown
# Knowledge Base

An LLM-maintained personal knowledge base. The LLM writes and maintains wiki content.

## Layout
projects/<name>/
  raw/        — source-of-truth originals (notes, documents, videos, links, images, _archive)
  planning/   — plans, specs, todos
  assets/     — datasets, designs, large artifacts
  wiki/       — synthesized articles + _index.md
core/_index.md — always-loaded durable facts about the user
_index.md      — root registry (frontmatter `projects:`) + cross-project connections

## Rules
- Never edit raw/ — originals; archive outdated ones to raw/_archive/.
- raw/ is the source of truth; wiki/ is derived via /kb-compile. Deferring compile never loses data.
- Wiki articles are synthesized from multiple sources, each with a Sources section.
- Same-project links: [[article]]. Cross-project: [[projects/<other>/wiki/<article>]].
- The root registry frontmatter is the source of truth for which projects exist.
```

### 6. Obsidian config + `.gitignore`
- `.obsidian/app.json`: `{ "useMarkdownLinks": false, "showUnsupportedFiles": false, "userIgnoreFilters": ["docs/"] }`
- `.gitignore`:
  ```
  .obsidian/workspace.json
  .obsidian/workspace-mobile.json
  .kb-active
  ```

### 7. Git init + commit
```bash
cd <path> && git init && git add -A && git commit -m "feat: initialize knowledge base"
```

### 8. Guide the user
Report the path; remind them to `export KNOWLEDGE_BASE="<path>"`; open as an Obsidian vault; next step is just to start ingesting — projects are auto-created.
