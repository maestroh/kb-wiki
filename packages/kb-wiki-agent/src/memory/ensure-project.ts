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

// ---------------------------------------------------------------------------
// Registry-entry shape helper — single source of truth for both the early-
// return recovery path and the normal scaffold path below.
// ---------------------------------------------------------------------------

function buildRegistryEntry(name: string, description: string) {
  return {
    name,
    description,
    keywords: [] as string[],
    path: `projects/${name}`,
    articles: 0,
  };
}

/**
 * Ensure a project directory tree and wiki/_index.md exist.
 * Idempotent: if `projects/<name>/wiki/_index.md` already exists the scaffold
 * step is skipped, but the registry entry is still upserted in case a prior
 * call crashed after writing the index but before registering the project
 * (split-brain recovery).
 *
 * @param kbRoot      Absolute path to the knowledge-base root.
 * @param name        Kebab-case project name (e.g. "acme-redesign").
 * @param description Optional one-line description stored in frontmatter.
 */
export function ensureProject(kbRoot: string, name: string, description?: string): void {
  const projectDir = join(kbRoot, "projects", name);
  const wikiIndexPath = join(projectDir, "wiki", "_index.md");

  // ── Idempotency check (split-brain safe) ──────────────────────────────────
  // If the wiki index already exists the directory scaffold is done, but the
  // registry might be missing if the previous call crashed between writeFile
  // and writeRoot. Upsert the entry if absent, then return.
  if (existsSync(wikiIndexPath)) {
    const root = readRoot(kbRoot);
    if (!root.projects.some((p) => p.name === name)) {
      writeRoot(kbRoot, upsertProject(root, buildRegistryEntry(name, description ?? "")));
    }
    return;
  }

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
  // IMPORTANT: Section headings below ("## Articles", "## Raw Sources (pending|compiled|archived)")
  // and placeholder tokens ("_No articles yet._", "_None._") are the authoritative
  // parser inputs for kb-wiki-scripts/index-sections.ts (getSection, listArticles,
  // listPending). Any rename here must be mirrored there, and vice versa.
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
  writeRoot(kbRoot, upsertProject(root, buildRegistryEntry(name, description ?? "")));
}
