import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rewriteWikilinks, buildRootRegistry, projectFrontmatterFor, migrate } from "./migrate.js";
import { parseDoc } from "./contract.js";
import { readRoot, findProject } from "./registry.js";

describe("rewriteWikilinks", () => {
  const projects = ["ai", "agent-architecture", "css"];

  it("rewrites full topics/ links, including aliases", () => {
    expect(rewriteWikilinks("see [[topics/ai/wiki/concept]]", projects)).toBe("see [[projects/ai/wiki/concept]]");
    expect(rewriteWikilinks("[[topics/ai/wiki/_index|AI]]", projects)).toBe("[[projects/ai/wiki/_index|AI]]");
  });

  it("rewrites short-form cross-project links to known projects", () => {
    expect(rewriteWikilinks("[[agent-architecture/agent-loop-pattern]]", projects)).toBe(
      "[[projects/agent-architecture/wiki/agent-loop-pattern]]"
    );
    expect(rewriteWikilinks("[[css/wiki/_index|css]]", projects)).toBe("[[projects/css/wiki/_index|css]]");
    expect(rewriteWikilinks("[[ai/foo|Alias]]", projects)).toBe("[[projects/ai/wiki/foo|Alias]]");
  });

  it("leaves intra-project links and unknown/already-migrated refs untouched", () => {
    expect(rewriteWikilinks("[[agent-loop]]", projects)).toBe("[[agent-loop]]");
    expect(rewriteWikilinks("[[unknown-thing/x]]", projects)).toBe("[[unknown-thing/x]]");
    expect(rewriteWikilinks("[[projects/ai/wiki/x]]", projects)).toBe("[[projects/ai/wiki/x]]");
  });

  it("falls back to topics/-only rewriting with no project list", () => {
    expect(rewriteWikilinks("[[topics/ai/wiki/x]]")).toBe("[[projects/ai/wiki/x]]");
    expect(rewriteWikilinks("[[ai/x]]")).toBe("[[ai/x]]"); // no project list → short-form untouched
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
    // article carries BOTH a full topics/ link and an old short-form cross-project link
    writeFileSync(
      join(aiWiki, "agent-loop.md"),
      "# Agent Loop\n\nRelated: [[topics/ai/wiki/memory]]\nAlso: [[ai/planning]]"
    );
    writeFileSync(join(kb, "_index.md"), ["# KB", "", "- [[topics/ai/wiki/_index|AI]]"].join("\n"));
    // old-layout CLAUDE.md + a .gitignore with topics/ patterns
    writeFileSync(join(kb, "CLAUDE.md"), "# Knowledge Base\n\n## Directory Structure\n\ntopics/<topic-name>/\n  wiki/\n");
    writeFileSync(join(kb, ".gitignore"), [".obsidian/workspace.json", ".DS_Store", "topics/*/raw/videos/*.mp4"].join("\n") + "\n");
  });
  afterEach(() => rmSync(kb, { recursive: true, force: true }));

  it("renames topics→projects, rewrites links (full + short-form), upgrades frontmatter, builds registry", () => {
    const res = migrate(kb);
    expect(res.renamed).toBe(1);
    expect(res.indexesUpgraded).toBe(1);
    expect(res.linksRewritten).toBeGreaterThanOrEqual(1);

    expect(existsSync(join(kb, "projects", "ai", "wiki", "_index.md"))).toBe(true);
    expect(existsSync(join(kb, "topics"))).toBe(false);

    // both link forms rewritten
    const article = readFileSync(join(kb, "projects", "ai", "wiki", "agent-loop.md"), "utf-8");
    expect(article).toContain("[[projects/ai/wiki/memory]]");
    expect(article).toContain("[[projects/ai/wiki/planning]]");

    // project frontmatter upgraded
    const { data } = parseDoc(readFileSync(join(kb, "projects", "ai", "wiki", "_index.md"), "utf-8"));
    expect(data.kind).toBe("kb-project");
    expect(data.name).toBe("ai");
    expect(data.description).toBe("AI research");

    // root registry built + root link rewritten
    expect(findProject(readRoot(kb), "ai")?.articles).toBe(1);
    expect(readFileSync(join(kb, "_index.md"), "utf-8")).toContain("[[projects/ai/wiki/_index|AI]]");
  });

  it("scaffolds core/_index.md, refreshes stale CLAUDE.md, and fixes .gitignore", () => {
    migrate(kb);

    // core created
    expect(existsSync(join(kb, "core", "_index.md"))).toBe(true);
    expect(parseDoc(readFileSync(join(kb, "core", "_index.md"), "utf-8")).data.kind).toBe("kb-core");

    // stale CLAUDE.md refreshed to the new layout
    const claude = readFileSync(join(kb, "CLAUDE.md"), "utf-8");
    expect(claude).toContain("projects/<name>");
    expect(claude).not.toContain("topics/<topic-name>");

    // .gitignore: .kb-active added, topics/ repointed to projects/
    const gi = readFileSync(join(kb, ".gitignore"), "utf-8");
    expect(gi).toContain(".kb-active");
    expect(gi).toContain("projects/*/raw/videos/*.mp4");
    expect(gi).not.toContain("topics/*");
  });

  it("refuses to run when projects/ already exists", () => {
    mkdirSync(join(kb, "projects"), { recursive: true });
    expect(() => migrate(kb)).toThrow(/already exists/);
  });
});
