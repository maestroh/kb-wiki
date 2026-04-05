---
name: topic
description: Create a new topic namespace in the knowledge base. Use when starting research on a new subject.
---

# Topic Management

Create and manage topic namespaces in the knowledge base.

## Environment

The knowledge base root is at the path specified by the `KNOWLEDGE_BASE` environment variable. If this variable is not set, tell the user to set it in their shell profile:

```bash
export KNOWLEDGE_BASE="$HOME/Projects/knowledge"
```

## Usage

`/topic create <name>`

The `<name>` argument is the topic name. Use kebab-case (e.g., `agent-design`, `client-acme`, `project-x`).

## Behavior

When the user runs `/topic create <name>`:

1. **Validate** — Check that `$KNOWLEDGE_BASE` is set and the directory exists. Check that `$KNOWLEDGE_BASE/_index.md` exists (KB has been initialized). Check that `topics/<name>` does not already exist.

2. **Create directory structure** — Create all of these directories:
   - `$KNOWLEDGE_BASE/topics/<name>/raw/notes/`
   - `$KNOWLEDGE_BASE/topics/<name>/raw/documents/`
   - `$KNOWLEDGE_BASE/topics/<name>/raw/videos/`
   - `$KNOWLEDGE_BASE/topics/<name>/raw/links/`
   - `$KNOWLEDGE_BASE/topics/<name>/raw/images/`
   - `$KNOWLEDGE_BASE/topics/<name>/raw/_archive/`
   - `$KNOWLEDGE_BASE/topics/<name>/wiki/`

3. **Create topic index** — Write `$KNOWLEDGE_BASE/topics/<name>/wiki/_index.md`:

```markdown
# <Name (title case)>

## Articles

_No articles yet. Use `/compile <name>` after adding raw sources._

## Raw Sources (compiled)

_None._

## Raw Sources (pending)

_None._

## Raw Sources (archived)

_None._
```

4. **Update root index** — Read `$KNOWLEDGE_BASE/_index.md` and add the new topic to the `## Topics` section. If the placeholder text "_No topics yet..." exists, replace it. Add the entry as:
   ```
   - [[<name>]] — <brief description based on the name> (0 articles)
   ```

5. **Confirm** — Tell the user the topic was created and suggest next steps:
   - Drop files into `topics/<name>/raw/` or use `/ingest <name> <file>`
   - Run `/compile <name>` when ready to build wiki articles
