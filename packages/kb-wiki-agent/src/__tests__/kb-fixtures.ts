/**
 * kb-fixtures.ts — Shared temp-KB helpers for tests.
 *
 * NOT a test file (no *.test.ts suffix) — vitest won't run it as a suite.
 * Import from any test that needs a minimal kb-wiki init layout on disk.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Root _index.md generator
// ---------------------------------------------------------------------------

/**
 * Produce YAML+body for a root _index.md with an (optionally empty) project list.
 */
export function makeRootIndex(
  projects: Array<{ name: string; description: string; keywords: string[]; path: string }>
): string {
  const projectLines = projects.flatMap((p) => [
    `  - name: ${p.name}`,
    `    description: ${p.description}`,
    `    keywords:`,
    ...p.keywords.map((k) => `      - ${k}`),
    `    path: ${p.path}`,
    `    articles: 0`,
  ]);
  return [
    "---",
    "kind: kb-root",
    "version: 1",
    "projects:",
    ...projectLines,
    "---",
    "",
    "# Knowledge Base",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// makeTempKb
// ---------------------------------------------------------------------------

/**
 * Create a minimal kb-wiki `init` layout in a new temp directory.
 *
 * Layout:
 *   <root>/
 *     _index.md          — frontmatter kind:kb-root, version:1, projects:[]
 *     core/
 *       _index.md        — frontmatter kind:kb-core, version:1, body with a couple facts
 *
 * Returns the absolute path to the temp root.
 */
export function makeTempKb(): string {
  const root = mkdtempSync(join(tmpdir(), "kb-e2e-"));

  // Root registry — empty project list; capture will create projects on the fly.
  writeFileSync(join(root, "_index.md"), makeRootIndex([]));

  // core/_index.md — required by listFacts / coreFacts; minimal but valid.
  const coreDir = join(root, "core");
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(
    join(coreDir, "_index.md"),
    [
      "---",
      "kind: kb-core",
      "version: 1",
      "---",
      "",
      "# Core Memory",
      "",
      "- Uses kb-wiki for knowledge management",
      "- Stores notes in projects",
    ].join("\n")
  );

  return root;
}

// ---------------------------------------------------------------------------
// cleanupKb
// ---------------------------------------------------------------------------

/**
 * Recursively remove a temp KB created by makeTempKb().
 */
export function cleanupKb(kbPath: string): void {
  rmSync(kbPath, { recursive: true, force: true });
}
