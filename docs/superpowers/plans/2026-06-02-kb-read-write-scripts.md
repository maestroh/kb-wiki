# kb-wiki Read/Write Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the remaining Layer-1 deterministic scripts — `resolve` (project resolution), `ingest` (stage raw + record pending), `retrieve` (read-merge gathering), and `core` (core-memory facts).

**Architecture:** Pure TypeScript modules (argv/env in → JSON on stdout, no LLM, no prompts) following the existing `scripts/preprocess-*.ts` shape. Each reuses the Plan 1 contract library (`contract.ts`, `index-sections.ts`, `registry.ts`) — no contract logic is reimplemented here.

**Tech Stack:** TypeScript (ESM), tsx, vitest. Depends on Plan 1 (`gray-matter` already added).

**Scope note — this is Plan 2 of the sequence.** Requires Plan 1's `contract.ts`, `index-sections.ts`, `registry.ts` to exist. Follow-on: Plan 3 (skills + hooks), Plan 4 (sync + migration).

**Working directory for all commands:** `scripts/`.

**Plan 1 surface reused (imported, never redefined):**
- `./contract.js`: `parseDoc`, `stringifyDoc`, `slugify`, `isValidProjectName`, `today`, `KB_VERSION`; types `RootFrontmatter`, `ProjectRegistryEntry`, `ProjectFrontmatter`, `ArticleFrontmatter`.
- `./index-sections.js`: `listPending`, `addPending`, `listArticles`, `ArticleEntry`.
- `./registry.js`: `readRoot`, `findProject`.

---

### Task 1: `resolve.ts` — project resolution

**Files:**
- Create: `scripts/resolve.ts`
- Test: `scripts/resolve.test.ts`

Responsibility: given signals (an optional explicit name + conversation keywords), match against the root registry. Pure `matchProject`; the SKILL.md supplies the signals (incl. cwd→name binding). `none`/`ambiguous`/`match` outcomes per spec Part F.

- [ ] **Step 1: Write the failing test**

Create `scripts/resolve.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { matchProject, ResolveSignals } from "./resolve.js";
import { RootFrontmatter } from "./contract.js";

const root: RootFrontmatter = {
  kind: "kb-root",
  version: 1,
  projects: [
    { name: "acme-redesign", description: "ACME customer portal redesign", keywords: ["acme", "portal", "ui"], path: "projects/acme-redesign", articles: 5 },
    { name: "blog", description: "personal blog drafts", keywords: ["writing", "blog"], path: "projects/blog", articles: 2 },
    { name: "acme-infra", description: "ACME infrastructure notes", keywords: ["acme", "infra", "k8s"], path: "projects/acme-infra", articles: 1 },
  ],
};

describe("matchProject", () => {
  it("returns match on exact name", () => {
    const r = matchProject(root, { name: "blog", keywords: [] });
    expect(r.status).toBe("match");
    expect(r.project?.name).toBe("blog");
  });

  it("returns match on a single clear keyword winner", () => {
    const r = matchProject(root, { keywords: ["writing"] });
    expect(r.status).toBe("match");
    expect(r.project?.name).toBe("blog");
  });

  it("returns ambiguous when multiple projects tie on keywords", () => {
    const r = matchProject(root, { keywords: ["acme"] });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates?.map((c) => c.name).sort()).toEqual(["acme-infra", "acme-redesign"]);
  });

  it("picks the stronger scorer over a weaker one", () => {
    const r = matchProject(root, { keywords: ["acme", "portal", "ui"] });
    expect(r.status).toBe("match");
    expect(r.project?.name).toBe("acme-redesign");
  });

  it("returns none when nothing matches", () => {
    const r = matchProject(root, { keywords: ["gardening"] });
    expect(r.status).toBe("none");
  });

  it("prefers an explicit name even when keywords point elsewhere", () => {
    const r = matchProject(root, { name: "acme-infra", keywords: ["portal"] });
    expect(r.status).toBe("match");
    expect(r.project?.name).toBe("acme-infra");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && npx vitest run resolve.test.ts`
