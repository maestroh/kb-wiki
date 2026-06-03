# kb-wiki Sync & Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `sync.ts` (headless-friendly git sync) and `migrate.ts` (one-time `topics/`→`projects/` upgrade) for the redesigned kb-wiki.

**Architecture:** Two deterministic TypeScript scripts. `sync.ts` shells out to git via `execSync` (matching the existing `preprocess-video.ts`), with the stage-commit-before-pull ordering and optional token auth the headless backend needs. `migrate.ts` renames the topic tree, rewrites wikilinks, and injects the new frontmatter, reusing Plan 1's contract lib. Both have pure, unit-testable seams; git is exercised against a fully offline local bare remote.

**Tech Stack:** TypeScript (ESM), tsx, vitest, `node:child_process` (`execSync`). Depends on Plan 1's contract lib. **Requires real `git` on PATH in the test environment** (the sync + migration integration tests invoke it).

**Scope note — this is Plan 4 of the sequence.** `sync.ts` is also consumed by Plan 3's hooks (`SessionEnd` → sync; `PreCompact` → ingest + sync).

**Working directory for all commands:** `scripts/`.

**Plan 1 surface reused (imported, never redefined):**
- `./contract.js`: `parseDoc`, `stringifyDoc`, `today`, `KB_VERSION`; types `RootFrontmatter`, `ProjectRegistryEntry`.
- `./index-sections.js`: `listArticles`.

---

### Task 1: `sync.ts` — headless git sync

**Files:**
- Create: `scripts/sync.ts`
- Test: `scripts/sync.test.ts`

Responsibility: stage → commit (if dirty) → `pull --rebase` → push, in that order (a dirty tree aborts rebase, and auto-debounced sync fires right after ingest leaves files unstaged — so naive pull-first always fails). Optional `KNOWLEDGE_GIT_TOKEN` is injected into the push URL for headless auth without persisting to disk config.

- [ ] **Step 1: Write the failing test**

Create `scripts/sync.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { tokenizeRemoteUrl, sync } from "./sync.js";

describe("tokenizeRemoteUrl", () => {
  it("injects a token into an https remote", () => {
    expect(tokenizeRemoteUrl("https://github.com/o/r.git", "TKN")).toBe("https://TKN@github.com/o/r.git");
  });
  it("leaves non-https remotes unchanged", () => {
    expect(tokenizeRemoteUrl("/tmp/remote.git", "TKN")).toBe("/tmp/remote.git");
  });
});

describe("sync (offline local remote)", () => {
  let work: string;
  let remote: string;
  const git = (dir: string, cmd: string) => execSync(`git ${cmd}`, { cwd: dir, encoding: "utf-8" });

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), "kb-sync-"));
    work = join(base, "work");
    remote = join(base, "remote.git");
    execSync(`git init --bare "${remote}"`);
    execSync(`git clone "${remote}" "${work}"`);
    git(work, 'config user.email "t@t.t"');
    git(work, 'config user.name "t"');
    writeFileSync(join(work, "seed.md"), "seed");
    git(work, "add -A");
    git(work, 'commit -m seed');
    git(work, "push -u origin HEAD:main");
  });
  afterEach(() => rmSync(join(work, ".."), { recursive: true, force: true }));

  it("commits a dirty tree and pushes", () => {
    writeFileSync(join(work, "new.md"), "new content");
    const res = sync(work);
    expect(res.committed).toBe(true);
    expect(res.files).toContain("new.md");
    expect(res.pushed).toBe(true);
    // verify the remote received it
    const log = execSync(`git --git-dir="${remote}" log --oneline`, { encoding: "utf-8" });
    expect(log).toMatch(/kb sync/);
  });

  it("is a no-op commit on a clean tree but still pushes", () => {
    const res = sync(work);
    expect(res.committed).toBe(false);
    expect(res.files).toEqual([]);
    expect(res.pushed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && npx vitest run sync.test.ts`
Expected: FAIL — cannot resolve `./sync.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/sync.ts`:

```typescript
import { execSync } from "node:child_process";

export function tokenizeRemoteUrl(url: string, token: string): string {
  return url.replace(/^https:\/\//, `https://${token}@`);
}

