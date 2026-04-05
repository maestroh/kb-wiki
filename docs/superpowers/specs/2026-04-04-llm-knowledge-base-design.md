# LLM Knowledge Base — Design Spec

## Overview

A personal knowledge management system where an LLM ingests, compiles, queries, and maintains a wiki of interlinked markdown articles — all viewable in Obsidian. The user provides raw source materials (notes, documents, videos, URLs); the LLM organizes them into a structured, namespaced wiki with cross-references, indexes, and health checks.

The system is split into two repos:

1. **Plugin repo** (`claude-knowledge-plugin`) — A Claude Code plugin containing all skills and preprocessing scripts. Installed once per machine, works from any project directory.
2. **Knowledge repo** (this repo) — Pure data: topics, wiki articles, indexes, Obsidian config. Git-synced across machines. Contains no code.

The plugin finds the knowledge repo via a `KNOWLEDGE_BASE` environment variable, making the system portable across machines with different directory structures. The knowledge repo doubles as an Obsidian vault. No database, no server — files are the data layer.

## Directory Structure

### Knowledge Repo (this repo — pure data)

```
knowledge/
├── topics/
│   └── <topic-name>/
│       ├── raw/                  # original + preprocessed source materials
│       │   ├── notes/            # handwritten notes (.md)
│       │   ├── documents/        # PDFs, PPTs, DOCs + their .md conversions
│       │   ├── videos/           # video files + transcript .md files
│       │   ├── links/            # web clippings saved as .md
│       │   ├── images/           # referenced images
│       │   └── _archive/         # outdated sources excluded from compilation
│       └── wiki/                 # LLM-compiled articles
│           ├── _index.md         # topic index: all articles with one-line summaries
│           └── *.md              # individual concept articles
├── _index.md                     # master index: all topics with summaries + cross-topic connections
├── _health.md                    # latest lint report
├── .obsidian/                    # Obsidian vault config
├── .gitignore
└── CLAUDE.md                     # project instructions for Claude Code
```

### Plugin Repo (`claude-knowledge-plugin`)

```
claude-knowledge-plugin/
├── skills/
│   ├── init/SKILL.md             # /init — scaffold a new knowledge base
│   ├── topic/SKILL.md            # /topic — create topic namespaces
│   ├── ingest/SKILL.md           # /ingest — add source material
│   ├── compile/SKILL.md          # /compile — compile raw into wiki
│   ├── ask/SKILL.md              # /ask — query the knowledge base
│   └── lint/SKILL.md             # /lint — health checks
├── scripts/
│   ├── preprocess-pdf.ts
│   ├── preprocess-video.ts
│   ├── preprocess-url.ts
│   ├── package.json
│   └── tsconfig.json
├── package.json                  # plugin manifest
└── README.md
```

### Conventions

- `_index.md` files exist at the root and in each topic's `wiki/`. These are the LLM's primary navigation aids — read first before diving into articles.
- `raw/` subdirectories are optional organization. Dumping files flat in `raw/` is fine — the LLM sorts it out during compilation.
- Wiki articles use Obsidian-compatible `[[wikilinks]]` for same-topic links and `[[topic-name/article]]` for cross-topic links.
- Preprocessed files live alongside their originals (e.g., `proposal.pptx` and `proposal.md` side by side).
- `_archive/` contains outdated raw sources. The compiler and linter ignore archived files. Nothing is deleted — only archived.

## Skills (Slash Commands)

### `/init [path]`

Initialize a new knowledge base. Creates the full directory structure, CLAUDE.md, root `_index.md`, `.obsidian/` config, `.gitignore`, and initializes a git repo. If `path` is omitted, uses the current directory. Sets `$KNOWLEDGE_BASE` guidance for the user's shell profile.

This is a one-time setup command. If a knowledge base already exists at the path, it should warn and exit without overwriting.

### `/ingest <topic> <file|url|text>`

Add source material to a topic's `raw/` directory.

**Behavior:**
- **File path:** copies into `raw/`, detects type, runs appropriate preprocessor
- **URL:** fetches the page, converts to markdown, downloads referenced images locally
- **Inline text/notes:** saves as a timestamped `.md` in `raw/notes/`

