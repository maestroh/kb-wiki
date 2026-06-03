# kb-wiki Skills & Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Claude Code front-end — the `kb-*` skills and the plugin hooks — as thin wrappers over the Layer-1 scripts, implementing the new project/core-memory model, deferred compile, and read-merge query.

**Architecture:** SKILL.md files contain orchestration + judgment only; all mechanical work calls the Layer-1 scripts (`resolve`, `ingest`, `compile-plan`, `compile-commit`, `retrieve`, `core`, `sync`, `migrate`) via `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.ts"`. Hooks ship in-plugin: `SessionEnd` syncs; `PreCompact` persists recent context to `raw/` then syncs. A gitignored `.kb-active` pointer (written by the resolution step) tells the hooks which project is active.

**Tech Stack:** Markdown SKILL.md files, plugin hook JSON, one small `tsx` hook helper. Depends on Plans 1–2 (scripts) and Plan 4 (`sync.ts`, `migrate.ts`).

**Scope note — this is Plan 3 of the sequence.** Mostly content-authoring, not TDD. Verification steps are structural checks plus end-to-end smoke tests against a scratch KB.

**Script CLI contracts wired by these skills:**
- `resolve.ts <kbRoot> <name|""> <kw...>` → `{status:"match"|"ambiguous"|"none", project?, candidates?}`
- `ingest.ts <kbRoot> <project> note "<text>"` | `ingest.ts <kbRoot> <project> file <path>` → `{path, pendingCount}`
- `compile-plan.ts <kbRoot> <project>` → `{project, existingArticles, pendingSources:[{path,content}]}`
- `compile-commit.ts <kbRoot>` (CommitInput JSON on stdin) → `{written, updated, pendingRemaining}`
- `retrieve.ts <kbRoot> <project>` → `{project, articles, pending:[{path,content}]}`
- `core.ts add "<fact>"` | `core.ts list` (reads `KNOWLEDGE_BASE`) → `{added}` | `{facts}`
- `sync.ts <repoDir>` (reads `KNOWLEDGE_GIT_TOKEN`) → `{committed, pushed, files}`
- `migrate.ts <kbRoot>` → `{renamed, linksRewritten, indexesUpgraded}`

---

### Task 1: Rewrite `kb-init` for the new layout

**Files:**
- Modify: `skills/kb-init/SKILL.md` (full rewrite)

- [ ] **Step 1: Replace the SKILL.md body**

Write `skills/kb-init/SKILL.md`:

````markdown
---
name: kb-init
description: Initialize a new knowledge base. Creates the projects/core layout, CLAUDE.md, root registry index, Obsidian config, and git repo. Run once to set up.
---

# Initialize Knowledge Base

Create a new knowledge base at the path argument or `$KNOWLEDGE_BASE`.

## Behavior

### 1. Validate
- Target path = argument > `$KNOWLEDGE_BASE` > ask the user.
- If `CLAUDE.md` + `_index.md` already exist there, warn and exit without overwriting.
- If a legacy `topics/` directory exists (old layout), run the migration instead:
  `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/migrate.ts" "<path>"` and report its JSON result, then skip to step 7.

### 2. Create directory tree
```
<path>/
├── projects/        # one dir per project (created on demand)
├── core/            # always-loaded core memory
├── .obsidian/
└── docs/
```

### 3. Create `core/_index.md`
```markdown
---
kind: kb-core
version: 1
---

# Core Memory

_Durable, always-loaded facts about the user. Maintained via `/kb-core`._
```

### 4. Create root `_index.md` (the registry)
```markdown
---
kind: kb-root
version: 1
projects: []
---

# Knowledge Base Index

## Projects

_No projects yet. They are created automatically the first time you ingest, or explicitly with `/kb-project create <name>`._

## Cross-Project Connections

_None yet._
```

### 5. Create `CLAUDE.md`
```markdown
# Knowledge Base

An LLM-maintained personal knowledge base. The LLM writes and maintains wiki content.

## Layout
projects/<name>/
  raw/        — source-of-truth originals (notes, documents, videos, links, images, _archive)
  planning/   — plans, specs, todos
  assets/     — datasets, designs, large artifacts
  wiki/       — synthesized articles + _index.md
core/_index.md — always-loaded durable facts about the user
_index.md      — root registry (frontmatter `projects:`) + cross-project connections

## Rules
- Never edit raw/ — originals; archive outdated ones to raw/_archive/.
- raw/ is the source of truth; wiki/ is derived via /kb-compile. Deferring compile never loses data.
- Wiki articles are synthesized from multiple sources, each with a Sources section.
- Same-project links: [[article]]. Cross-project: [[projects/<other>/wiki/<article>]].
- The root registry frontmatter is the source of truth for which projects exist.
```