Expected: FAIL — cannot resolve `./resolve.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/resolve.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RootFrontmatter, ProjectRegistryEntry } from "./contract.js";
import { readRoot, findProject } from "./registry.js";

export interface ResolveSignals {
  name?: string;
  keywords: string[];
}

export interface ResolveResult {
  status: "match" | "ambiguous" | "none";
  project?: ProjectRegistryEntry;
  candidates?: ProjectRegistryEntry[];
}

function scoreProject(p: ProjectRegistryEntry, keywords: string[]): number {
  const haystack = [p.name, p.description, ...p.keywords].join(" ").toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (kw && haystack.includes(kw.toLowerCase())) score++;
  }
  return score;
}

export function matchProject(root: RootFrontmatter, signals: ResolveSignals): ResolveResult {
  if (signals.name) {
    const exact = findProject(root, signals.name);
    if (exact) return { status: "match", project: exact };
  }

  const scored = root.projects
    .map((p) => ({ p, score: scoreProject(p, signals.keywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "none" };
  if (scored.length === 1) return { status: "match", project: scored[0].p };
  if (scored[0].score > scored[1].score) return { status: "match", project: scored[0].p };
  return { status: "ambiguous", candidates: scored.map((s) => s.p) };
}

// CLI: resolve.ts <kbRoot> <name|""> <kw1> <kw2> ...
const [, , kbRootArg, nameArg, ...kwArgs] = process.argv;
if (kbRootArg !== undefined) {
  try {
    const root = readRoot(kbRootArg);
    const signals: ResolveSignals = { name: nameArg || undefined, keywords: kwArgs };
    console.log(JSON.stringify(matchProject(root, signals)));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && npx vitest run resolve.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/resolve.ts scripts/resolve.test.ts
git commit -m "feat: add resolve.ts project resolution"
```

---

### Task 2: `ingest.ts` — stage raw + record pending

**Files:**
- Create: `scripts/ingest.ts`
- Test: `scripts/ingest.test.ts`

Responsibility: place a source into the right `raw/<subdir>/` and record it as pending in `wiki/_index.md`. Inline text → a timestamped note; an existing file path → copied by extension. Does NOT compile. Typed-document preprocessing (PDF/video/URL) stays in the existing `preprocess-*.ts` and is out of scope — `ingest` copies the original and records it.

- [ ] **Step 1: Write the failing test**

Create `scripts/ingest.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyDestination, ingest } from "./ingest.js";
import { parseDoc } from "./contract.js";
import { listPending } from "./index-sections.js";
import { readFileSync } from "node:fs";

describe("classifyDestination", () => {
  it("maps extensions to raw subdirs", () => {
    expect(classifyDestination("a.md")).toBe("notes");
    expect(classifyDestination("a.txt")).toBe("notes");
    expect(classifyDestination("a.pdf")).toBe("documents");
    expect(classifyDestination("a.docx")).toBe("documents");
    expect(classifyDestination("a.pptx")).toBe("documents");
    expect(classifyDestination("a.png")).toBe("images");
    expect(classifyDestination("a.mp4")).toBe("videos");
    expect(classifyDestination("a.zip")).toBe(".");
  });
});

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-ingest-"));
  const wiki = join(kb, "projects", "p", "wiki");
  mkdirSync(wiki, { recursive: true });
  writeFileSync(
    join(wiki, "_index.md"),
    [
      "---", "kind: kb-project", "name: p", "description: test", "keywords: []", "created: 2026-06-01", "---",
      "", "## Articles", "", "_No articles yet._",
      "", "## Raw Sources (pending)", "", "_None._",
      "", "## Raw Sources (compiled)", "", "_None._",
      "", "## Raw Sources (archived)", "", "_None._",
    ].join("\n")
  );
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

describe("ingest", () => {
  it("stages inline text as a timestamped note and records pending", () => {
    const res = ingest(kb, "p", { kind: "note", text: "a thought worth keeping" });
    expect(res.path).toMatch(/^raw\/notes\/.*-note\.md$/);
    expect(res.pendingCount).toBe(1);
    expect(existsSync(join(kb, "projects", "p", res.path))).toBe(true);
    const { data } = parseDoc(readFileSync(join(kb, "projects", "p", res.path), "utf-8"));
    expect(data.created).toBeDefined();
  });

  it("copies an existing file into the right subdir and records pending", () => {
    const src = join(kb, "source.pdf");
    writeFileSync(src, "%PDF-1.4 fake");
    const res = ingest(kb, "p", { kind: "file", filePath: src });
    expect(res.path).toBe("raw/documents/source.pdf");
    expect(existsSync(join(kb, "projects", "p", "raw", "documents", "source.pdf"))).toBe(true);
    expect(res.pendingCount).toBe(1);
  });

  it("records each ingested source in pending", () => {
    ingest(kb, "p", { kind: "note", text: "one" });
    const res2 = ingest(kb, "p", { kind: "note", text: "two" });
    expect(res2.pendingCount).toBe(2);
    const { body } = parseDoc(readFileSync(join(kb, "projects", "p", "wiki", "_index.md"), "utf-8"));
    expect(listPending(body)).toHaveLength(2);
  });

  it("throws when the project wiki index is missing", () => {
    expect(() => ingest(kb, "nope", { kind: "note", text: "x" })).toThrow(/wiki\/_index\.md/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && npx vitest run ingest.test.ts`