**Preprocessing by type:**
- PDF/DOC/PPT → TypeScript preprocessor extracts text + images into `.md`
- Video → TypeScript preprocessor creates transcript + keyframe screenshots interlaced in `.md`
- URL → fetches page, strips chrome, converts to clean markdown with local images

**After preprocessing:**
- Appends an entry to the topic's `wiki/_index.md` under "Raw Sources (pending)" to flag new uncompiled material
- Does NOT compile into wiki articles — that's `/compile`'s job

**If preprocessor unavailable:** stores raw file as-is and flags as "unprocessed" in the index.

### `/compile [topic]`

Read new/changed raw materials and update the wiki.

**Compilation steps:**

1. **Scan** — Read topic `wiki/_index.md`, diff against `raw/` (excluding `_archive/`) to find new, modified, or removed sources
2. **Extract** — For each new/changed source, extract key concepts, facts, and relationships
3. **Match** — Check if existing wiki articles already cover these concepts
4. **Create/Update** — Write new articles for new concepts, update existing articles with new information. Each article includes:
   - Clear title and one-line summary
   - Core content synthesized across all raw sources touching this concept
   - `[[wikilinks]]` to related articles (same topic and cross-topic)
   - "Sources" section listing which `raw/` files contributed
5. **Prune** — If a raw source was archived or removed, check which articles depended solely on it. Flag for review or remove.
6. **Index** — Update `wiki/_index.md` with current article list, summaries, and compilation status. Update root `_index.md`.

**Key principle:** Wiki articles are synthesized, not 1:1 copies. Multiple raw sources can contribute to one article. One raw source can spawn multiple articles. The LLM decides the right granularity.

**Incremental by default.** Only processes what changed since last run. `_index.md` tracks compilation state. Full recompile available via `/compile --full <topic>`. If no topic specified, compiles all topics with pending changes.

### `/ask <question>`

Query the knowledge base, answer in terminal.

**Navigation strategy (two-hop):**

1. Read root `_index.md` — identify relevant topics
2. Read relevant topic `wiki/_index.md` files — identify specific articles
3. Read those articles — synthesize the answer
4. If needed, go deeper into `raw/` sources for detail

**Output:** conversational answer in the terminal with `[[article]]` citations. When the answer benefits from a visual explanation (architecture, flows, relationships), the LLM generates a mermaid diagram saved as a `.md` file in the relevant topic's `wiki/` directory and references it in the answer. Obsidian renders mermaid natively.

### `/lint [topic]`

Health check the knowledge base. Reports findings — never auto-fixes.

**Four checks:**

1. **Consistency** — Finds contradictions between articles. Cross-references facts against raw sources. Lists contradictions with source citations and suggested resolution.
2. **Completeness** — Finds concepts that are `[[wikilinked]]` but have no article. Finds raw sources with no wiki coverage. Identifies thin articles needing more depth.
3. **Connections** — Scans across topics for related concepts not yet cross-linked. Suggests bridging articles between topics.
4. **Staleness** — Compares raw source modification dates against last compile date. Flags articles needing recompilation. Flags raw sources that may be outdated (contradicted by newer sources) as candidates for `_archive/`.

**Output:** writes report to `_health.md`:

```markdown
# Health Report — YYYY-MM-DD

## Critical (action needed)
- ...

## Warnings
- ...

## Suggestions
- ...
```

### `/topic create <name>`

Bootstrap a new topic namespace.

- Creates full directory structure (`raw/` subdirectories, `wiki/`, `wiki/_index.md`)
- Adds entry to root `_index.md`

## Index File Format

### Root `_index.md`

```markdown
# Knowledge Base Index

## Topics
- [[agent-design]] — Research on agentic AI patterns, tool use, planning (12 articles)
- [[client-acme]] — Acme Corp proposal and requirements (5 articles)

## Cross-Topic Connections
- Agent design patterns are relevant to coding-project-x architecture decisions
```

### Topic `wiki/_index.md`

```markdown
# Agent Design

## Articles
- [[agent-loops]] — How agents structure reasoning and action cycles
- [[tool-use-patterns]] — Common patterns for LLM tool integration

## Raw Sources (compiled)
- raw/documents/anthropic-tool-use-docs.md — compiled 2026-04-04

## Raw Sources (pending)
- raw/links/new-paper-on-agents.md — added 2026-04-04, not yet compiled

## Raw Sources (archived)
- raw/_archive/old-agent-framework-notes.md — archived 2026-04-04
```

