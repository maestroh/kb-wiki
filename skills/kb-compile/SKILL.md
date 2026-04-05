---
name: kb-compile
description: Compile raw source materials into wiki articles. Synthesizes concepts, creates interlinked articles, and maintains indexes.
---

# Compile Wiki

Read new and changed raw materials in a topic and compile them into synthesized wiki articles.

## Environment

The knowledge base root is at `$KNOWLEDGE_BASE`. If not set, tell the user:
```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

## Usage

- `/kb-compile <topic>` — Compile a specific topic
- `/kb-compile` — Compile all topics with pending changes
- `/kb-compile --full <topic>` — Full recompile (ignore previous compilation state)

## Behavior

### 1. Identify What Needs Compilation

Read `$KNOWLEDGE_BASE/topics/<topic>/wiki/_index.md`. Look at the `## Raw Sources (pending)` section for new uncompiled sources. If `--full` flag is used, treat ALL non-archived sources as pending.

If no pending sources exist, tell the user and exit.

### 2. Read and Analyze Raw Sources

For each pending raw source:
1. Read the full content of the file
2. Extract key concepts, facts, claims, and relationships
3. Note what topics/concepts this source is about

### 3. Match Against Existing Wiki

Read the existing wiki articles listed in `_index.md`. For each concept found in the raw sources:
- Does an existing article already cover this concept? → Update it
- Is this a new concept? → Create a new article

### 4. Create/Update Wiki Articles

For each wiki article to create or update:

**Article format:**

```markdown
# <Concept Title>

*<One-line summary of the concept>*

<Main content — synthesized from all contributing sources. Do NOT copy verbatim. Write a clear, informative article that weaves together information from multiple sources. Use your own structure and organization.>

<Include [[wikilinks]] to other articles in this topic where concepts are related.>

<For cross-topic connections, use [[topic-name/article-name]] format.>

## Sources

- `raw/documents/paper-on-agents.md` — primary source for agent loop description
- `raw/notes/2026-04-03-thoughts.md` — additional context on planning strategies
```

**Key principles:**
- Articles are SYNTHESIZED, not copied. Multiple sources contribute to one article. One source may spawn multiple articles.
- Use clear, concise language. The wiki is a reference, not a transcript.
- Link generously using [[wikilinks]] — connections are the wiki's power.
- Every article MUST have a Sources section.

### 5. Check for Cross-Topic Connections

After updating this topic's articles, read the root `_index.md` to see other topics. If any concepts in the newly compiled articles relate to other topics:
- Add [[other-topic/article]] wikilinks in the article body
- Update the root `_index.md` `## Cross-Topic Connections` section

### 6. Update Indexes

**Topic index** (`wiki/_index.md`):
- Move compiled sources from `## Raw Sources (pending)` to `## Raw Sources (compiled)` with today's date
- Update the `## Articles` section with any new or removed articles and their one-line summaries

**Root index** (`_index.md`):
- Update the article count for this topic
- Update the topic's one-line description if it has evolved
- Update cross-topic connections

### 7. Report

Tell the user:
- How many raw sources were compiled
- How many new articles were created
- How many existing articles were updated
- Any cross-topic connections found
- Suggest running `/kb-lint <topic>` to check quality

## Handling Large Topics

If a topic has many pending sources (more than ~10), process them in batches:
1. Read all pending sources first to get a full picture of concepts
2. Plan which articles to create/update
3. Write articles in batches of 3-5
4. Update indexes after each batch

This prevents context overflow and ensures each article gets proper attention.
