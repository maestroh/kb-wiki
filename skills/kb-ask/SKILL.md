---
name: kb-ask
description: Query the knowledge base. Resolves the relevant project(s), read-merges synthesized wiki with pending raw so answers are never stale, and synthesizes a cited answer.
---

# Ask the Knowledge Base

## Usage
`/kb-ask <question>`

## Behavior

### 1. Resolve relevant project(s)
Read the root `_index.md` registry frontmatter. Match the question against project descriptions/keywords (you may also run `resolve.ts` with question keywords). Pick the relevant project(s).

### 2. Gather (read-merge)
For each relevant project:
```bash
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/retrieve.ts" "$KNOWLEDGE_BASE" "<project>"
```
Returns `{ articles:[{slug,summary}], pending:[{path,content}] }`. Read the relevant article files for depth, AND read the `pending` raw content. **Merge both** — the wiki gives synthesized depth + cross-links; the pending raw gives the most recent, not-yet-compiled material. This is what keeps answers fresh despite deferred compile.

### 3. Synthesize the answer
Answer conversationally. Cite articles with `[[wikilinks]]`. When you used pending raw, note it ("from a just-added source not yet in the wiki"). Cross-reference projects when relevant.

### 4. Diagrams (when they add clarity)
For architectures/flows/relationships, generate a mermaid diagram and optionally save it to the project's `wiki/` as `diagram-<name>.md` with a Sources section; mention the path.

### 5. Gaps
If the KB lacks the answer, say what you found, where the gaps are, suggest what to ingest, and offer to search the web.

## Principles
- Start from the registry/indexes — never scan the filesystem.
- Always read-merge wiki ∪ pending so recency isn't missed.
- Cite with [[wikilinks]]; be honest about gaps.
