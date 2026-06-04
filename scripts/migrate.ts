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
