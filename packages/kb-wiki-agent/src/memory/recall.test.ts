import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recall } from "./recall.js";

// ---------------------------------------------------------------------------
// Temp KB fixture
//
// One project "recipes" with keywords ["recipes", "cooking"].
// The project wiki/_index.md has:
//   - One compiled article: [[pasta-basics]] — How to cook pasta
//   - One pending raw note: raw/notes/risotto.md with non-trivial content
//
// Article bullet format (from index-sections.ts listArticles):
//   - [[slug]] — summary
// ---------------------------------------------------------------------------
let kb: string;

beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-recall-test-"));

  // Root registry (_index.md)
  writeFileSync(
    join(kb, "_index.md"),
    [
      "---",
      "kind: kb-root",
      "version: 1",
      "projects:",
      "  - name: recipes",
      "    description: recipe collection",
      "    keywords:",
      "      - recipes",
      "      - cooking",
      "    path: projects/recipes",
      "    articles: 1",
      "---",
      "",
      "# Knowledge Base",
    ].join("\n")
  );

  // Project directories
  const wiki = join(kb, "projects", "recipes", "wiki");
  const notes = join(kb, "projects", "recipes", "raw", "notes");
  mkdirSync(wiki, { recursive: true });
  mkdirSync(notes, { recursive: true });

  // The pending raw note content
  writeFileSync(
    join(notes, "risotto.md"),
    "Risotto requires constant stirring and warm stock added gradually."
  );

  // Project wiki/_index.md — has one article + one pending note
  writeFileSync(
    join(wiki, "_index.md"),
    [
      "---",
      "kind: kb-project",
      "name: recipes",
      "description: recipe collection",
      "keywords: []",
      "created: 2026-06-01",
      "---",
      "",
      "## Articles",
      "",
      "- [[pasta-basics]] — How to cook pasta",
      "",
      "## Raw Sources (pending)",
      "",
      "- raw/notes/risotto.md — added 2026-06-01, not yet compiled",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("recall — matching project", () => {
  it("returns a string containing the article slug, summary, pending content, and a 'recent' label", () => {
    // "cooking recipes" tokenizes to ["cooking", "recipes"] — both are keywords on the project
    const result = recall(kb, "cooking recipes");

    // wiki section: article present
    expect(result).toContain("pasta-basics");
    expect(result).toContain("How to cook pasta");

    // pending section: content present
    expect(result).toContain("Risotto requires constant stirring");

    // pending section: labeled as recent / not yet compiled
    const lower = result.toLowerCase();
    expect(lower).toMatch(/recent|not yet compiled/);
  });

  it("places wiki content before pending content", () => {
    const result = recall(kb, "recipes");
    const articleIdx = result.indexOf("pasta-basics");
    const pendingIdx = result.indexOf("Risotto requires");
    expect(articleIdx).toBeGreaterThanOrEqual(0);
    expect(pendingIdx).toBeGreaterThanOrEqual(0);
    expect(articleIdx).toBeLessThan(pendingIdx);
  });
});

describe("recall — no matching project", () => {
  it("returns a 'no matching project' note and does not throw", () => {
    const result = recall(kb, "zzz-xyz-no-match");
    // Should be a non-empty string describing no knowledge found
    expect(result).toBeTruthy();
    const lower = result.toLowerCase();
    expect(lower).toMatch(/no (matching |relevant )?project|no knowledge/);
  });
});
