import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRoot, writeRoot, findProject, upsertProject, setArticleCount } from "./registry.js";
import { parseDoc } from "./contract.js";

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-reg-"));
  const root = [
    "---",
    "kind: kb-root",
    "version: 1",
    "projects:",
    "  - name: acme-redesign",
    "    description: ACME portal redesign",
    "    keywords:",
    "      - acme",
    "    path: projects/acme-redesign",
    "    articles: 3",
    "---",
    "",
    "# Knowledge Base",
  ].join("\n");
  mkdirSync(kb, { recursive: true });
  writeFileSync(join(kb, "_index.md"), root);
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

describe("readRoot", () => {
  it("parses the registry", () => {
    const root = readRoot(kb);
    expect(root.kind).toBe("kb-root");
    expect(root.projects).toHaveLength(1);
    expect(root.projects[0].name).toBe("acme-redesign");
    expect(root.projects[0].articles).toBe(3);
  });
});

describe("findProject", () => {
  it("finds by name", () => {
    expect(findProject(readRoot(kb), "acme-redesign")?.articles).toBe(3);
  });
  it("returns undefined for unknown", () => {
    expect(findProject(readRoot(kb), "nope")).toBeUndefined();
  });
});

describe("upsertProject + writeRoot", () => {
  it("adds a new project and persists it", () => {
    const root = readRoot(kb);
    const updated = upsertProject(root, {
      name: "blog",
      description: "blog drafts",
      keywords: ["writing"],
      path: "projects/blog",
      articles: 0,
    });
    writeRoot(kb, updated);
    const reread = readRoot(kb);
    expect(reread.projects.map((p) => p.name).sort()).toEqual(["acme-redesign", "blog"]);
  });
  it("replaces an existing entry by name (no dupes)", () => {
    const root = readRoot(kb);
    const updated = upsertProject(root, {
      name: "acme-redesign",
      description: "changed",
      keywords: ["acme"],
      path: "projects/acme-redesign",
      articles: 9,
    });
    expect(updated.projects).toHaveLength(1);
    expect(updated.projects[0].description).toBe("changed");
    expect(updated.projects[0].articles).toBe(9);
  });
});

describe("setArticleCount", () => {
  it("updates the count for a project", () => {
    const updated = setArticleCount(readRoot(kb), "acme-redesign", 7);
    expect(findProject(updated, "acme-redesign")?.articles).toBe(7);
  });
});