Expected: FAIL — cannot resolve `./ingest.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/ingest.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { parseDoc, stringifyDoc, today } from "./contract.js";
import { addPending, listPending } from "./index-sections.js";

const EXT_MAP: Record<string, string> = {
  ".md": "notes", ".txt": "notes",
  ".pdf": "documents", ".docx": "documents", ".pptx": "documents",
  ".png": "images", ".jpg": "images", ".jpeg": "images", ".gif": "images", ".svg": "images", ".webp": "images",
  ".mp4": "videos", ".mov": "videos", ".webm": "videos", ".mkv": "videos",
};

export function classifyDestination(filename: string): string {
  return EXT_MAP[extname(filename).toLowerCase()] ?? ".";
}

export type IngestSource =
  | { kind: "note"; text: string }
  | { kind: "file"; filePath: string };

export interface IngestResult {
  path: string; // relative to project dir, e.g. "raw/notes/x.md"
  pendingCount: number;
}

function timestamp(): string {
  // YYYY-MM-DD-HH-MM from ISO string (UTC); deterministic format, not value.
  return new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "-");
}

export function ingest(kbRoot: string, project: string, source: IngestSource): IngestResult {
  const projectDir = join(kbRoot, "projects", project);
  const wikiIndexPath = join(projectDir, "wiki", "_index.md");
  if (!existsSync(wikiIndexPath)) {
    throw new Error(`project "${project}" has no wiki/_index.md — create it first`);
  }

  let rel: string;
  if (source.kind === "note") {
    const subdir = "notes";
    const filename = `${timestamp()}-note.md`;
    rel = `raw/${subdir}/${filename}`;
    mkdirSync(join(projectDir, "raw", subdir), { recursive: true });
    const content = stringifyDoc({ created: new Date().toISOString() }, source.text.trim());
    writeFileSync(join(projectDir, rel), content);
  } else {
    const filename = basename(source.filePath);
    const subdir = classifyDestination(filename);
    rel = subdir === "." ? `raw/${filename}` : `raw/${subdir}/${filename}`;
    mkdirSync(join(projectDir, "raw", subdir === "." ? "" : subdir), { recursive: true });
    copyFileSync(source.filePath, join(projectDir, rel));
  }

  const idx = parseDoc(readFileSync(wikiIndexPath, "utf-8"));
  const body = addPending(idx.body, rel, today());
  writeFileSync(wikiIndexPath, stringifyDoc(idx.data, body));

  return { path: rel, pendingCount: listPending(body).length };
}

// CLI: ingest.ts <kbRoot> <project> note "<text>"   |   ingest.ts <kbRoot> <project> file <path>
const [, , kbRootArg, projectArg, kindArg, payloadArg] = process.argv;
if (kbRootArg && projectArg && kindArg) {
  try {
    const source: IngestSource =
      kindArg === "file"
        ? { kind: "file", filePath: payloadArg }
        : { kind: "note", text: payloadArg ?? "" };
    console.log(JSON.stringify(ingest(kbRootArg, projectArg, source)));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && npx vitest run ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest.ts scripts/ingest.test.ts
git commit -m "feat: add ingest.ts raw staging + pending recording"
```

