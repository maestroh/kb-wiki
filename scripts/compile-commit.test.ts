import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commit, validateCommit, renderArticle, CommitInput } from "./compile-commit.js";
import { parseDoc } from "./contract.js";
import { listPending, listArticles, getSection } from "./index-sections.js";
import { readRoot, findProject } from "./registry.js";

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-commit-"));
  // root registry
  mkdirSync(kb, { recursive: true });
  writeFileSync(
    join(kb, "_index.md"),
    [
      "---",
      "kind: kb-root",
      "version: 1",
      "projects:",
      "  - name: p",
      "    description: test",
      "    keywords: []",
      "    path: projects/p",
      "    articles: 0",
      "---",
      "",
      "# Knowledge Base",
    ].join("\n")
  );
  // project
  const wiki = join(kb, "projects", "p", "wiki");
  mkdirSync(wiki, { recursive: true });
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

const validInput: CommitInput = {
  project: "p",
  articles: [
    {
      op: "create",
      slug: "agent-loop",
      title: "Agent Loop",
      summary: "the planner/executor cycle",
      body: "The loop runs [[memory-tiers]] each turn.",
      sources: ["raw/notes/a.md"],
    },
  ],
  consumedPending: ["raw/notes/a.md"],
};

describe("validateCommit", () => {
  it("passes a well-formed input", () => {
    expect(validateCommit(validInput)).toEqual([]);
  });
  it("flags missing sources and bad slug", () => {
    const errs = validateCommit({
      project: "p",
      articles: [{ op: "create", slug: "Bad Slug", title: "T", summary: "s", body: "b", sources: [] }],
      consumedPending: [],
    });
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("renderArticle", () => {
  it("renders frontmatter + heading + summary + body", () => {
    const md = renderArticle(validInput.articles[0]);
    const { data, body } = parseDoc(md);
    expect(data.kind).toBe("kb-article");
    expect(data.sources).toEqual(["raw/notes/a.md"]);
    expect(body).toContain("# Agent Loop");
    expect(body).toContain("*the planner/executor cycle*");
    expect(body).toContain("[[memory-tiers]]");
  });
});

describe("commit", () => {
  it("writes the article file", () => {
    const res = commit(kb, validInput);
    expect(res.written).toEqual(["agent-loop"]);
    expect(existsSync(join(kb, "projects", "p", "wiki", "agent-loop.md"))).toBe(true);
  });

  it("updates the project index: articles + pending→compiled", () => {
    commit(kb, validInput);
    const { body } = parseDoc(readFileSync(join(kb, "projects", "p", "wiki", "_index.md"), "utf-8"));
    expect(listArticles(body)).toEqual([{ slug: "agent-loop", summary: "the planner/executor cycle" }]);
    expect(listPending(body)).toEqual([]);
    expect(getSection(body, "Raw Sources (compiled)")).toContain("raw/notes/a.md");
  });

  it("updates the root registry article count", () => {
    const res = commit(kb, validInput);
    expect(res.pendingRemaining).toBe(0);
    expect(findProject(readRoot(kb), "p")?.articles).toBe(1);
  });

  it("throws and writes nothing on validation failure", () => {
    const bad: CommitInput = {
      project: "p",
      articles: [{ op: "create", slug: "x", title: "X", summary: "s", body: "b", sources: [] }],
      consumedPending: [],
    };
    expect(() => commit(kb, bad)).toThrow(/validation failed/);
    expect(existsSync(join(kb, "projects", "p", "wiki", "x.md"))).toBe(false);
  });
});
