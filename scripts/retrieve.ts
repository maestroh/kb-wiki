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