## Preprocessing Scripts

Located in the plugin repo at `scripts/`, runnable via `npx tsx scripts/<name>.ts <input> <output-dir>`.

| Script | Input | Output |
|--------|-------|--------|
| `preprocess-pdf.ts` | PDF, DOC, PPT files | `.md` file + extracted images |
| `preprocess-video.ts` | Video files | `.md` (transcript + interlaced screenshots) + frames directory |
| `preprocess-url.ts` | URL string | `.md` file + downloaded images |

Dependencies managed via `scripts/package.json` in the plugin repo. No build step — uses `tsx` for direct TypeScript execution.

## CLAUDE.md

Project instructions for Claude Code. Contents:

- Project overview: "This is an LLM-maintained knowledge base"
- Directory structure conventions (as documented above)
- How `_index.md` files work and that they must always be kept up to date
- Wiki article format: frontmatter, wikilinks, sources section
- Rules:
  - Never edit `raw/` originals
  - Use `_archive/` instead of deleting — nothing is ever deleted
  - Wiki articles are synthesized, not copied from sources
  - Always update indexes after any wiki change

## Obsidian Configuration

Minimal `.obsidian/` config:

- Wikilinks enabled
- `topics/` as default view
- `docs/` excluded from vault file explorer
- Graph view configured for cross-topic connections

## .gitignore

```
.obsidian/workspace.json
.obsidian/workspace-mobile.json
```

## Cross-Project Access & Portability

### Plugin Installation (Primary)

The `claude-knowledge-plugin` is installed as a Claude Code plugin. Once installed, all five skills (`/ingest`, `/compile`, `/ask`, `/lint`, `/topic`) are available from any project directory on that machine.

### Environment Variable

Each machine sets `KNOWLEDGE_BASE` in its shell profile to point to the local clone of the knowledge repo:

```bash
# MacBook Air (home)
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"

# Mac (work)
export KNOWLEDGE_BASE="$HOME/work/knowledge"

# Linux (home)
export KNOWLEDGE_BASE="/home/nael/knowledge"
```

All skills read `$KNOWLEDGE_BASE` to locate the knowledge repo. If unset, skills print an error with setup instructions.

### Multi-Machine Sync

The knowledge repo is a standard git repository. Push/pull keeps machines in sync.

- Markdown files, images, and Obsidian config sync normally via git
- Large binary originals (videos, PDFs, PPTs) in `raw/`: use Git LFS or `.gitignore` them (the preprocessed `.md` conversions are what matter and sync normally)
- `.obsidian/workspace.json` is gitignored (per-user UI state)

### New Machine Setup

1. Install the `claude-knowledge-plugin` (Claude Code plugin)
2. Clone the knowledge repo
3. Set `KNOWLEDGE_BASE` in shell profile
4. Open the knowledge repo directory in Obsidian as a vault

### Lightweight Fallback

For projects where you just want Claude Code to be aware of the wiki without using the plugin's formal skills, add to the project's `CLAUDE.md`:

```markdown
## Knowledge Base
Research wiki lives at $KNOWLEDGE_BASE.
When you need research context:
1. Read $KNOWLEDGE_BASE/_index.md to find relevant topics
2. Read the topic's wiki/_index.md to find relevant articles
3. Read the articles you need
```

This works because the two-hop index navigation is simple enough that Claude Code can follow it with just instructions — no formal skill required.

## Scope & Non-Goals

**In scope for v1:**
- Two-repo architecture: plugin repo (skills + scripts) and knowledge repo (pure data)
- All six skills as a Claude Code plugin: `/init`, `/topic`, `/ingest`, `/compile`, `/ask`, `/lint`
- `KNOWLEDGE_BASE` env var for portability across machines
- Cross-project access via plugin + lightweight CLAUDE.md fallback
- Preprocessing scripts for PDF, video, and URL (in plugin repo)
- CLAUDE.md, Obsidian config, gitignore (in knowledge repo)
- Index-based LLM navigation for Q&A
- Mermaid diagram generation in `/ask` responses
- Git-based multi-machine sync

**Not in scope for v1:**
- Persistent search index or embedding-based retrieval
- Web UI or custom search engine
- Slide or matplotlib visualization output formats
- Synthetic data generation or fine-tuning
- Automated/scheduled compilation or linting
