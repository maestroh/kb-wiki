---
name: kb-project
description: Explicitly create a project namespace. Usually unnecessary — projects are auto-created during ingest — but available when you want to force creation.
---

# Project Management

Projects are normally resolved/created automatically during `/kb-ingest`. Use this only to create one explicitly.

## Usage
`/kb-project create <name>` — `<name>` is kebab-case (e.g. `acme-redesign`).

## Behavior (create)
1. Validate `$KNOWLEDGE_BASE` is set and `_index.md` exists; `<name>` is kebab-case and not already in the registry.
2. Create dirs: `projects/<name>/raw/{notes,documents,videos,links,images,_archive}`, `projects/<name>/{planning,assets}`, `projects/<name>/wiki/`.
3. Write `projects/<name>/wiki/_index.md`:
   ```markdown
   ---
   kind: kb-project
   name: <name>
   description: <one-line, from the user or inferred>
   keywords: []
   created: <YYYY-MM-DD>
   ---

   # <Name (title case)>

   ## Articles

   _No articles yet._

   ## Raw Sources (pending)

   _None._

   ## Raw Sources (compiled)

   _None._

   ## Raw Sources (archived)

   _None._
   ```
4. Add the project to the root `_index.md` registry frontmatter (`projects:` entry with `name`, `description`, `keywords`, `path: projects/<name>`, `articles: 0`) and to the `## Projects` body list.
5. Confirm and suggest `/kb-ingest`.