### 6. Obsidian config + `.gitignore`
- `.obsidian/app.json`: `{ "useMarkdownLinks": false, "showUnsupportedFiles": false, "userIgnoreFilters": ["docs/"] }`
- `.gitignore`:
  ```
  .obsidian/workspace.json
  .obsidian/workspace-mobile.json
  .kb-active
  ```

### 7. Git init + commit
```bash
cd <path> && git init && git add -A && git commit -m "feat: initialize knowledge base"
```

### 8. Guide the user
Report the path; remind them to `export KNOWLEDGE_BASE="<path>"`; open as an Obsidian vault; next step is just to start ingesting — projects are auto-created.
````

- [ ] **Step 2: Verify the file is valid**

Run: `head -4 skills/kb-init/SKILL.md`
Expected: YAML frontmatter with `name: kb-init` and a `description:`.

- [ ] **Step 3: Commit**

```bash
git add skills/kb-init/SKILL.md
git commit -m "feat: rewrite kb-init for projects/core layout"
```

---

### Task 2: Rewrite `kb-ingest` (resolve + stage, no compile)

**Files:**
- Modify: `skills/kb-ingest/SKILL.md` (full rewrite)

- [ ] **Step 1: Replace the SKILL.md body**

Write `skills/kb-ingest/SKILL.md`:

````markdown
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
````

- [ ] **Step 2: Verify**

Run: `head -4 skills/kb-ingest/SKILL.md`
Expected: frontmatter with `name: kb-ingest`.

- [ ] **Step 3: Commit**

```bash
git add skills/kb-ingest/SKILL.md
git commit -m "feat: rewrite kb-ingest as resolve+stage wrapper"
```

---

### Task 3: Rewrite `kb-compile` (plan → synthesize → commit)

**Files:**
- Modify: `skills/kb-compile/SKILL.md` (full rewrite)

- [ ] **Step 1: Replace the SKILL.md body**

Write `skills/kb-compile/SKILL.md`:

