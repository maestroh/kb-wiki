---
name: kb-compile
description: Compile pending raw sources into synthesized wiki articles. Reads a deterministic brief, synthesizes articles, and commits them via the contract scripts.
---

# Compile Wiki

Turn a project's pending raw sources into synthesized, interlinked wiki articles. You (the in-loop reasoner) do the synthesis; the scripts do all deterministic I/O.

## Usage
- `/kb-compile <project>` — compile one project
- `/kb-compile` — resolve the active project (`.kb-active`) or ask

## Behavior

### 1. Get the brief
```bash
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/compile-plan.ts" "$KNOWLEDGE_BASE" "<project>"
```
Returns `{ project, existingArticles:[{slug,summary}], pendingSources:[{path,content}] }`.
If `pendingSources` is empty, report "nothing to compile" and exit.

### 2. Synthesize article operations
Read every pending source's content and the existing article list. Decide, for each concept:
- matches an existing article → `op: "update"` (same slug)
- new concept → `op: "create"` (new kebab-case slug)

Produce a `CommitInput` JSON object:
```json
{
  "project": "<project>",
  "articles": [
    { "op": "create|update", "slug": "<kebab>", "title": "<Title>",
      "summary": "<one line>", "body": "<synthesized markdown with [[wikilinks]]>",
      "sources": ["raw/.../file.md", "..."] }
  ],
  "consumedPending": ["raw/.../file.md", "..."],
  "archivedPending": []
}
```
Rules: articles are SYNTHESIZED (not copied); link generously with `[[wikilinks]]`; cross-project links use `[[projects/<other>/wiki/<article>]]`; every article lists its contributing `sources`; `consumedPending` is exactly the pending paths you incorporated. Account for **every** pending source — each path goes in `consumedPending` (you incorporated it into an article) or `archivedPending` (you reviewed it and it held nothing durable). After a full compile, pending must be empty.

### 3. Commit
Write the `CommitInput` JSON to a temp file and feed it on stdin — a temp file avoids shell-quoting issues, since synthesized article bodies routinely contain apostrophes and newlines that would break a quoted `echo`:
```bash
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/compile-commit.ts" "$KNOWLEDGE_BASE" < /tmp/kb-commit-input.json
```
It validates, writes articles, moves consumed sources pending→compiled, updates both indexes, and returns `{written, updated, pendingRemaining}`. If it errors (validation), fix the JSON and retry — nothing was written.

### 4. Report
Summarize written/updated counts and `pendingRemaining`; suggest `/kb-lint <project>`.

## Large topics
If there are many pending sources, synthesize in batches of 3–5 and call `compile-commit` per batch (each batch's `consumedPending` covers only that batch).
