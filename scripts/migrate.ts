import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
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

// Rewrite legacy wikilinks to the new projects/ form. Passing `projectNames`
// also catches the old short-form cross-project links (`[[<project>/article]]`
// and `[[<project>/wiki/...]]`) that have no `topics/` prefix — without a
// project list we can only safely rewrite the explicit `[[topics/...]]` form.
export function rewriteWikilinks(text: string, projectNames: string[] = []): string {
  const projects = new Set(projectNames);
  return text.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (m, rawTarget: string, alias = "") => {
    let target = rawTarget;
    if (target.startsWith("topics/")) {
      target = "projects/" + target.slice("topics/".length);
    }
    const slash = target.indexOf("/");
    if (slash !== -1) {
      const first = target.slice(0, slash);
      if (first !== "projects" && projects.has(first)) {
        const rest = target.slice(slash + 1);
        target = rest.startsWith("wiki/")
          ? `projects/${target}`                      // [[p/wiki/x]] -> [[projects/p/wiki/x]]
          : `projects/${first}/wiki/${rest}`;         // [[p/article]] -> [[projects/p/wiki/article]]
      }
    }
    return target === rawTarget ? m : `[[${target}${alias}]]`;
  });
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

const CORE_INDEX_MD = `---
kind: kb-core
version: 1
---

# Core Memory

_Durable, always-loaded facts about the user. Maintained via \`/kb-core\`._
`;

const NEW_CLAUDE_MD = `# Knowledge Base

An LLM-maintained personal knowledge base. The LLM writes and maintains wiki content.

## Layout
projects/<name>/
  raw/        — source-of-truth originals (notes, documents, videos, links, images, _archive)
  planning/   — plans, specs, todos
  assets/     — datasets, designs, large artifacts
  wiki/       — synthesized articles + _index.md
core/_index.md — always-loaded durable facts about the user
_index.md      — root registry (frontmatter \`projects:\`) + cross-project connections

## Rules
- Never edit raw/ — originals; archive outdated ones to raw/_archive/.
- raw/ is the source of truth; wiki/ is derived via /kb-compile. Deferring compile never loses data.
- Wiki articles are synthesized from multiple sources, each with a Sources section.
- Same-project links: [[article]]. Cross-project: [[projects/<other>/wiki/<article>]].
- The root registry frontmatter is the source of truth for which projects exist.
`;

const STANDARD_GITIGNORE = [".obsidian/workspace.json", ".obsidian/workspace-mobile.json", ".kb-active"].join("\n") + "\n";

// Bring an old KB up to the new-layout scaffolding a fresh `kb-init` would create.
function scaffoldNewLayout(kbRoot: string): void {
  // core/_index.md — always-loaded core memory (absent in the old layout).
  const coreIndex = join(kbRoot, "core", "_index.md");
  if (!existsSync(coreIndex)) {
    mkdirSync(join(kbRoot, "core"), { recursive: true });
    writeFileSync(coreIndex, CORE_INDEX_MD);
  }

  // CLAUDE.md — refresh the stale old-layout template; leave a customized one alone.
  const claudePath = join(kbRoot, "CLAUDE.md");
  if (!existsSync(claudePath) || readFileSync(claudePath, "utf-8").includes("topics/")) {
    writeFileSync(claudePath, NEW_CLAUDE_MD);
  }

  // .gitignore — repoint topics/ → projects/ and ensure .kb-active is ignored.
  const giPath = join(kbRoot, ".gitignore");
  if (!existsSync(giPath)) {
    writeFileSync(giPath, STANDARD_GITIGNORE);
  } else {
    let gi = readFileSync(giPath, "utf-8").replace(/topics\//g, "projects/");
    if (!gi.split("\n").some((l) => l.trim() === ".kb-active")) {
      gi = gi.replace(/\n*$/, "") + "\n.kb-active\n";
    }
    writeFileSync(giPath, gi);
  }
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

  // 3. Rewrite wikilinks across all project markdown (full + short-form, project-aware).
  let linksRewritten = 0;
  for (const file of walkMarkdown(projectsDir)) {
    const text = readFileSync(file, "utf-8");
    const rewritten = rewriteWikilinks(text, topicNames);
    if (rewritten !== text) {
      writeFileSync(file, rewritten);
      linksRewritten++;
    }
  }

  // 4. Rebuild the root index registry (and rewrite its links).
  const rootIndex = join(kbRoot, "_index.md");
  if (existsSync(rootIndex)) {
    const original = readFileSync(rootIndex, "utf-8");
    const rewritten = rewriteWikilinks(original, topicNames);
    if (rewritten !== original) linksRewritten++;
    const { body } = parseDoc(rewritten);
    writeFileSync(rootIndex, stringifyDoc({ ...buildRootRegistry(metas) }, body));
  }

  // 5. Scaffold the new-layout files an old KB lacks (core/, CLAUDE.md, .gitignore).
  scaffoldNewLayout(kbRoot);

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