````markdown
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
  "consumedPending": ["raw/.../file.md", "..."]
}
```
Rules: articles are SYNTHESIZED (not copied); link generously with `[[wikilinks]]`; cross-project links use `[[projects/<other>/wiki/<article>]]`; every article lists its contributing `sources`; `consumedPending` is exactly the pending paths you incorporated.

### 3. Commit
Pipe the JSON to:
```bash
echo '<CommitInput JSON>' | npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/compile-commit.ts" "$KNOWLEDGE_BASE"
```
It validates, writes articles, moves consumed sources pending→compiled, updates both indexes, and returns `{written, updated, pendingRemaining}`. If it errors (validation), fix the JSON and retry — nothing was written.

### 4. Report
Summarize written/updated counts and `pendingRemaining`; suggest `/kb-lint <project>`.

## Large topics
If there are many pending sources, synthesize in batches of 3–5 and call `compile-commit` per batch (each batch's `consumedPending` covers only that batch).
````

- [ ] **Step 2: Verify**

Run: `head -4 skills/kb-compile/SKILL.md`
Expected: frontmatter with `name: kb-compile`.

- [ ] **Step 3: Commit**

```bash
git add skills/kb-compile/SKILL.md
git commit -m "feat: rewrite kb-compile as plan/synthesize/commit flow"
```

---

### Task 4: Rewrite `kb-ask` (read-merge)

**Files:**
- Modify: `skills/kb-ask/SKILL.md` (full rewrite)

- [ ] **Step 1: Replace the SKILL.md body**

Write `skills/kb-ask/SKILL.md`:

````markdown
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
````

- [ ] **Step 2: Verify**

Run: `head -4 skills/kb-ask/SKILL.md`
Expected: frontmatter with `name: kb-ask`.

- [ ] **Step 3: Commit**

```bash
git add skills/kb-ask/SKILL.md
git commit -m "feat: rewrite kb-ask with read-merge"
```

---

### Task 5: New `kb-core` skill

**Files:**
- Create: `skills/kb-core/SKILL.md`

- [ ] **Step 1: Write the SKILL.md**

Write `skills/kb-core/SKILL.md`:

````markdown
---
name: kb-core
description: Manage core memory — small, always-loaded durable facts about the user that apply across all projects.
---

# Core Memory

Add or list durable cross-project facts about the user (preferences, role, standing context). Stored in `core/_index.md`, deduplicated.

## Usage
- `/kb-core add <fact>` — add a fact (no-op if a duplicate already exists)
- `/kb-core list` — list current facts

## Behavior

**Add:**
```bash
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/core.ts" add "<fact>"
```
Returns `{added: true|false}` (`false` = duplicate). Report which.

**List:**
```bash
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/core.ts" list
```
Returns `{facts: [...]}`.

## When to use
Use for facts true regardless of project ("prefers TypeScript", "works at X"). Project-specific knowledge belongs in that project's wiki via `/kb-ingest`, not here. You may proactively offer to remember a clearly-durable fact you notice in conversation.
````

- [ ] **Step 2: Verify**

Run: `head -4 skills/kb-core/SKILL.md`
Expected: frontmatter with `name: kb-core`.

- [ ] **Step 3: Commit**

```bash
git add skills/kb-core/SKILL.md
git commit -m "feat: add kb-core skill"
```

---

### Task 6: Replace `kb-topic` with `kb-project`

**Files:**
- Create: `skills/kb-project/SKILL.md`
- Delete: `skills/kb-topic/` (whole directory)
- Modify: `CLAUDE.md` (repo root — note the deprecation)

- [ ] **Step 1: Write the new skill**

Write `skills/kb-project/SKILL.md`:

````markdown
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
````

- [ ] **Step 2: Delete the deprecated skill**

```bash
git rm -r skills/kb-topic
```
Expected: `skills/kb-topic/SKILL.md` removed.

- [ ] **Step 3: Note the change in repo `CLAUDE.md`**

In `/Users/nael/Projects/kb-wiki/CLAUDE.md`, under "Key Conventions", update the wording from `topic`/`topics/` to `project`/`projects/`, and add a line:
> `kb-topic` is removed; namespaces are now "projects", auto-resolved during ingest, or explicitly created with `kb-project create`.

- [ ] **Step 4: Commit**

```bash
git add skills/kb-project/SKILL.md CLAUDE.md && git rm -r --cached skills/kb-topic 2>/dev/null; git add -A skills/kb-topic
git commit -m "feat: replace kb-topic with kb-project escape hatch"
```

---

### Task 7: Ship `SessionEnd` + `PreCompact` hooks in-plugin

**Files:**
- Modify: `.claude-plugin/plugin.json` (add `hooks` reference)
- Create: `hooks/hooks.json`
- Create: `hooks/session-end.sh`
- Create: `hooks/pre-compact.sh`
- Create: `scripts/hook-precompact.ts`
- Test: `scripts/hook-precompact.test.ts`

- [ ] **Step 1: Reference hooks from `plugin.json`**

Edit `.claude-plugin/plugin.json` to add a `"hooks"` key alongside `"skills"`:
```json
{
  "name": "kb-wiki",
  "description": "Skills for ingesting, compiling, querying, and maintaining an LLM-powered personal knowledge base",
  "version": "0.5.0",
  "author": { "name": "nael" },
  "license": "MIT",
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json"
}
```
(Also bump `version` to `0.5.0` for the redesign.)

- [ ] **Step 2: Write `hooks/hooks.json`**

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/session-end.sh\"" }
        ]
      }
    ],
    "PreCompact": [
      {
        "hooks": [
          { "type": "command", "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-compact.sh\"" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Write `hooks/session-end.sh`**

```bash
#!/usr/bin/env bash
# Flush: sync the KB on session end. No-op if KB isn't set up.
set -euo pipefail
[ -n "${KNOWLEDGE_BASE:-}" ] || exit 0
[ -d "${KNOWLEDGE_BASE}/.git" ] || exit 0
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/sync.ts" "${KNOWLEDGE_BASE}" >/dev/null 2>&1 || true
exit 0
```

- [ ] **Step 4: Write `hooks/pre-compact.sh`**

```bash
#!/usr/bin/env bash
# Before context is summarized: persist recent transcript to raw, then sync.
# Receives hook JSON on stdin (includes transcript_path). Lossless: over-capture
# is fine — compile distills later. Reads active project from $KNOWLEDGE_BASE/.kb-active.
set -euo pipefail
[ -n "${KNOWLEDGE_BASE:-}" ] || exit 0
[ -d "${KNOWLEDGE_BASE}/.git" ] || exit 0
INPUT="$(cat)"
echo "$INPUT" | npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/hook-precompact.ts" "${KNOWLEDGE_BASE}" >/dev/null 2>&1 || true
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/sync.ts" "${KNOWLEDGE_BASE}" >/dev/null 2>&1 || true
exit 0
```

- [ ] **Step 5: Write the failing test for the hook helper**

Create `scripts/hook-precompact.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractRecentText, persistRecency } from "./hook-precompact.js";
import { parseDoc } from "./contract.js";
import { listPending } from "./index-sections.js";

