---
status: approved
date: 2026-06-01
updated: 2026-06-02
topic: agent-memory-redesign
---

# kb-wiki → Portable Agent Memory: Design

> Status: **approved** — ready for implementation planning.

## Problem / Motivation

kb-wiki was built assuming an **interactive Claude** as the runtime — a reasoner in the loop who decides which topic to use, when to compile, and what's worth remembering, who can ask questions and install tools. The user wants the same knowledge base to also serve as **portable agent memory** that works from a **headless agent backend** AND from interactive Claude Code, against the **same git-backed repo**.

The vision: chat with an agent on one machine → it stores research/findings → pull the latest on another machine → use the KB to drive building an app or writing a blog post.

### What the user likes (keep)
- **`kb-sync`** — GitHub as the data repo makes knowledge portable.
- **The wiki/index format** — `_index.md` files give front-matter-level summaries with pointers to deeper articles loaded on demand. This tiering is the core value.

### What's off (fix)
1. **`kb-ingest` does nothing on its own** — only stages raw as "pending"; user must separately compile.
2. **`kb-topic` is unnatural** — naming/remembering an abstract "topic" before working. User wants the *separation*, not the *manual naming*.

### Context: the agent-backend divergence
A separate agent backend re-implemented the skills as deterministic TypeScript scripts (argv in, JSON out, no LLM), with a `MemoryWriter` + `MemoryLoop` decision layer, env-var config, headless git auth (and notably an **OpenAI** key, not Anthropic), and `kb-compile` as a backend component. This divergence is the pain we're designing against.

## Decisions made (locked)

