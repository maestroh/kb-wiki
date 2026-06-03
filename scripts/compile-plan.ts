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
