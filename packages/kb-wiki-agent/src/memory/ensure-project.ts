/**
 * ensure-project.ts — idempotent project scaffold for the agent.
 *
 * Called unconditionally before every ingest so that:
 *   - existing project → no-op (fast path, just a stat check)
 *   - brand-new project returned by resolveProject (created: true) → full scaffold
 *
 * Mirrors the kb-project SKILL's "create" behavior (step 2–4), but skips the
 * human-facing body "## Projects" navigation list in the root _index.md body.
 * That nicety is intentionally not maintained here: writeRoot preserves the body
 * and only rewrites frontmatter; the body nav-list is kb-lint territory.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  readRoot,
  writeRoot,
  upsertProject,
  parseDoc,
  stringifyDoc,
} from "./kb.js";

/**
 * Ensure a project directory tree and wiki/_index.md exist.
 * Idempotent: if `projects/<name>/wiki/_index.md` already exists, returns immediately.
 *
 * @param kbRoot      Absolute path to the knowledge-base root.
 * @param name        Kebab-case project name (e.g. "acme-redesign").
 * @param description Optional one-line description stored in frontmatter.
 */
export function ensureProject(kbRoot: string, name: string, description?: string): void {
  const projectDir = join(kbRoot, "projects", name);
  const wikiIndexPath = join(projectDir, "wiki", "_index.md");

  // ── Idempotency check ─────────────────────────────────────────────────────
  if (existsSync(wikiIndexPath)) return;

  // ── Scaffold directory tree ───────────────────────────────────────────────
  // Mirrors kb-project SKILL step 2:
  //   projects/<name>/raw/{notes,documents,videos,links,images,_archive}
  //   projects/<name>/planning
  //   projects/<name>/assets
  //   projects/<name>/wiki
  for (const subdir of [
    "raw/notes",
    "raw/documents",
    "raw/videos",
    "raw/links",
    "raw/images",
    "raw/_archive",
    "planning",
    "assets",
    "wiki",
  ]) {
    mkdirSync(join(projectDir, subdir), { recursive: true });
  }

  // ── Compute today's date (YYYY-MM-DD) ─────────────────────────────────────
  const created = new Date().toISOString().slice(0, 10);

  // ── Build the wiki/_index.md frontmatter + body ───────────────────────────
  // Body section headings and placeholders must match what index-sections.ts
  // parses: getSection("Articles"), getSection("Raw Sources (pending)"), etc.
  // Placeholder tokens: "_No articles yet._" and "_None._"
  // (see setArticles / addPending / listPending in index-sections.ts)
  //
  // Title case: split on hyphens, capitalize each word.
  const title = name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const frontmatter = {
    kind: "kb-project" as const,
    name,
    description: description ?? "",
    keywords: [] as string[],
    created,
  };

  const body = [
    `# ${title}`,
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
    "",
    "## Raw Sources (archived)",
    "",
    "_None._",
  ].join("\n");

  writeFileSync(wikiIndexPath, stringifyDoc(frontmatter, body));

  // ── Register in root _index.md frontmatter ────────────────────────────────
  // writeRoot preserves the body; only the frontmatter (projects array) is updated.
  // NOTE: The body "## Projects" nav-list in the root _index.md is intentionally
  // NOT updated here — that is a human-facing nicety that kb-lint owns.
  const root = readRoot(kbRoot);
  writeRoot(
    kbRoot,
    upsertProject(root, {
      name,
      description: description ?? "",
      keywords: [],
      path: `projects/${name}`,
      articles: 0,
    })
  );
}