---

### Task 3: `retrieve.ts` — read-merge gathering

**Files:**
- Create: `scripts/retrieve.ts`
- Test: `scripts/retrieve.test.ts`

Responsibility: gather the candidate set for a query — all wiki article entries plus the pending raw (path + content) — so the reasoner can read-merge `wiki ∪ pending-raw` (spec Part E). Relevance filtering and the answer are the reasoner's job; this is deterministic gathering.

- [ ] **Step 1: Write the failing test**

Create `scripts/retrieve.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gather } from "./retrieve.js";

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-retrieve-"));
  const wiki = join(kb, "projects", "p", "wiki");
  const notes = join(kb, "projects", "p", "raw", "notes");
  mkdirSync(wiki, { recursive: true });
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, "fresh.md"), "the newest uncompiled idea");
  writeFileSync(
    join(wiki, "_index.md"),
    [
      "---", "kind: kb-project", "name: p", "description: test", "keywords: []", "created: 2026-06-01", "---",
      "", "## Articles", "", "- [[agent-loop]] — the planner/executor cycle",
      "", "## Raw Sources (pending)", "", "- raw/notes/fresh.md — added 2026-06-02, not yet compiled",
      "", "## Raw Sources (compiled)", "", "_None._",
      "", "## Raw Sources (archived)", "", "_None._",
    ].join("\n")
  );
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

describe("gather", () => {
  it("returns wiki articles and pending raw with content", () => {
    const r = gather(kb, "p");
    expect(r.project).toBe("p");
    expect(r.articles).toEqual([{ slug: "agent-loop", summary: "the planner/executor cycle" }]);
    expect(r.pending).toEqual([{ path: "raw/notes/fresh.md", content: "the newest uncompiled idea" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && npx vitest run retrieve.test.ts`
Expected: FAIL — cannot resolve `./retrieve.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/retrieve.ts`:

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseDoc } from "./contract.js";
import { listArticles, listPending, ArticleEntry } from "./index-sections.js";

export interface PendingSource {
  path: string;
  content: string;
}

export interface RetrieveResult {
  project: string;
  articles: ArticleEntry[];
  pending: PendingSource[];
}

export function gather(kbRoot: string, project: string): RetrieveResult {
  const projectDir = join(kbRoot, "projects", project);
  const { body } = parseDoc(readFileSync(join(projectDir, "wiki", "_index.md"), "utf-8"));
  const pending: PendingSource[] = listPending(body).map((rel) => {
    const abs = join(projectDir, rel);
    return { path: rel, content: existsSync(abs) ? readFileSync(abs, "utf-8").trim() : "" };
  });
  return { project, articles: listArticles(body), pending };
}

