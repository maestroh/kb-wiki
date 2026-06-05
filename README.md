# kb-wiki

A Claude Code plugin for managing an LLM-maintained personal knowledge base — a portable, git-backed **memory loop** for agents. Capture sources as you work, consolidate them into an interlinked wiki, recall them without going stale, and sync the whole thing to git so the same memory is usable on another machine.

## Setup

### 1. Install the plugin

```bash
# Add the marketplace
claude plugin marketplace add maestroh/kb-wiki

# Install the plugin
claude plugin install kb-wiki@kb-wiki
```

### 2. Set the environment variable

Add this to your `~/.zshrc` (or shell profile):

```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

Then restart your shell or run `source ~/.zshrc`.

### 3. Initialize your knowledge base

Open any repo in Claude Code and run:

```
/kb-init
```

This creates your knowledge base at the path you configured. You can then open `$KNOWLEDGE_BASE` as an [Obsidian](https://obsidian.md) vault.

## How it works

Work is organized into **projects** (`projects/<name>/`). Each project keeps `raw/` (the source of truth — originals are never edited) beside `wiki/` (synthesized, interlinked articles derived from raw).

- **Capture** — `/kb-ingest` stages a source into `raw/` and records it as *pending*. It does not compile.
- **Consolidate** — `/kb-compile` synthesizes pending raw into wiki articles (the one LLM step; deferred).
- **Recall** — `/kb-ask` read-merges `wiki ∪ pending raw`, so answers are fresh even before compilation runs.
- **Persist** — `/kb-sync` (and the session-boundary hooks) commit and push to your GitHub remote.

Projects are auto-resolved during ingest — you rarely name one explicitly. **Core memory** (`/kb-core`) holds small, durable, always-loaded facts about you that apply across all projects.

## Skills

- `/kb-init [path]` — Initialize a new knowledge base
- `/kb-ingest <file|url|text>` — Add source material; the project is resolved automatically
- `/kb-compile [project]` — Compile pending raw sources into wiki articles
- `/kb-ask <question>` — Query the knowledge base (read-merges wiki + pending)
- `/kb-core add|list` — Manage always-loaded durable facts about you
- `/kb-project create <name>` — Explicitly create a project (usually unnecessary)
- `/kb-list` — List all projects with article counts and status
- `/kb-lint [project]` — Health check the knowledge base
- `/kb-sync` — Sync with GitHub (commit, pull --rebase, push)

## Requirements

- **`KNOWLEDGE_BASE`** — environment variable pointing to your KB path (required).
- **`KNOWLEDGE_GIT_TOKEN`** — optional; a token for headless push auth used by `/kb-sync` and the hooks. Never persisted to disk.
- **Node.js 18+** — for the preprocessing scripts.
- **Optional, per source type:**
  - PDF and DOCX — handled in-process (no extra tools).
  - PPTX — `pandoc` (`brew install pandoc` / `apt install pandoc`).
  - Video — `ffmpeg` and `whisper` (`openai-whisper`) for frame extraction and transcription.

## Development

This repo is the **plugin**; it manages a separate knowledge repo at `$KNOWLEDGE_BASE`. Skills are plain markdown over a deterministic TypeScript script layer — no build step.

```bash
cd scripts && npx vitest run        # run all preprocessor + engine tests
```

See `CLAUDE.md` and `docs/superpowers/` for architecture and design specs.
