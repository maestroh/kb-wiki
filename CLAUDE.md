# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Claude Code **plugin** (not a standalone app) that provides skills for managing LLM-maintained personal knowledge bases. Two-repo architecture: this repo is the plugin; it manages knowledge repos at whatever path `$KNOWLEDGE_BASE` points to.

## Project Structure

- `skills/` — Skill definitions (each is a `SKILL.md` in its own directory). These are the slash commands users invoke.
- `scripts/` — TypeScript preprocessing pipeline (PDF/DOCX/PPTX, URL, video → markdown)
- `.claude-plugin/` — Plugin metadata (`plugin.json`) and marketplace config (`marketplace.json`)
- `docs/superpowers/` — Design specs and implementation plans (self-contained HTML — see Documentation)

## Commands

```bash
# Run all preprocessor tests
cd scripts && npx vitest run

# Run a single test file
cd scripts && npx vitest run preprocess-url.test.ts

# Run tests in watch mode
cd scripts && npx vitest
```

No build step — skills are plain markdown, scripts run via `tsx`.

## Key Conventions

- All skill names are prefixed with `kb-` to avoid collisions with Claude Code built-in slash commands.
- Skills reference `$KNOWLEDGE_BASE` env var to locate the user's knowledge repo.
- Preprocessing scripts are invoked by skills via `npx tsx <script> <args>` and output JSON to stdout.
- All preprocessors produce markdown with YAML frontmatter (source path/URL, type, date).
- The knowledge base uses `[[wikilinks]]` (Obsidian-compatible) for cross-references.
- `_index.md` files serve as the navigation hub at both root and project levels — skills must keep them in sync.
- `kb-topic` is removed; namespaces are now "projects", auto-resolved during ingest, or explicitly created with `kb-project create`.

## Documentation

Design docs, specs, and implementation plans are authored as **self-contained HTML**, not Markdown, using the `creating-html-documents` skill. HTML carries the diagrams, tables, and structure these documents need, opens anywhere offline, and prints/exports to PDF cleanly. Always invoke that skill before writing one, and verify the result by rendering it (screenshot) before treating it as done. These live in `docs/superpowers/specs/` as `YYYY-MM-DD-<topic>-design.html` and `YYYY-MM-DD-<topic>-plan.html`. Markdown remains fine for READMEs, code comments, and throwaway notes.

## Plugin Distribution

Install via:
```bash
claude plugin marketplace add maestroh/kb-wiki
claude plugin install kb-wiki@kb-wiki
```