// CLI: retrieve.ts <kbRoot> <project>
const [, , kbRootArg, projectArg] = process.argv;
if (kbRootArg && projectArg) {
  try {
    console.log(JSON.stringify(gather(kbRootArg, projectArg)));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && npx vitest run retrieve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/retrieve.ts scripts/retrieve.test.ts
git commit -m "feat: add retrieve.ts read-merge gathering"
```

---

### Task 4: `core.ts` — core-memory facts with dedup

**Files:**
- Create: `scripts/core.ts`
- Test: `scripts/core.test.ts`

Responsibility: maintain `core/_index.md` (always-loaded durable facts about the user; spec Part F). Add a fact with dedup; list facts. Creates `core/_index.md` with `kind: kb-core` frontmatter if absent.

- [ ] **Step 1: Write the failing test**

Create `scripts/core.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addFact, listFacts } from "./core.js";

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-core-"));
  mkdirSync(kb, { recursive: true });
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

describe("addFact / listFacts", () => {
  it("creates core/_index.md and adds a fact", () => {
    const r = addFact(kb, "Prefers TypeScript for tooling");
    expect(r.added).toBe(true);
    expect(existsSync(join(kb, "core", "_index.md"))).toBe(true);
    expect(listFacts(kb)).toEqual(["Prefers TypeScript for tooling"]);
  });

  it("dedups case- and whitespace-insensitively", () => {
    addFact(kb, "Works at ImagineX Consulting");
    const r = addFact(kb, "  works at   imaginex consulting ");
    expect(r.added).toBe(false);
    expect(listFacts(kb)).toHaveLength(1);
  });

  it("appends distinct facts", () => {
    addFact(kb, "fact one");
    addFact(kb, "fact two");
    expect(listFacts(kb)).toEqual(["fact one", "fact two"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && npx vitest run core.test.ts`
Expected: FAIL — cannot resolve `./core.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/core.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseDoc, stringifyDoc, today, KB_VERSION } from "./contract.js";

function coreIndexPath(kbRoot: string): string {
  return join(kbRoot, "core", "_index.md");
}

function normalize(fact: string): string {
  return fact.trim().replace(/\s+/g, " ").toLowerCase();
}

function readBody(kbRoot: string): { data: Record<string, any>; body: string } {
  const path = coreIndexPath(kbRoot);
  if (!existsSync(path)) {
    return { data: { kind: "kb-core", version: KB_VERSION }, body: "# Core Memory" };
  }
  return parseDoc(readFileSync(path, "utf-8"));
}

export function listFacts(kbRoot: string): string[] {
  const { body } = readBody(kbRoot);
  return body
    .split("\n")
    .map((l) => l.match(/^- (.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "").trim());
}

export function addFact(kbRoot: string, fact: string): { added: boolean } {
  const { data, body } = readBody(kbRoot);
  const existing = listFacts(kbRoot).map(normalize);
  if (existing.includes(normalize(fact))) return { added: false };

  const newBody = `${body.trim()}\n- ${fact.trim()} (${today()})`;
  mkdirSync(join(kbRoot, "core"), { recursive: true });
  writeFileSync(coreIndexPath(kbRoot), stringifyDoc(data, newBody));
  return { added: true };
}

// CLI: core.ts add "<fact>"  |  core.ts list   (KNOWLEDGE_BASE env = kbRoot)
const [, , cmd, factArg] = process.argv;
if (cmd) {
  try {
    const kbRoot = process.env.KNOWLEDGE_BASE;
    if (!kbRoot) throw new Error("KNOWLEDGE_BASE is not set");
    if (cmd === "add") console.log(JSON.stringify(addFact(kbRoot, factArg ?? "")));
    else if (cmd === "list") console.log(JSON.stringify({ facts: listFacts(kbRoot) }));
    else throw new Error(`unknown command: ${cmd}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && npx vitest run core.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd scripts && npx vitest run`
Expected: PASS — all Plan 1 + Plan 2 suites plus the pre-existing `preprocess-*` suites.

- [ ] **Step 6: Commit**

```bash
git add scripts/core.ts scripts/core.test.ts
git commit -m "feat: add core.ts core-memory facts with dedup"
```

---

## Self-Review

**1. Spec coverage:**
- Project resolution (Part F: signals → match/ambiguous/none) → Task 1 `matchProject` + CLI. cwd→name binding is noted as the SKILL.md's job (passes `name` signal). ✓
- Capture / `ingest` (Part C: stage raw, record pending, no compile) → Task 2. Typed-doc preprocessing explicitly delegated to existing `preprocess-*.ts`. ✓
- Read-merge gathering (Part E: `wiki ∪ pending-raw`) → Task 3 `gather`. Reasoner does relevance + merge. ✓
- Core memory (Part F: durable facts, dedup, `{added}`) → Task 4. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is complete and runnable; every run step has an exact command + expected result. ✓

**3. Type consistency:** Imports Plan 1 surface (`parseDoc`, `stringifyDoc`, `slugify`, `today`, `KB_VERSION`, `RootFrontmatter`, `ProjectRegistryEntry`, `ArticleEntry`, `listPending`, `addPending`, `listArticles`, `readRoot`, `findProject`) rather than redefining. New exported types (`ResolveSignals`/`ResolveResult`, `IngestSource`/`IngestResult`, `PendingSource`/`RetrieveResult`) are internally consistent and used only within their own modules/tests. `PendingSource {path, content}` is defined in `retrieve.ts`; note Plan 1's `compile-plan.ts` defines a structurally identical `PendingSource` independently — acceptable (different modules), but if later consolidation is desired, hoist to `contract.ts`. ✓
