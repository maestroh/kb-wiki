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
  return stringifyDoc({ ...fm }, body);
}

export function commit(kbRoot: string, input: CommitInput): CommitResult {
  const errors = validateCommit(input);
  if (errors.length) {
    throw new Error(`compile-commit validation failed: ${errors.join("; ")}`);
  }

  // The three write steps below are sequentially dependent but each is
  // idempotent (slug-keyed upserts, deterministic count), so re-running the
  // same input after a mid-write failure converges to the correct state.
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