describe("extractRecentText", () => {
  it("pulls text from transcript JSONL user/assistant lines", () => {
    const jsonl = [
      JSON.stringify({ type: "user", message: { content: "hello" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi there" }] } }),
      "not json",
    ].join("\n");
    const text = extractRecentText(jsonl, 10);
    expect(text).toContain("hello");
    expect(text).toContain("hi there");
  });
});

describe("persistRecency", () => {
  let kb: string;
  beforeEach(() => {
    kb = mkdtempSync(join(tmpdir(), "kb-precompact-"));
    const wiki = join(kb, "projects", "active", "wiki");
    mkdirSync(wiki, { recursive: true });
    writeFileSync(
      join(wiki, "_index.md"),
      ["---","kind: kb-project","name: active","description: d","keywords: []","created: 2026-06-01","---","","## Articles","","_No articles yet._","","## Raw Sources (pending)","","_None._","","## Raw Sources (compiled)","","_None._"].join("\n")
    );
    writeFileSync(join(kb, ".kb-active"), "active");
  });
  afterEach(() => rmSync(kb, { recursive: true, force: true }));

  it("ingests recent text as a note into the active project", () => {
    persistRecency(kb, "some recent conversation worth keeping");
    const { body } = parseDoc(readFileSync(join(kb, "projects", "active", "wiki", "_index.md"), "utf-8"));
    expect(listPending(body)).toHaveLength(1);
  });

  it("no-ops when there is no active project pointer", () => {
    rmSync(join(kb, ".kb-active"));
    expect(() => persistRecency(kb, "x")).not.toThrow();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd scripts && npx vitest run hook-precompact.test.ts`
Expected: FAIL — cannot resolve `./hook-precompact.js`.

- [ ] **Step 7: Write `scripts/hook-precompact.ts`**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "./ingest.js";

export function extractRecentText(jsonl: string, maxLines: number): string {
  const lines = jsonl.split("\n").filter(Boolean).slice(-maxLines);
  const parts: string[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const content = obj?.message?.content;
      if (typeof content === "string") parts.push(content);
      else if (Array.isArray(content)) {
        for (const c of content) if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
      }
    } catch {
      // skip non-JSON lines
    }
  }
  return parts.join("\n\n").trim();
}

export function persistRecency(kbRoot: string, text: string): void {
  const pointer = join(kbRoot, ".kb-active");
  if (!existsSync(pointer) || !text.trim()) return;
  const project = readFileSync(pointer, "utf-8").trim();
  if (!project) return;
  const wikiIndex = join(kbRoot, "projects", project, "wiki", "_index.md");
  if (!existsSync(wikiIndex)) return;
  ingest(kbRoot, project, { kind: "note", text: `# Pre-compaction snapshot\n\n${text}` });
}

// CLI: hook-precompact.ts <kbRoot>   (hook JSON on stdin, with transcript_path)
const [, , kbRootArg] = process.argv;
if (kbRootArg) {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(raw || "{}");
      const tpath = input.transcript_path;
      const jsonl = tpath && existsSync(tpath) ? readFileSync(tpath, "utf-8") : "";
      persistRecency(kbRootArg, extractRecentText(jsonl, 40));
    } catch {
      // hooks must never fail the session
    }
  });
}
```

- [ ] **Step 8: Make hook scripts executable, run test, verify**

```bash
chmod +x hooks/session-end.sh hooks/pre-compact.sh
cd scripts && npx vitest run hook-precompact.test.ts
```
Expected: PASS (all cases).

- [ ] **Step 9: Commit**

```bash
git add .claude-plugin/plugin.json hooks/ scripts/hook-precompact.ts scripts/hook-precompact.test.ts
git commit -m "feat: ship SessionEnd+PreCompact flush hooks in-plugin"
```

---

### Task 8: Update `kb-sync`, `kb-list`, `kb-lint` wording + delegate sync

**Files:**
- Modify: `skills/kb-sync/SKILL.md`
- Modify: `skills/kb-list/SKILL.md`
- Modify: `skills/kb-lint/SKILL.md`

- [ ] **Step 1: Point `kb-sync` at the script**

In `skills/kb-sync/SKILL.md`, keep the conflict-resolution guidance but replace the manual pull/commit/push (steps 2–4) with delegation to the script (which already does stage-commit-before-pull and token auth):
```bash
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/sync.ts" "$KNOWLEDGE_BASE"
```
Report its `{committed, pushed, files}`. If `sync.ts` exits non-zero due to a rebase conflict, fall back to the existing conflict-resolution rules in this skill, then re-run. Update the description/body to say "knowledge base" rather than referencing topics.

- [ ] **Step 2: Update `kb-list` and `kb-lint` wording**

In `skills/kb-list/SKILL.md` and `skills/kb-lint/SKILL.md`, replace `topics/` → `projects/` and `topic`(s) → `project`(s) throughout, and read project metadata from the root `_index.md` registry frontmatter (`projects:`) rather than scanning `topics/`. Where `kb-list` counts articles, read the `articles` field from each registry entry.

- [ ] **Step 3: Verify no stale `topics/` references remain in skills**

Run: `grep -rn "topics/" skills/ || echo "clean"`
Expected: `clean` (no matches), or only intentional references inside `kb-init`'s migration mention.

- [ ] **Step 4: Commit**

```bash
git add skills/kb-sync/SKILL.md skills/kb-list/SKILL.md skills/kb-lint/SKILL.md
git commit -m "refactor: update sync/list/lint for projects + delegate sync to script"
```

---

## Self-Review

**1. Spec coverage:**
- New layout scaffolding + migration entry (Parts A; Migration) → Task 1 (`kb-init`). ✓
- Resolution flow (Part F) → Task 2 (`kb-ingest` calls `resolve.ts`, writes `.kb-active`). ✓
- Capture without compile (Part C) → Task 2. ✓
- Compile = plan→synthesize→commit (Part D) → Task 3 (`kb-compile`). ✓
- Read-merge query (Part E) → Task 4 (`kb-ask` calls `retrieve.ts`). ✓
- Core memory (Part F) → Task 5 (`kb-core`). ✓
- `kb-topic` deprecated, `kb-project` escape hatch (judgment call a) → Task 6. ✓
- Hooks in-plugin: SessionEnd→sync, PreCompact→ingest+sync (Part D; judgment call b) → Task 7. ✓
- `sync.ts` consumed by hooks + `kb-sync`; wording `topics`→`projects` → Tasks 7, 8. ✓

**2. Placeholder scan:** SKILL.md bodies are complete prose; hook JSON/scripts and `hook-precompact.ts` are complete and runnable; the one TDD'd helper has full test code. No TBD/TODO. ✓

**3. Consistency check:** Every script invocation matches the CLI contracts in the header (`resolve.ts`, `ingest.ts`, `compile-plan.ts`, `compile-commit.ts`, `retrieve.ts`, `core.ts`, `sync.ts`, `migrate.ts`). `hook-precompact.ts` imports `ingest` from Plan 2 (`./ingest.js`) with the exact `{kind:"note", text}` shape. `.kb-active` is written by `kb-ingest` (Task 2) and read by `hook-precompact.ts` (Task 7) — consistent pointer file, gitignored in `kb-init` (Task 1). Plugin `version` bumped to `0.5.0` in Task 7; ensure `marketplace.json` matches when releasing (out of scope here — flagged). ✓

**4. Ordering note:** Task 7's hook test depends on Plan 2's `ingest.ts` existing. Execute Plans 1, 2, 4 before Plan 3, or at least before Task 7.
