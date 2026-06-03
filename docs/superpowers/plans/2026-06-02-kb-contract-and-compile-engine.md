# kb-wiki Contract & Compile Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic Layer-1 engine for the redesigned kb-wiki — the shared contract library plus the `compile-plan` / `compile-commit` scripts that turn caller-synthesized article operations into correct on-disk wiki state.

**Architecture:** Pure TypeScript modules (argv in → JSON on stdout, no LLM, no prompts) following the existing `scripts/preprocess-*.ts` shape. A contract library (`contract.ts`, `index-sections.ts`, `registry.ts`) owns all frontmatter/index/registry mechanics and invariants; `compile-plan.ts` emits a synthesis brief; `compile-commit.ts` writes articles and updates both the project index and the root registry. This is the keystone of the design's "raw = source of truth, wiki = derived, synthesis = caller-side" model (see `docs/superpowers/specs/2026-06-01-agent-memory-redesign-design.md`, Parts A–D).

**Tech Stack:** TypeScript (ESM, `"type": "module"`), tsx, vitest, `gray-matter` for YAML frontmatter.

**Scope note — this is Plan 1 of a sequence.** This plan delivers the contract + compile vertical only (independently testable). Follow-on plans (not in this doc): **Plan 2** — `resolve.ts`, `ingest.ts`, `retrieve.ts`, `core.ts`; **Plan 3** — thin `SKILL.md` wrappers + `SessionEnd`/`PreCompact` hooks; **Plan 4** — `sync.ts` + `topics/`→`projects/` migration.

**Working directory for all commands:** `scripts/` (run `cd scripts` once; all paths below are relative to it unless absolute).

---

### Task 1: Contract foundations (types + frontmatter helpers)

**Files:**
- Modify: `scripts/package.json` (add `gray-matter` dependency)
- Create: `scripts/contract.ts`
- Test: `scripts/contract.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `cd scripts && npm install gray-matter@^4.0.3`
Expected: `package.json` gains `"gray-matter": "^4.0.3"` under `dependencies`; install succeeds.

- [ ] **Step 2: Write the failing test**

Create `scripts/contract.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  parseDoc,
  stringifyDoc,
  slugify,
  isValidProjectName,
  KB_VERSION,
} from "./contract.js";

describe("parseDoc / stringifyDoc", () => {
  it("round-trips frontmatter and body", () => {
    const md = "---\nkind: kb-article\nsources:\n  - raw/notes/a.md\n---\n\n# Title\n\nBody text.";
    const { data, body } = parseDoc(md);
    expect(data.kind).toBe("kb-article");
    expect(data.sources).toEqual(["raw/notes/a.md"]);
    expect(body).toBe("# Title\n\nBody text.");

    const out = stringifyDoc(data, body);
    const reparsed = parseDoc(out);
    expect(reparsed.data).toEqual(data);
    expect(reparsed.body).toBe(body);
  });

  it("treats a doc with no frontmatter as empty data", () => {
    const { data, body } = parseDoc("# Just a heading");
    expect(data).toEqual({});
    expect(body).toBe("# Just a heading");
  });
});

describe("slugify", () => {
  it("kebab-cases a title", () => {
    expect(slugify("The Agent Loop!")).toBe("the-agent-loop");
  });
});

describe("isValidProjectName", () => {
  it("accepts kebab-case", () => {
    expect(isValidProjectName("acme-redesign")).toBe(true);
    expect(isValidProjectName("proj1")).toBe(true);
  });
  it("rejects spaces, caps, and edge dashes", () => {
    expect(isValidProjectName("Acme Redesign")).toBe(false);
    expect(isValidProjectName("-bad")).toBe(false);
    expect(isValidProjectName("bad-")).toBe(false);
    expect(isValidProjectName("")).toBe(false);
  });
});

