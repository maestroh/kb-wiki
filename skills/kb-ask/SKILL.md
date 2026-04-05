---
name: kb-ask
description: Query the knowledge base. Navigates indexes to find relevant articles and synthesizes an answer with optional mermaid diagrams.
---

# Ask the Knowledge Base

Answer questions by researching the wiki using index-based navigation.

## Environment

The knowledge base root is at `$KNOWLEDGE_BASE`. If not set, tell the user:
```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

## Usage

`/kb-ask <question>`

The question can be anything — factual, analytical, comparative, exploratory.

## Behavior

### 1. Navigate to Relevant Content (Two-Hop Strategy)

**Hop 1:** Read `$KNOWLEDGE_BASE/_index.md`. Identify which topics are relevant to the question based on topic names and descriptions.

**Hop 2:** For each relevant topic, read `$KNOWLEDGE_BASE/topics/<topic>/wiki/_index.md`. Identify which specific articles are likely to contain the answer based on article titles and summaries.

**Read:** Read the relevant wiki articles. If the question requires depth beyond what the articles provide, go deeper into the `raw/` sources cited in the articles' Sources sections.

### 2. Synthesize the Answer

Answer the question conversationally in the terminal. Include:
- The direct answer to the question
- `[[article]]` citations so the user can read further in Obsidian
- Relevant context from multiple articles/topics if applicable

### 3. Generate Diagrams (When Appropriate)

If the answer involves architecture, flows, relationships, processes, or hierarchies that would be clearer as a visual:

1. Generate a mermaid diagram
2. Save it as a `.md` file in the relevant topic's `wiki/` directory with a descriptive name (e.g., `diagram-agent-loop-flow.md`):

```markdown
# <Diagram Title>

*Generated from `/kb-ask` query: "<original question>"*

```mermaid
<diagram content>
```

## Sources
- [[article-1]] — <what it contributed to the diagram>
- [[article-2]] — <what it contributed>
```

3. Reference the diagram in your terminal answer: "I've also generated a diagram at `wiki/diagram-<name>.md` that you can view in Obsidian."

Only generate diagrams when they genuinely add clarity. Simple factual questions don't need diagrams.

### 4. Handle Missing Information

If the wiki doesn't contain enough information to answer the question:
- Say what you did find and where the gaps are
- Suggest what raw sources might help (e.g., "Adding a paper on X to the `agent-design` topic would help answer this")
- Offer to search the web for supplementary information

## Principles

- Always start from the indexes — don't scan the filesystem
- Cite your sources with [[wikilinks]]
- Cross-reference across topics when relevant
- Be honest about gaps in the knowledge base
