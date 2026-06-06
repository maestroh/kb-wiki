import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPlan,
  resolve,
  type CompilePlan,
  type ResolveResult,
  type ResolveSignals,
} from "./kb.js";

// ---------------------------------------------------------------------------
// Minimal temp-KB fixture (mirrors compile-plan.test.ts / compile-commit.test.ts)
// ---------------------------------------------------------------------------
let kb: string;

beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-agent-"));

  // Root registry (_index.md) — needed for resolve/readRoot
  writeFileSync(
    join(kb, "_index.md"),
    [
      "---",
      "kind: kb-root",
      "version: 1",
      "projects:",
      "  - name: default",
      "    description: default project",
      "    keywords:",
      "      - default",
      "    path: projects/default",
      "    articles: 0",
      "---",
      "",
      "# Knowledge Base",
    ].join("\n")
  );

  // Project wiki/_index.md
  const wiki = join(kb, "projects", "default", "wiki");
  const notes = join(kb, "projects", "default", "raw", "notes");
  mkdirSync(wiki, { recursive: true });
  mkdirSync(notes, { recursive: true });

  writeFileSync(join(notes, "a.md"), "Note A content");

  writeFileSync(
    join(wiki, "_index.md"),
    [
      "---",
      "kind: kb-project",
      "name: default",
      "description: default project",
      "keywords: []",
      "created: 2026-06-01",
      "---",
      "",
      "## Articles",
      "",
      "- [[existing-article]] — an existing article",
      "",
      "## Raw Sources (pending)",
      "",
      "- raw/notes/a.md — added 2026-06-01, not yet compiled",
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
// buildPlan
// ---------------------------------------------------------------------------
describe("buildPlan", () => {
  it("returns a CompilePlan with the real field names (pendingSources + existingArticles)", () => {
    const plan: CompilePlan = buildPlan(kb, "default");
    expect(plan.project).toBe("default");

    // Real field: existingArticles (array of ArticleEntry objects)
    expect(Array.isArray(plan.existingArticles)).toBe(true);
    expect(plan.existingArticles).toEqual([
      { slug: "existing-article", summary: "an existing article" },
    ]);

    // Real field: pendingSources
    expect(Array.isArray(plan.pendingSources)).toBe(true);
    expect(plan.pendingSources).toEqual([
      { path: "raw/notes/a.md", content: "Note A content" },
    ]);
  });

  it("returns empty pendingSources when nothing is pending", () => {
    // Overwrite index with no pending
    writeFileSync(
      join(kb, "projects", "default", "wiki", "_index.md"),
      [
        "---",
        "kind: kb-project",
        "name: default",
        "description: default project",
        "keywords: []",
        "created: 2026-06-01",
        "---",
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
      ].join("\n")
    );
    expect(buildPlan(kb, "default").pendingSources).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolve convenience wrapper
// ---------------------------------------------------------------------------
describe("resolve (convenience wrapper: readRoot + matchProject)", () => {
  it("resolves by exact name to status=match", () => {
    const result: ResolveResult = resolve(kb, { name: "default", keywords: [] });
    expect(result.status).toBe("match");
    expect(result.project?.name).toBe("default");
  });

  it("resolves by keyword to status=match", () => {
    const result: ResolveResult = resolve(kb, { keywords: ["default"] });
    expect(result.status).toBe("match");
  });

  it("returns status=none for unknown name with no keywords", () => {
    const result: ResolveResult = resolve(kb, { name: "nonexistent", keywords: [] });
    expect(result.status).toBe("none");
  });

  it("accepts typed ResolveSignals", () => {
    const signals: ResolveSignals = { keywords: ["default"] };
    const r = resolve(kb, signals);
    expect(r.status).toBe("match");
  });
});