export interface SyncResult {
  committed: boolean;
  pushed: boolean;
  files: string[];
}

export function sync(repoDir: string, opts: { token?: string; message?: string } = {}): SyncResult {
  const run = (cmd: string): string =>
    execSync(cmd, { cwd: repoDir, encoding: "utf-8" }).trim();

  // 1. Stage and commit BEFORE pulling (rebase aborts on a dirty tree).
  run("git add -A");
  const staged = run("git diff --cached --name-only");
  const files = staged ? staged.split("\n").filter(Boolean) : [];
  let committed = false;
  if (files.length > 0) {
    const msg = (opts.message ?? "kb sync").replace(/"/g, '\\"');
    run(`git commit -m "${msg}"`);
    committed = true;
  }

  // 2. Rebase onto the remote (tree is now clean).
  run("git pull --rebase");

  // 3. Push — with token-injected URL when provided (headless auth).
  if (opts.token) {
    const remoteUrl = run("git remote get-url origin");
    const branch = run("git rev-parse --abbrev-ref HEAD");
    run(`git push "${tokenizeRemoteUrl(remoteUrl, opts.token)}" ${branch}`);
  } else {
    run("git push");
  }

  return { committed, pushed: true, files };
}

// CLI: sync.ts <repoDir>   (KNOWLEDGE_GIT_TOKEN env optional)
const [, , repoDirArg] = process.argv;
if (repoDirArg) {
  try {
    console.log(JSON.stringify(sync(repoDirArg, { token: process.env.KNOWLEDGE_GIT_TOKEN })));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && npx vitest run sync.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/sync.ts scripts/sync.test.ts
git commit -m "feat: add sync.ts headless git sync"
```

---

### Task 2: `migrate.ts` — `topics/` → `projects/` upgrade

**Files:**
- Create: `scripts/migrate.ts`
- Test: `scripts/migrate.test.ts`

Responsibility: one-time migration of an existing KB. Pure seams (`rewriteWikilinks`, `projectFrontmatterFor`, `buildRootRegistry`) are unit-tested; a fixture integration test exercises the whole `migrate`. Refuses to run if `projects/` already exists.

- [ ] **Step 1: Write the failing test**

Create `scripts/migrate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rewriteWikilinks, buildRootRegistry, projectFrontmatterFor, migrate } from "./migrate.js";
import { parseDoc } from "./contract.js";
import { readRoot, findProject } from "./registry.js";

describe("rewriteWikilinks", () => {
  it("rewrites topic links to project links, including aliases", () => {
    expect(rewriteWikilinks("see [[topics/ai/wiki/concept]]")).toBe("see [[projects/ai/wiki/concept]]");
    expect(rewriteWikilinks("[[topics/ai/wiki/_index|AI]]")).toBe("[[projects/ai/wiki/_index|AI]]");
  });
  it("leaves intra-project links untouched", () => {
    expect(rewriteWikilinks("[[agent-loop]]")).toBe("[[agent-loop]]");
  });
});

describe("buildRootRegistry", () => {
  it("builds a kb-root frontmatter from project metas", () => {
    const root = buildRootRegistry([{ name: "ai", description: "d", keywords: ["k"], articles: 2 }]);
    expect(root.kind).toBe("kb-root");
    expect(root.projects[0]).toEqual({ name: "ai", description: "d", keywords: ["k"], path: "projects/ai", articles: 2 });
  });
});

describe("projectFrontmatterFor", () => {
  it("fills kb-project frontmatter, preserving existing fields", () => {
    const fm = projectFrontmatterFor("ai", { description: "existing", keywords: ["x"], created: "2026-01-01" });
    expect(fm).toEqual({ kind: "kb-project", name: "ai", description: "existing", keywords: ["x"], created: "2026-01-01" });
  });
  it("defaults missing fields", () => {
    const fm = projectFrontmatterFor("ai", {});
    expect(fm.kind).toBe("kb-project");
    expect(fm.name).toBe("ai");
    expect(fm.description).toBe("");
    expect(fm.keywords).toEqual([]);
    expect(fm.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("migrate (integration on a fixture KB)", () => {
  let kb: string;
  beforeEach(() => {
    kb = mkdtempSync(join(tmpdir(), "kb-migrate-"));
    // OLD layout
    const aiWiki = join(kb, "topics", "ai", "wiki");
    mkdirSync(aiWiki, { recursive: true });
    mkdirSync(join(kb, "topics", "ai", "raw", "notes"), { recursive: true });
    writeFileSync(
      join(aiWiki, "_index.md"),
      ["---", "description: AI research", "---", "", "## Articles", "", "- [[agent-loop]] — the loop", "", "## Raw Sources (pending)", "", "_None._"].join("\n")
    );
    writeFileSync(join(aiWiki, "agent-loop.md"), "# Agent Loop\n\nRelated: [[topics/ai/wiki/memory]]");
    writeFileSync(join(kb, "_index.md"), ["# KB", "", "- [[topics/ai/wiki/_index|AI]]"].join("\n"));
  });
  afterEach(() => rmSync(kb, { recursive: true, force: true }));

  it("renames topics→projects, rewrites links, upgrades frontmatter, builds registry", () => {
    const res = migrate(kb);
    expect(res.renamed).toBe(1);
    expect(res.indexesUpgraded).toBe(1);
    expect(res.linksRewritten).toBeGreaterThanOrEqual(1);

    expect(existsSync(join(kb, "projects", "ai", "wiki", "_index.md"))).toBe(true);
    expect(existsSync(join(kb, "topics"))).toBe(false);

    // article link rewritten
    const article = readFileSync(join(kb, "projects", "ai", "wiki", "agent-loop.md"), "utf-8");
    expect(article).toContain("[[projects/ai/wiki/memory]]");

    // project frontmatter upgraded
    const { data } = parseDoc(readFileSync(join(kb, "projects", "ai", "wiki", "_index.md"), "utf-8"));
    expect(data.kind).toBe("kb-project");
    expect(data.name).toBe("ai");
    expect(data.description).toBe("AI research");

    // root registry built + root link rewritten
    expect(findProject(readRoot(kb), "ai")?.articles).toBe(1);
    expect(readFileSync(join(kb, "_index.md"), "utf-8")).toContain("[[projects/ai/wiki/_index|AI]]");
  });

  it("refuses to run when projects/ already exists", () => {
    mkdirSync(join(kb, "projects"), { recursive: true });
    expect(() => migrate(kb)).toThrow(/already exists/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts && npx vitest run migrate.test.ts`
Expected: FAIL — cannot resolve `./migrate.js`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/migrate.ts`:

```typescript
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  parseDoc,
  stringifyDoc,
  today,
  KB_VERSION,
  RootFrontmatter,
  ProjectRegistryEntry,
} from "./contract.js";
import { listArticles } from "./index-sections.js";

export function rewriteWikilinks(text: string): string {
  return text.replace(/\[\[topics\//g, "[[projects/");
}

export interface ProjectMeta {
  name: string;
  description: string;
  keywords: string[];
  articles: number;
}

export function buildRootRegistry(metas: ProjectMeta[]): RootFrontmatter {
  return {
    kind: "kb-root",
    version: KB_VERSION,
    projects: metas.map(
      (m): ProjectRegistryEntry => ({
        name: m.name,
        description: m.description,
        keywords: m.keywords,
        path: `projects/${m.name}`,
        articles: m.articles,
      })
    ),
  };
}

export function projectFrontmatterFor(name: string, existing: Record<string, any>): Record<string, any> {
  return {
    kind: "kb-project",
    name,
    description: typeof existing.description === "string" ? existing.description : "",
    keywords: Array.isArray(existing.keywords) ? existing.keywords : [],
    created: typeof existing.created === "string" ? existing.created : today(),
  };
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walkMarkdown(p));
    else if (entry.endsWith(".md")) out.push(p);
  }
  return out;
}

export interface MigrateResult {
  renamed: number;
  linksRewritten: number;
  indexesUpgraded: number;
}

export function migrate(kbRoot: string): MigrateResult {
  const topicsDir = join(kbRoot, "topics");
  const projectsDir = join(kbRoot, "projects");
  if (!existsSync(topicsDir)) throw new Error("no topics/ directory to migrate");
  if (existsSync(projectsDir)) throw new Error("projects/ already exists — refusing to clobber");

  const topicNames = readdirSync(topicsDir).filter((n) =>
    statSync(join(topicsDir, n)).isDirectory()
  );

  // 1. Rename the tree.
  renameSync(topicsDir, projectsDir);

  // 2. Upgrade each project index and collect registry metas.
  const metas: ProjectMeta[] = [];
  let indexesUpgraded = 0;
  for (const name of topicNames) {
    const wikiIndex = join(projectsDir, name, "wiki", "_index.md");
    if (!existsSync(wikiIndex)) continue;
    const { data, body } = parseDoc(readFileSync(wikiIndex, "utf-8"));
    const fm = projectFrontmatterFor(name, data);
    writeFileSync(wikiIndex, stringifyDoc(fm, body));
    indexesUpgraded++;
    metas.push({
      name,
      description: fm.description,
      keywords: fm.keywords,
      articles: listArticles(body).length,
    });
  }

  // 3. Rewrite wikilinks across all project markdown.
  let linksRewritten = 0;
  for (const file of walkMarkdown(projectsDir)) {
    const text = readFileSync(file, "utf-8");
    const rewritten = rewriteWikilinks(text);
    if (rewritten !== text) {
      writeFileSync(file, rewritten);
      linksRewritten++;
    }
  }

  // 4. Rebuild the root index registry (and rewrite its links).
  const rootIndex = join(kbRoot, "_index.md");
  if (existsSync(rootIndex)) {
    const original = readFileSync(rootIndex, "utf-8");
    const rewritten = rewriteWikilinks(original);
    if (rewritten !== original) linksRewritten++;
    const { body } = parseDoc(rewritten);
    writeFileSync(rootIndex, stringifyDoc({ ...buildRootRegistry(metas) }, body));
  }

  return { renamed: topicNames.length, linksRewritten, indexesUpgraded };
}

// CLI: migrate.ts <kbRoot>
const [, , kbRootArg] = process.argv;
if (kbRootArg) {
  try {
    console.log(JSON.stringify(migrate(kbRootArg)));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts && npx vitest run migrate.test.ts`
Expected: PASS (all unit + integration cases).

- [ ] **Step 5: Run the full suite**

Run: `cd scripts && npx vitest run`
Expected: PASS — all suites across Plans 1, 2, 4 plus the pre-existing `preprocess-*` suites.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate.ts scripts/migrate.test.ts
git commit -m "feat: add migrate.ts topics-to-projects migration"
```

---

## Self-Review

**1. Spec coverage:**
- `sync.ts` (Part C/G: stage-commit-before-pull, `KNOWLEDGE_GIT_TOKEN` auth, headless) → Task 1. ✓
- Migration ("Migration & skill changes": `topics/`→`projects/`, rewrite `[[topics/...]]`, inject frontmatter, build registry) → Task 2. ✓
- Idempotency/safety (refuse to clobber existing `projects/`) → Task 2 Step 1 last case + implementation guard. ✓

**2. Placeholder scan:** No TBD/TODO; all code is complete and runnable; run steps give exact commands + expected results. ✓

**3. Type consistency:** Imports Plan 1's `parseDoc`, `stringifyDoc`, `today`, `KB_VERSION`, `RootFrontmatter`, `ProjectRegistryEntry`, and `listArticles` — not redefined. `buildRootRegistry` returns `RootFrontmatter` exactly as Plan 1/Plan 3's `readRoot` expects (`kind`, `version`, `projects[]` with `{name,description,keywords,path,articles}`). New types (`SyncResult`, `ProjectMeta`, `MigrateResult`) are internally consistent. ✓

**4. Environment dependency:** Task 1 and Task 2's integration test require real `git` on PATH and run fully offline (local bare remote / temp dirs). Noted in the header. ✓