describe("KB_VERSION", () => {
  it("is 1", () => {
    expect(KB_VERSION).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd scripts && npx vitest run contract.test.ts`
Expected: FAIL — cannot resolve `./contract.js` (module does not exist yet).

- [ ] **Step 4: Write minimal implementation**

Create `scripts/contract.ts`:

```typescript
import matter from "gray-matter";

export const KB_VERSION = 1;

export interface ProjectRegistryEntry {
  name: string;
  description: string;
  keywords: string[];
  path: string; // e.g. "projects/acme-redesign"
  articles: number;
}

export interface RootFrontmatter {
  kind: "kb-root";
  version: number;
  projects: ProjectRegistryEntry[];
}

export interface ProjectFrontmatter {
  kind: "kb-project";
  name: string;
  description: string;
  keywords: string[];
  created: string; // YYYY-MM-DD
}

export interface ArticleFrontmatter {
  kind: "kb-article";
  sources: string[];
}

export interface ParsedDoc {
  data: Record<string, any>;
  body: string;
}

export function parseDoc(md: string): ParsedDoc {
  const { data, content } = matter(md);
  return { data: data as Record<string, any>, body: content.trim() };
}

export function stringifyDoc(data: Record<string, any>, body: string): string {
  // gray-matter appends a trailing newline after frontmatter; normalize the body.
  return matter.stringify(`${body.trim()}\n`, data);
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function isValidProjectName(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

export function today(): string {
  return new Date().toISOString().split("T")[0];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd scripts && npx vitest run contract.test.ts`
Expected: PASS (all 6 assertions).

- [ ] **Step 6: Commit**

```bash
git add scripts/contract.ts scripts/contract.test.ts scripts/package.json scripts/package-lock.json
git commit -m "feat: add kb contract types and frontmatter helpers"
```

---

### Task 2: Index-section helpers (project `wiki/_index.md` body)

**Files:**
- Create: `scripts/index-sections.ts`
- Test: `scripts/index-sections.test.ts`

Responsibility: pure string manipulation of the stable markdown body sections (`## Articles`, `## Raw Sources (pending)`, `## Raw Sources (compiled)`). No file I/O.

- [ ] **Step 1: Write the failing test**

Create `scripts/index-sections.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  getSection,
  replaceSection,
  listPending,
  addPending,
  moveToCompiled,
  listArticles,
  upsertArticleEntries,
  setArticles,
  ArticleEntry,
} from "./index-sections.js";

const BODY = [
  "## Articles",
  "",
  "- [[agent-loop]] — the planner/executor cycle",
  "",
  "## Raw Sources (pending)",
  "",
  "- raw/notes/a.md — added 2026-06-01, not yet compiled",
  "- raw/documents/b.md — added 2026-06-01, not yet compiled",
  "",
  "## Raw Sources (compiled)",
  "",
  "_None._",
  "",
  "## Raw Sources (archived)",
  "",
  "_None._",
].join("\n");

describe("getSection / replaceSection", () => {
  it("extracts a section's inner content", () => {
    expect(getSection(BODY, "Articles").trim()).toBe(
      "- [[agent-loop]] — the planner/executor cycle"
    );
  });
  it("replaces a section's inner content, leaving others intact", () => {
    const out = replaceSection(BODY, "Raw Sources (compiled)", "- raw/notes/a.md — compiled 2026-06-02");
    expect(getSection(out, "Raw Sources (compiled)").trim()).toBe("- raw/notes/a.md — compiled 2026-06-02");
    expect(getSection(out, "Articles").trim()).toBe("- [[agent-loop]] — the planner/executor cycle");
  });
});

describe("listPending", () => {
  it("returns the raw paths under pending", () => {
    expect(listPending(BODY)).toEqual(["raw/notes/a.md", "raw/documents/b.md"]);
  });
  it("returns [] when pending is _None._", () => {
    const empty = replaceSection(BODY, "Raw Sources (pending)", "_None._");
    expect(listPending(empty)).toEqual([]);
  });
});

describe("addPending", () => {
  it("adds a bullet and removes the _None._ placeholder", () => {
    const empty = replaceSection(BODY, "Raw Sources (pending)", "_None._");
    const out = addPending(empty, "raw/links/c.md", "2026-06-02");
    expect(listPending(out)).toEqual(["raw/links/c.md"]);
    expect(getSection(out, "Raw Sources (pending)")).not.toContain("_None._");
  });
});

describe("moveToCompiled", () => {
  it("moves named paths from pending to compiled with a date", () => {
    const out = moveToCompiled(BODY, ["raw/notes/a.md"], "2026-06-02");
    expect(listPending(out)).toEqual(["raw/documents/b.md"]);
    expect(getSection(out, "Raw Sources (compiled)")).toContain(
      "- raw/notes/a.md — compiled 2026-06-02"
    );
  });
  it("restores _None._ when pending becomes empty", () => {
    const out = moveToCompiled(BODY, ["raw/notes/a.md", "raw/documents/b.md"], "2026-06-02");
    expect(listPending(out)).toEqual([]);
    expect(getSection(out, "Raw Sources (pending)").trim()).toBe("_None._");
  });
});

describe("articles", () => {
  it("lists existing article entries", () => {
    expect(listArticles(BODY)).toEqual([
      { slug: "agent-loop", summary: "the planner/executor cycle" },
    ]);
  });
  it("upserts entries by slug", () => {
    const existing: ArticleEntry[] = [{ slug: "agent-loop", summary: "old" }];
    const merged = upsertArticleEntries(existing, [
      { slug: "agent-loop", summary: "new" },
      { slug: "memory-tiers", summary: "core vs archival" },
    ]);
    expect(merged).toEqual([
      { slug: "agent-loop", summary: "new" },
      { slug: "memory-tiers", summary: "core vs archival" },
    ]);
  });
  it("renders the Articles section from entries", () => {
    const out = setArticles(BODY, [{ slug: "x", summary: "y" }]);
    expect(getSection(out, "Articles").trim()).toBe("- [[x]] — y");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && npx vitest run index-sections.test.ts`
Expected: FAIL — cannot resolve `./index-sections.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/index-sections.ts`:

```typescript
export interface ArticleEntry {
  slug: string;
  summary: string;
}

const NONE = "_None._";

// Returns the text between `## <heading>` and the next `## ` (or end of body).
export function getSection(body: string, heading: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").replace(/^\n+|\n+$/g, "");
}

export function replaceSection(body: string, heading: string, newContent: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return body;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start + 1);
  const after = lines.slice(end);
  const block = ["", newContent.trim(), ""];
  return [...before, ...block, ...after].join("\n").replace(/\n{3,}/g, "\n\n");
}

function bulletPaths(section: string): string[] {
  return section
    .split("\n")
    .map((l) => l.match(/^- (\S+)/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1])
    .filter((p) => p !== NONE);
}

export function listPending(body: string): string[] {
  return bulletPaths(getSection(body, "Raw Sources (pending)"));
}

export function addPending(body: string, relPath: string, date: string): string {
  const current = listPending(body);
  const lines = [...current, relPath].map(
    (p) => `- ${p} — added ${date}, not yet compiled`
  );
  return replaceSection(body, "Raw Sources (pending)", lines.join("\n"));
}

export function moveToCompiled(body: string, paths: string[], date: string): string {
  const remaining = listPending(body).filter((p) => !paths.includes(p));
  const pendingContent = remaining.length
    ? remaining.map((p) => `- ${p} — added ${date}, not yet compiled`).join("\n")
    : NONE;

  const compiledExisting = bulletPaths(getSection(body, "Raw Sources (compiled)"));
  const compiledAll = [...compiledExisting, ...paths];
  const compiledContent = compiledAll.length
    ? compiledAll.map((p) => `- ${p} — compiled ${date}`).join("\n")
    : NONE;

  let out = replaceSection(body, "Raw Sources (pending)", pendingContent);
  out = replaceSection(out, "Raw Sources (compiled)", compiledContent);
  return out;
}

export function listArticles(body: string): ArticleEntry[] {
  return getSection(body, "Articles")
    .split("\n")
    .map((l) => l.match(/^- \[\[([^\]]+)\]\] — (.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ slug: m[1], summary: m[2].trim() }));
}

export function upsertArticleEntries(
  existing: ArticleEntry[],
  ops: ArticleEntry[]
): ArticleEntry[] {
  const merged = existing.map((e) => ({ ...e }));
  for (const op of ops) {
    const i = merged.findIndex((e) => e.slug === op.slug);
    if (i >= 0) merged[i] = op;
    else merged.push(op);
  }
  return merged;
}

export function setArticles(body: string, entries: ArticleEntry[]): string {
  const content = entries.length
    ? entries.map((e) => `- [[${e.slug}]] — ${e.summary}`).join("\n")
    : "_No articles yet._";
  return replaceSection(body, "Articles", content);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && npx vitest run index-sections.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/index-sections.ts scripts/index-sections.test.ts
git commit -m "feat: add wiki index-section parse/edit helpers"
```

---

### Task 3: Root registry helpers

**Files:**
- Create: `scripts/registry.ts`
- Test: `scripts/registry.test.ts`

Responsibility: read/write the root `_index.md` frontmatter registry and maintain article counts. File I/O lives here; matching logic (for `resolve.ts`) is deferred to Plan 2.

- [ ] **Step 1: Write the failing test**

Create `scripts/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRoot, writeRoot, findProject, upsertProject, setArticleCount } from "./registry.js";
import { parseDoc } from "./contract.js";

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-reg-"));
  const root = [
    "---",
    "kind: kb-root",
    "version: 1",
    "projects:",
    "  - name: acme-redesign",
    "    description: ACME portal redesign",
    "    keywords:",
    "      - acme",
    "    path: projects/acme-redesign",
    "    articles: 3",
    "---",
    "",
    "# Knowledge Base",
  ].join("\n");
  mkdirSync(kb, { recursive: true });
  writeFileSync(join(kb, "_index.md"), root);
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

describe("readRoot", () => {
  it("parses the registry", () => {
    const root = readRoot(kb);
    expect(root.kind).toBe("kb-root");
    expect(root.projects).toHaveLength(1);
    expect(root.projects[0].name).toBe("acme-redesign");
    expect(root.projects[0].articles).toBe(3);
  });
});

describe("findProject", () => {
  it("finds by name", () => {
    expect(findProject(readRoot(kb), "acme-redesign")?.articles).toBe(3);
  });
  it("returns undefined for unknown", () => {
    expect(findProject(readRoot(kb), "nope")).toBeUndefined();
  });
});

describe("upsertProject + writeRoot", () => {
  it("adds a new project and persists it", () => {
    const root = readRoot(kb);
    const updated = upsertProject(root, {
      name: "blog",
      description: "blog drafts",
      keywords: ["writing"],
      path: "projects/blog",
      articles: 0,
    });
    writeRoot(kb, updated);
    const reread = readRoot(kb);
    expect(reread.projects.map((p) => p.name).sort()).toEqual(["acme-redesign", "blog"]);
  });
  it("replaces an existing entry by name (no dupes)", () => {
    const root = readRoot(kb);
    const updated = upsertProject(root, {
      name: "acme-redesign",
      description: "changed",
      keywords: ["acme"],
      path: "projects/acme-redesign",
      articles: 9,
    });
    expect(updated.projects).toHaveLength(1);
    expect(updated.projects[0].description).toBe("changed");
    expect(updated.projects[0].articles).toBe(9);
  });
});

describe("setArticleCount", () => {
  it("updates the count for a project", () => {
    const updated = setArticleCount(readRoot(kb), "acme-redesign", 7);
    expect(findProject(updated, "acme-redesign")?.articles).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && npx vitest run registry.test.ts`
Expected: FAIL — cannot resolve `./registry.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/registry.ts`:

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseDoc,
  stringifyDoc,
  RootFrontmatter,
  ProjectRegistryEntry,
  KB_VERSION,
} from "./contract.js";

function rootIndexPath(kbRoot: string): string {
  return join(kbRoot, "_index.md");
}

export function readRoot(kbRoot: string): RootFrontmatter {
  const { data } = parseDoc(readFileSync(rootIndexPath(kbRoot), "utf-8"));
  return {
    kind: "kb-root",
    version: typeof data.version === "number" ? data.version : KB_VERSION,
    projects: Array.isArray(data.projects) ? (data.projects as ProjectRegistryEntry[]) : [],
  };
}

export function writeRoot(kbRoot: string, root: RootFrontmatter): void {
  const path = rootIndexPath(kbRoot);
  const { body } = parseDoc(readFileSync(path, "utf-8"));
  writeFileSync(path, stringifyDoc({ ...root }, body));
}

export function findProject(
  root: RootFrontmatter,
  name: string
): ProjectRegistryEntry | undefined {
  return root.projects.find((p) => p.name === name);
}

export function upsertProject(
  root: RootFrontmatter,
  entry: ProjectRegistryEntry
): RootFrontmatter {
  const projects = root.projects.filter((p) => p.name !== entry.name);
  projects.push(entry);
  return { ...root, projects };
}

export function setArticleCount(
  root: RootFrontmatter,
  name: string,
  count: number
): RootFrontmatter {
  return {
    ...root,
    projects: root.projects.map((p) =>
      p.name === name ? { ...p, articles: count } : p
    ),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && npx vitest run registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/registry.ts scripts/registry.test.ts
git commit -m "feat: add root registry read/write helpers"
```

---

### Task 4: `compile-plan` — emit the synthesis brief

**Files:**
- Create: `scripts/compile-plan.ts`
- Test: `scripts/compile-plan.test.ts`

Responsibility: read a project's `wiki/_index.md` and the content of each pending raw source, and emit a JSON brief the reasoner uses to synthesize. Deterministic; no LLM.

- [ ] **Step 1: Write the failing test**

Create `scripts/compile-plan.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPlan } from "./compile-plan.js";

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-plan-"));
  const wiki = join(kb, "projects", "p", "wiki");
  const raw = join(kb, "projects", "p", "raw", "notes");
  mkdirSync(wiki, { recursive: true });
  mkdirSync(raw, { recursive: true });
  writeFileSync(join(raw, "a.md"), "Note A content");
  const index = [
    "---",
    "kind: kb-project",
    "name: p",
    "description: test",
    "keywords: []",
    "created: 2026-06-01",
    "---",
    "",
    "## Articles",
    "",
    "- [[existing]] — an existing article",
    "",
    "## Raw Sources (pending)",
    "",
    "- raw/notes/a.md — added 2026-06-01, not yet compiled",
    "",
    "## Raw Sources (compiled)",
    "",
    "_None._",
    "",
    "## Raw Sources (archived)",
    "",
    "_None._",
  ].join("\n");
  writeFileSync(join(wiki, "_index.md"), index);
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

describe("buildPlan", () => {
  it("returns pending sources with content and existing articles", () => {
    const plan = buildPlan(kb, "p");
    expect(plan.project).toBe("p");
    expect(plan.existingArticles).toEqual([
      { slug: "existing", summary: "an existing article" },
    ]);
    expect(plan.pendingSources).toEqual([
      { path: "raw/notes/a.md", content: "Note A content" },
    ]);
  });

  it("returns empty pending when nothing is pending", () => {
    const wiki = join(kb, "projects", "p", "wiki");
    writeFileSync(
      join(wiki, "_index.md"),
      [
        "---",
        "kind: kb-project",
        "name: p",
        "description: test",
        "keywords: []",
        "created: 2026-06-01",
        "---",
        "",
        "## Articles",
        "",
        "_No articles yet._",
        "",
        "## Raw Sources (pending)",
        "",
        "_None._",
        "",
        "## Raw Sources (compiled)",
        "",
        "_None._",
      ].join("\n")
    );
    expect(buildPlan(kb, "p").pendingSources).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && npx vitest run compile-plan.test.ts`
Expected: FAIL — cannot resolve `./compile-plan.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/compile-plan.ts`:

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseDoc } from "./contract.js";
import { listPending, listArticles, ArticleEntry } from "./index-sections.js";

export interface PendingSource {
  path: string; // relative to project dir, e.g. "raw/notes/a.md"
  content: string;
}

export interface CompilePlan {
  project: string;
  existingArticles: ArticleEntry[];
  pendingSources: PendingSource[];
}

export function buildPlan(kbRoot: string, project: string): CompilePlan {
  const projectDir = join(kbRoot, "projects", project);
  const wikiIndexPath = join(projectDir, "wiki", "_index.md");
  const { body } = parseDoc(readFileSync(wikiIndexPath, "utf-8"));

  const pendingSources: PendingSource[] = listPending(body).map((rel) => {
    const abs = join(projectDir, rel);
    return { path: rel, content: existsSync(abs) ? readFileSync(abs, "utf-8").trim() : "" };
  });

  return {
    project,
    existingArticles: listArticles(body),
    pendingSources,
  };
}

// CLI entry point
const [, , kbRootArg, projectArg] = process.argv;
if (kbRootArg && projectArg) {
  try {
    console.log(JSON.stringify(buildPlan(kbRootArg, projectArg)));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && npx vitest run compile-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/compile-plan.ts scripts/compile-plan.test.ts
git commit -m "feat: add compile-plan synthesis brief builder"
```

---

### Task 5: `compile-commit` — write articles and update indexes (keystone)

**Files:**
- Create: `scripts/compile-commit.ts`
- Test: `scripts/compile-commit.test.ts`

Responsibility: take caller-synthesized article operations, validate them, write article files, refresh the project `## Articles` list, move consumed sources pending→compiled, and update the root registry article count. All-or-nothing on validation.

- [ ] **Step 1: Write the failing test**

Create `scripts/compile-commit.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commit, validateCommit, renderArticle, CommitInput } from "./compile-commit.js";
import { parseDoc } from "./contract.js";
import { listPending, listArticles, getSection } from "./index-sections.js";
import { readRoot, findProject } from "./registry.js";

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-commit-"));
  // root registry
  mkdirSync(kb, { recursive: true });
  writeFileSync(
    join(kb, "_index.md"),
    [
      "---",
      "kind: kb-root",
      "version: 1",
      "projects:",
      "  - name: p",
      "    description: test",
      "    keywords: []",
      "    path: projects/p",
      "    articles: 0",
      "---",
      "",
      "# Knowledge Base",
    ].join("\n")
  );
  // project
  const wiki = join(kb, "projects", "p", "wiki");
  mkdirSync(wiki, { recursive: true });
  writeFileSync(
    join(wiki, "_index.md"),
    [
      "---",
      "kind: kb-project",
      "name: p",
      "description: test",
      "keywords: []",
      "created: 2026-06-01",
      "---",
      "",
      "## Articles",
      "",
      "_No articles yet._",
      "",
      "## Raw Sources (pending)",
      "",
      "- raw/notes/a.md — added 2026-06-01, not yet compiled",
      "",
      "## Raw Sources (compiled)",
      "",
      "_None._",
      "",
      "## Raw Sources (archived)",
      "",
      "_None._",
    ].join("\n")
  );
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

const validInput: CommitInput = {
  project: "p",
  articles: [
    {
      op: "create",
      slug: "agent-loop",
      title: "Agent Loop",
      summary: "the planner/executor cycle",
      body: "The loop runs [[memory-tiers]] each turn.",
      sources: ["raw/notes/a.md"],
    },
  ],
  consumedPending: ["raw/notes/a.md"],
};

describe("validateCommit", () => {
  it("passes a well-formed input", () => {
    expect(validateCommit(validInput)).toEqual([]);
  });
  it("flags missing sources and bad slug", () => {
    const errs = validateCommit({
      project: "p",
      articles: [{ op: "create", slug: "Bad Slug", title: "T", summary: "s", body: "b", sources: [] }],
      consumedPending: [],
    });
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("renderArticle", () => {
  it("renders frontmatter + heading + summary + body", () => {
    const md = renderArticle(validInput.articles[0]);
    const { data, body } = parseDoc(md);
    expect(data.kind).toBe("kb-article");
    expect(data.sources).toEqual(["raw/notes/a.md"]);
    expect(body).toContain("# Agent Loop");
    expect(body).toContain("*the planner/executor cycle*");
    expect(body).toContain("[[memory-tiers]]");
  });
});

describe("commit", () => {
  it("writes the article file", () => {
    const res = commit(kb, validInput);
    expect(res.written).toEqual(["agent-loop"]);
    expect(existsSync(join(kb, "projects", "p", "wiki", "agent-loop.md"))).toBe(true);
  });

  it("updates the project index: articles + pending→compiled", () => {
    commit(kb, validInput);
    const { body } = parseDoc(readFileSync(join(kb, "projects", "p", "wiki", "_index.md"), "utf-8"));
    expect(listArticles(body)).toEqual([{ slug: "agent-loop", summary: "the planner/executor cycle" }]);
    expect(listPending(body)).toEqual([]);
    expect(getSection(body, "Raw Sources (compiled)")).toContain("raw/notes/a.md");
  });

  it("updates the root registry article count", () => {
    const res = commit(kb, validInput);
    expect(res.pendingRemaining).toBe(0);
    expect(findProject(readRoot(kb), "p")?.articles).toBe(1);
  });

  it("throws and writes nothing on validation failure", () => {
    const bad: CommitInput = {
      project: "p",
      articles: [{ op: "create", slug: "x", title: "X", summary: "s", body: "b", sources: [] }],
      consumedPending: [],
    };
    expect(() => commit(kb, bad)).toThrow(/validation failed/);
    expect(existsSync(join(kb, "projects", "p", "wiki", "x.md"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && npx vitest run compile-commit.test.ts`
Expected: FAIL — cannot resolve `./compile-commit.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/compile-commit.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseDoc,
  stringifyDoc,
  slugify,
  today,
  ArticleFrontmatter,
} from "./contract.js";
import {
  listPending,
  listArticles,
  upsertArticleEntries,
  setArticles,
  moveToCompiled,
} from "./index-sections.js";
import { readRoot, writeRoot, setArticleCount } from "./registry.js";

export interface ArticleOp {
  op: "create" | "update";
  slug: string;
  title: string;
  summary: string;
  body: string;
  sources: string[];
}

export interface CommitInput {
  project: string;
  articles: ArticleOp[];
  consumedPending: string[];
}

export interface CommitResult {
  written: string[];
  updated: string[];
  pendingRemaining: number;
}

export function validateCommit(input: CommitInput): string[] {
  const errors: string[] = [];
  for (const a of input.articles) {
    if (!a.slug || slugify(a.slug) !== a.slug) errors.push(`invalid slug: "${a.slug}"`);
    if (!a.title) errors.push(`article "${a.slug}" missing title`);
    if (!a.sources || a.sources.length === 0) errors.push(`article "${a.slug}" has no sources`);
  }
  return errors;
}

export function renderArticle(a: ArticleOp): string {
  const fm: ArticleFrontmatter = { kind: "kb-article", sources: a.sources };
  const body = `# ${a.title}\n\n*${a.summary}*\n\n${a.body}`;
  return stringifyDoc(fm as unknown as Record<string, any>, body);
}

export function commit(kbRoot: string, input: CommitInput): CommitResult {
  const errors = validateCommit(input);
  if (errors.length) {
    throw new Error(`compile-commit validation failed: ${errors.join("; ")}`);
  }

  const projectDir = join(kbRoot, "projects", input.project);
  const wikiDir = join(projectDir, "wiki");
  mkdirSync(wikiDir, { recursive: true });

  // 1. Write article files.
  const written: string[] = [];
  const updated: string[] = [];
  for (const a of input.articles) {
    writeFileSync(join(wikiDir, `${a.slug}.md`), renderArticle(a));
    (a.op === "create" ? written : updated).push(a.slug);
  }

  // 2. Update project index: articles + move consumed pending → compiled.
  const wikiIndexPath = join(wikiDir, "_index.md");
  const idx = parseDoc(readFileSync(wikiIndexPath, "utf-8"));
  const mergedArticles = upsertArticleEntries(
    listArticles(idx.body),
    input.articles.map((a) => ({ slug: a.slug, summary: a.summary }))
  );
  let body = setArticles(idx.body, mergedArticles);
  body = moveToCompiled(body, input.consumedPending, today());
  writeFileSync(wikiIndexPath, stringifyDoc(idx.data, body));

  // 3. Update root registry article count.
  const root = readRoot(kbRoot);
  writeRoot(kbRoot, setArticleCount(root, input.project, mergedArticles.length));

  return { written, updated, pendingRemaining: listPending(body).length };
}

// CLI entry point — reads CommitInput JSON from stdin.
if (process.argv[2]) {
  const kbRootArg = process.argv[2];
  let raw = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(raw) as CommitInput;
      console.log(JSON.stringify(commit(kbRootArg, input)));
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && npx vitest run compile-commit.test.ts`
Expected: PASS (all cases, including the no-write-on-failure case).

- [ ] **Step 5: Run the full suite to confirm nothing regressed**

Run: `cd scripts && npx vitest run`
Expected: PASS — all new suites plus the pre-existing `preprocess-*` suites.

- [ ] **Step 6: Commit**

```bash
git add scripts/compile-commit.ts scripts/compile-commit.test.ts
git commit -m "feat: add compile-commit deterministic article writer"
```

---

## Self-Review

**1. Spec coverage (this plan's scope — contract + compile vertical):**
- Part A layout + frontmatter schemas → Task 1 types; exercised by Tasks 3–5 fixtures. ✓
- Part A frontmatter parse/stringify → Task 1. ✓
- Part B invariant: names canonical, kebab-case → `isValidProjectName` (Task 1), slug validation in `validateCommit` (Task 5). ✓
- Part B invariant: registry is source of truth / article count synced → `registry.ts` (Task 3), `setArticleCount` call in `commit` (Task 5). ✓
- Part B invariant: pending recorded on disk → `index-sections` pending helpers (Task 2), pending→compiled move in `commit` (Task 5). ✓
- Part D `compile-plan` (brief) → Task 4. ✓
- Part D `compile-commit` (validate → write → update indexes → update root) → Task 5. ✓
- Part D "validate first, write nothing on failure" → Task 5 Step 1 last test + implementation order. ✓
- **Out of scope (deferred to follow-on plans, noted in header):** `resolve.ts`, `ingest.ts`, `retrieve.ts`, `core.ts`, skills, hooks, `sync.ts`, migration. ✓ (intentional)

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every run step has an exact command and expected result. ✓

**3. Type consistency:** `ArticleEntry {slug, summary}` (Task 2) is reused in Task 4 (`existingArticles`) and Task 5 (`upsertArticleEntries`). `ArticleOp`/`CommitInput`/`CommitResult` (Task 5) are internally consistent. `RootFrontmatter`/`ProjectRegistryEntry` (Task 1) used by `registry.ts` (Task 3) and `commit` (Task 5). `parseDoc`/`stringifyDoc`/`slugify`/`today` (Task 1) used consistently downstream. Section heading strings (`"Raw Sources (pending)"`, `"Raw Sources (compiled)"`, `"Articles"`) match between `index-sections.ts` and its callers. ✓
