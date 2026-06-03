import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPlan } from "./compile-plan.js";

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-plan-"));
  const wiki = join(kb, "projects", "p", "wiki");
  const raw = join(kb, "projects", "p", "raw", "notes");
  mkdirSync(wiki, { recursive: true });
  mkdirSync(raw, { recursive: true });
  writeFileSync(join(raw, "a.md"), "Note A content");
  const index = [
    "---",
    "kind: kb-project",
    "name: p",
    "description: test",
    "keywords: []",
    "created: 2026-06-01",
    "---",
    "",
    "## Articles",
    "",
    "- [[existing]] — an existing article",
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
  ].join("\n");
  writeFileSync(join(wiki, "_index.md"), index);
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

describe("buildPlan", () => {
  it("returns pending sources with content and existing articles", () => {
    const plan = buildPlan(kb, "p");
    expect(plan.project).toBe("p");
    expect(plan.existingArticles).toEqual([
      { slug: "existing", summary: "an existing article" },
    ]);
    expect(plan.pendingSources).toEqual([
      { path: "raw/notes/a.md", content: "Note A content" },
    ]);
  });

  it("returns empty pending when nothing is pending", () => {
    const wiki = join(kb, "projects", "p", "wiki");
    writeFileSync(
      join(wiki, "_index.md"),
      [
        "---",
        "kind: kb-project",
        "name: p",
        "description: test",
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
      ].join("\n")
    );
    expect(buildPlan(kb, "p").pendingSources).toEqual([]);
  });

  it("yields empty content for a pending source whose file is missing", () => {
    const wiki = join(kb, "projects", "p", "wiki");
    writeFileSync(
      join(wiki, "_index.md"),
      [
        "---",
        "kind: kb-project",
        "name: p",
        "description: test",
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
        "- raw/notes/missing.md — added 2026-06-01, not yet compiled",
        "",
        "## Raw Sources (compiled)",
        "",
        "_None._",
      ].join("\n")
    );
    expect(buildPlan(kb, "p").pendingSources).toEqual([
      { path: "raw/notes/missing.md", content: "" },
    ]);
  });
});
