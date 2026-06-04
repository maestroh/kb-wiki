import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rewriteWikilinks, buildRootRegistry, projectFrontmatterFor, migrate } from "./migrate.js";
import { parseDoc } from "./contract.js";
import { readRoot, findProject } from "./registry.js";

describe("rewriteWikilinks", () => {
  it("rewrites topic links to project links, including aliases", () => {
    expect(rewriteWikilinks("see [[topics/ai/wiki/concept]]")).toBe("see [[projects/ai/wiki/concept]]");
    expect(rewriteWikilinks("[[topics/ai/wiki/_index|AI]]")).toBe("[[projects/ai/wiki/_index|AI]]");
  });
  it("leaves intra-project links untouched", () => {
    expect(rewriteWikilinks("[[agent-loop]]")).toBe("[[agent-loop]]");
  });
});

describe("buildRootRegistry", () => {
  it("builds a kb-root frontmatter from project metas", () => {
    const root = buildRootRegistry([{ name: "ai", description: "d", keywords: ["k"], articles: 2 }]);
    expect(root.kind).toBe("kb-root");
    expect(root.projects[0]).toEqual({ name: "ai", description: "d", keywords: ["k"], path: "projects/ai", articles: 2 });
  });
});

describe("projectFrontmatterFor", () => {
  it("fills kb-project frontmatter, preserving existing fields", () => {
    const fm = projectFrontmatterFor("ai", { description: "existing", keywords: ["x"], created: "2026-01-01" });
    expect(fm).toEqual({ kind: "kb-project", name: "ai", description: "existing", keywords: ["x"], created: "2026-01-01" });
  });
  it("defaults missing fields", () => {
    const fm = projectFrontmatterFor("ai", {});
    expect(fm.kind).toBe("kb-project");
    expect(fm.name).toBe("ai");
    expect(fm.description).toBe("");
    expect(fm.keywords).toEqual([]);
    expect(fm.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("migrate (integration on a fixture KB)", () => {
  let kb: string;
  beforeEach(() => {
    kb = mkdtempSync(join(tmpdir(), "kb-migrate-"));
    // OLD layout
    const aiWiki = join(kb, "topics", "ai", "wiki");
    mkdirSync(aiWiki, { recursive: true });
    mkdirSync(join(kb, "topics", "ai", "raw", "notes"), { recursive: true });
    writeFileSync(
      join(aiWiki, "_index.md"),
      ["---", "description: AI research", "---", "", "## Articles", "", "- [[agent-loop]] — the loop", "", "## Raw Sources (pending)", "", "_None._"].join("\n")
    );
    writeFileSync(join(aiWiki, "agent-loop.md"), "# Agent Loop\n\nRelated: [[topics/ai/wiki/memory]]");
    writeFileSync(join(kb, "_index.md"), ["# KB", "", "- [[topics/ai/wiki/_index|AI]]"].join("\n"));
  });
  afterEach(() => rmSync(kb, { recursive: true, force: true }));

  it("renames topics→projects, rewrites links, upgrades frontmatter, builds registry", () => {
    const res = migrate(kb);
    expect(res.renamed).toBe(1);
    expect(res.indexesUpgraded).toBe(1);
    expect(res.linksRewritten).toBeGreaterThanOrEqual(1);

    expect(existsSync(join(kb, "projects", "ai", "wiki", "_index.md"))).toBe(true);
    expect(existsSync(join(kb, "topics"))).toBe(false);

    // article link rewritten
    const article = readFileSync(join(kb, "projects", "ai", "wiki", "agent-loop.md"), "utf-8");
    expect(article).toContain("[[projects/ai/wiki/memory]]");

    // project frontmatter upgraded
    const { data } = parseDoc(readFileSync(join(kb, "projects", "ai", "wiki", "_index.md"), "utf-8"));
    expect(data.kind).toBe("kb-project");
    expect(data.name).toBe("ai");
    expect(data.description).toBe("AI research");

    // root registry built + root link rewritten
    expect(findProject(readRoot(kb), "ai")?.articles).toBe(1);
    expect(readFileSync(join(kb, "_index.md"), "utf-8")).toContain("[[projects/ai/wiki/_index|AI]]");
  });

  it("refuses to run when projects/ already exists", () => {
    mkdirSync(join(kb, "projects"), { recursive: true });
    expect(() => migrate(kb)).toThrow(/already exists/);
  });
});
