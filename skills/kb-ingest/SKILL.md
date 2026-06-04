---
name: kb-ingest
description: Add source material (files, URLs, or notes) to the knowledge base. Resolves the project automatically, stages raw material, and records it as pending. Does not compile.
---

# Ingest Source Material

Stage a source into a project's `raw/` and record it as pending. Compilation is deferred (see `/kb-compile`).

## Environment
`$KNOWLEDGE_BASE` must be set. Scripts live at `${CLAUDE_PLUGIN_ROOT}/scripts/`.

## Behavior

### 1. Resolve the project
Gather signals: the current working directory's basename (as the `name` signal) and keywords from the source/conversation. Run:
```bash
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/resolve.ts" "$KNOWLEDGE_BASE" "<cwd-basename-or-empty>" <keyword...>
```
- `status: "match"` → use `project`.
- `status: "ambiguous"` → ask the user to pick from `candidates` (one question, then proceed).
- `status: "none"` → propose a new project name + one-line description + keywords, confirm with the user, then create it via the `/kb-project` logic (Task 6).

Write the chosen project name to `$KNOWLEDGE_BASE/.kb-active` (so hooks know the active project).

### 2. Stage the source
- **URL** → preprocess with `preprocess-url.ts` into `projects/<p>/raw/links/`, then record that produced file as a note ingest (or, if preprocessing is unavailable, fetch + save manually). 
- **Document** (`.pdf/.docx/.pptx`) or **video** → run the matching `preprocess-*.ts` into the right `raw/` subdir; the original is also kept.
- **File / inline text** → call ingest directly:
  ```bash
  npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/ingest.ts" "$KNOWLEDGE_BASE" "<project>" file "<path>"
  # or
  npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/ingest.ts" "$KNOWLEDGE_BASE" "<project>" note "<text>"
  ```
  `ingest.ts` copies/writes into `raw/` and records the file under `## Raw Sources (pending)`.

### 3. Confirm
Report what was staged, where, and the resulting `pendingCount`. Do NOT compile — mention `/kb-compile <project>` is available, but it also happens automatically at session boundaries.