1. **Architecture — two layers; the deterministic script layer is the shared source of truth.**
   - **Layer 1 — `scripts/`**: pure deterministic CLI tools (argv in → JSON on stdout, env-var config, no interactive prompts, no LLM). They read/write the on-disk contract and enforce its invariants. This is the *real* shared engine.
   - **Layer 2 — `skills/` (`SKILL.md`)**: thin prose wrappers for LLM-in-loop runtimes (Claude Code; the user's skill-capable agents). They decide *when/which* (orchestration) and reason where it helps (judgment), and call Layer 1 for **all** mechanical work.
   - **Rule:** Layer 2 never reimplements mechanical logic — so the deterministic path and the skill path cannot drift.
   - **Consumers choose their entry point:** Claude Code → Layer 2 → Layer 1. The user's agents can use Layer 2 *or* call Layer 1 scripts directly (they prefer determinism where possible). A purely deterministic backend → Layer 1 directly with its own orchestration.

2. **Organizing unit — project + core memory.** Rename `topic` → `project`; one repo, many projects; registry-based resolution removes manual naming. Plus a small always-loaded `core/` memory tier for durable cross-project facts (MemGPT-style; mirrors the backend's `core-memory`).

3. **Capture flow — stage now, flush deferred.** `kb-ingest` stages raw immediately, records it as pending, never blocks the turn. Compile is deferred.

4. **Compile model — raw is source of truth; synthesis is caller-side.** (See dedicated section.) `raw/` is durable; the wiki is *derived*. Deferring compile never loses data. Shared scripts do deterministic `plan` + `commit` only and embed **no** LLM. The synthesis step is performed by whatever reasoner the environment has (in-loop Claude / the backend's OpenAI key).

5. **Flush boundaries — reasoner-aware (Claude Code front-end).** Compile runs where a reasoner is present (in-turn: project-switch, wrap-up, large pending). Headless triggers (`SessionEnd`/`PreCompact` hooks) **sync + defer** rather than synthesize. Size cap prevents unbounded pending. (Backend uses `MemoryLoop` threshold-gating — its own concern.)

6. **Runnable code — out of scope for now.** Projects hold research + planning + assets. `code/` is a reserved name, not built.

7. **Query is read-merged — never stale.** Because the wiki is derived and compile is deferred, the read path merges `wiki ∪ pending-raw` so a query always sees the most recent ingested material (LSM/memtable pattern: compacted store + un-flushed delta). Recency is protected on the write side too: `PreCompact` ingests the about-to-be-lost context into `raw/` before synthesis/compaction can drop it. (See Part E.)

---

## PART A — The shared on-disk contract (front-end-neutral; the product)

### Layout
```
$KNOWLEDGE_BASE/
  _index.md                  # ROOT: project registry (frontmatter) + nav + cross-links
  core/
    _index.md                # CORE MEMORY: always-loaded durable facts about the user
  projects/                  # renamed from topics/
    <project>/
      raw/                   # SOURCE OF TRUTH: notes/ documents/ videos/ links/ images/ _archive/
      planning/              # plans, specs, ADRs, todos        (new, optional)
      assets/                # datasets, designs, large artifacts (new, optional)
      wiki/                  # DERIVED from raw via compile
        _index.md            # articles + pending/compiled/archived source tracking
        <article>.md
      # code/  — reserved name, intentionally NOT built yet
```

### Frontmatter schemas
**Root `_index.md` (the registry both sides read for resolution):**
```yaml
kind: kb-root
version: 1
projects:
  - name: acme-redesign          # kebab-case, unique, == directory name
    description: Redesign of ACME's customer portal
    keywords: [acme, portal, ui]
    path: projects/acme-redesign
    articles: 12
```
**Project `wiki/_index.md`:** `kind: kb-project`, `name`, `description`, `keywords`, `created`. Stable body headings: `## Articles`, `## Raw Sources (pending)`, `## Raw Sources (compiled)`, `## Raw Sources (archived)`.
**Article `<article>.md`:** `kind: kb-article`, `sources: [...]`.
**Core `core/_index.md`:** `kind: kb-core`, `version`; body = bulleted durable facts.

## PART B — Interoperability invariants (what makes multi-front-end work)

Any writer MUST uphold these (Layer 1 scripts enforce them centrally):
1. **Names canonical & triple-synced** — directory == `wiki/_index.md` `name:` == root-registry `name`/`path`; kebab-case, unique.
2. **Registry is the resolution source of truth** — create/remove/rename updates root `_index.md` `projects:`. Both sides resolve by reading only this.
3. **Pending recorded on disk** — uncompiled sources appear in `wiki/_index.md` `## Raw Sources (pending)`. This is how one front-end discovers the other's uncompiled work.
4. **Everything lives in the repo** — no required state outside git; a fresh clone is fully functional (portability goal).
5. **Wikilinks Obsidian-compatible** — within project `[[article]]`; cross-project `[[projects/<other>/wiki/<article>]]`.
6. **`version` gates format changes** — readers degrade gracefully on unknown versions.

## PART C — Layer 1 scripts (the deterministic engine)

All pure: argv in → JSON out, env-var config (`KNOWLEDGE_BASE`, etc.), no prompts, no LLM. Read/write Part A, enforce Part B. (Existing `preprocess-*.ts` already fit this shape.)

- `resolve.ts` — signals in (cwd, keywords, explicit name) → `{ match | ambiguous[] | none }` + project meta, read from the root registry.
- `ingest.ts` — `(source, project)` → stages raw (via `preprocess-*.ts` as needed), records pending. **No compile.**
- `compile-plan.ts` — reads `wiki/_index.md` → `{ pendingSources[], existingArticles[] }` brief for the reasoner.
- `compile-commit.ts` — structured article-ops JSON in → writes articles, updates indexes, moves pending→compiled. **(See compile section.)**
- `index-update.ts` — registry / index maintenance helpers.
- `retrieve.ts` — `(query, project?)` → relevant wiki articles (from indexes) **plus** the project's `## Raw Sources (pending)` entries, so the reasoner can read-merge `wiki ∪ pending-raw`. Deterministic gathering; the merge/answer is the reasoner's job.
- `core.ts` — add/list core facts with dedup → `{ added }`.
- `sync.ts` — git pull/commit/push; headless-auth aware (token); stage-before-pull ordering.

## PART D — Compile lifecycle (the one LLM step)

`raw/` is the durable source of truth; the wiki is derived. **Deferring compile never loses data.** Three steps:

1. **`compile-plan`** (deterministic) — emits the brief: pending sources + content, existing articles (slugs + summaries) so synthesis knows update-vs-create.
2. **Synthesize** (the environment's reasoner — in-loop Claude here, OpenAI in the backend) — produces **structured article operations**, not files:
   ```json
   {
     "project": "acme-redesign",
     "articles": [
       { "op": "create", "slug": "agent-loop", "title": "Agent Loop",
         "summary": "The planner/executor cycle.",
         "body": "...markdown with [[wikilinks]]...",
         "sources": ["raw/documents/paper.md", "raw/notes/2026-06-01-x.md"] }
     ],
     "consumedPending": ["raw/documents/paper.md", "raw/notes/2026-06-01-x.md"]
   }
   ```
3. **`compile-commit`** (deterministic) —
   1. **Validate** entire payload (schema, `sources` non-empty, wikilink format, name-sync). On any violation → JSON error, write **nothing** (no half-corrupt repo).
   2. **Write** each article to `wiki/<slug>.md` (`create` upserts → retry-safe).
   3. **Update `wiki/_index.md`** — refresh `## Articles`; move `consumedPending` → `## Raw Sources (compiled)` dated.
   4. **Update root `_index.md`** — recount `articles`, update description if shifted.
   5. **Return** `{ written, updated, pendingRemaining }`.

**Why even in-loop Claude routes through `compile-commit`:** otherwise the index/invariant bookkeeping gets reimplemented as prose in the SKILL.md = drift. Claude does creative synthesis (step 2); the script does the mechanical write (step 3). One deterministic, testable place owns repo correctness.

**Who triggers compile (orchestration; per front-end):**
- **Claude Code, in-turn** (reasoner present): project-switch, wrap-up, large pending → Claude synthesizes free (no key), calls `compile-commit`.
- **Claude Code hooks** (no reasoner present): `SessionEnd` → `sync` (push raw + pending; synthesis deferred). `PreCompact` → **ingest the worth-keeping part of the about-to-be-summarized context into `raw/`, then `sync`** — this persists recency *before* compaction can drop it (closes Gap 2; see Part E). Neither hook synthesizes.
- **Backend `MemoryLoop`**: threshold-gated; synthesizes via OpenAI key, calls `compile-commit`.
- **Explicit** `/kb-compile` (and `--full` recompile).

**Open/deferred:** an optional provider-configurable *embedded* compile mode (script calls OpenAI/Anthropic itself) for a future headless caller with a key but no reasoner. Not built now; just not designed out.

## PART E — Read path & consistency

The wiki is *derived* and compile is *deferred*, so a naive query against the wiki alone would be stale. Two gaps, two fixes:

- **Gap 1 — ingested but not yet compiled.** Material sits in `raw/` as pending; the wiki doesn't have it. **Fix: read-merge.** `kb-ask` retrieves via `retrieve.ts`, which returns relevant wiki articles **plus** the project's pending raw sources; the reasoner blends them (wiki = depth + cross-links, pending raw = recency). LSM/memtable pattern; reads are never stale. Bounded — only the resolved project's pending, and the size cap keeps pending small.
- **Gap 2 — in the conversation but not yet ingested.** Recent turns live only in working context and could be compacted away before persisting. **Fix: `PreCompact` ingests** the worth-keeping context into `raw/` (then syncs) *before* compaction. Combined with read-merge, that recency is immediately queryable.
- **Optional (deferred):** after a query that leaned on pending raw, kick off a background compile so the next read is already clean. Not built initially.

## PART F — Claude Code front-end behavior (this plugin)

- **Resolution:** gather signals (cwd/git-repo name, explicit mention, keywords) → `resolve.ts` → use silently on strong match; ask once on ambiguity; propose+confirm+create on none.
- **Capture:** `kb-ingest` → `ingest.ts` (stages raw, records pending), no block.
- **Query:** `kb-ask` → `retrieve.ts` → reasoner read-merges `wiki ∪ pending-raw`.
- **Flush:** per the triggers above.
- **Core memory:** `kb-core` skill → `core.ts`; Claude may also propose a fact in-loop.

## PART G — Agent backend (out of scope for this repo)

Honors Parts A & B via its own code: `MemoryLoop` owns timing, `MemoryWriter` decides what to write, synthesis via OpenAI. It may additionally adopt Layer 1 scripts (`compile-commit`, `ingest`, etc.) if it chooses. **We do not modify the backend here; we only guarantee the plugin + scripts emit a contract-compliant repo it can consume.**

## Migration & skill changes (this plugin)
- **One-time migration:** `topics/` → `projects/`, rewrite `[[topics/...]]` → `[[projects/...]]`, inject new frontmatter. Script + runner so the existing GitHub repo upgrades cleanly.
- **Skill roster after:** `kb-ingest`, `kb-compile` (explicit/full), `kb-ask`, `kb-lint`, `kb-list`, `kb-sync`, **`kb-core`** (new), `kb-init` (new layout), ~~`kb-topic`~~ (deprecated). All skills become thin wrappers over Layer 1.
- **`docs/`** gets Parts A–D as the canonical contract spec.

## Resolved judgment calls (defaults — override anytime)
- **(a)** `kb-topic` → **deprecated, but keep a thin `kb-project create` escape hatch** for when you want to force creation explicitly. Low cost; resolution remains the default path.
- **(b)** Hooks **shipped in-plugin** (plugins can declare hooks) → turnkey, portable install, no manual `settings.json` editing.
- **(c)** Layout/contract: **no further changes** — Parts A/B stand as the canonical spec.
