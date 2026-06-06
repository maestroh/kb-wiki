import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveProject, type Adjudicate } from "./resolve-project.js";
import type { ProjectRegistryEntry, ResolveSignals } from "./kb.js";

// ---------------------------------------------------------------------------
// Temp KB fixture with multiple projects (to drive all three statuses)
//
// matchProject logic (from resolve.ts):
//   1. exact name match → "match"
//   2. score each project by keyword overlap
//      - 0 scoring projects → "none"
//      - 1 scoring project → "match"
//      - 2+ projects, top > 2nd → "match"
//      - 2+ projects, top == 2nd → "ambiguous"
// ---------------------------------------------------------------------------
let kb: string;

function makeRootIndex(projects: Array<{ name: string; description: string; keywords: string[]; path: string }>) {
  const projectLines = projects.flatMap((p) => [
    `  - name: ${p.name}`,
    `    description: ${p.description}`,
    `    keywords:`,
    ...p.keywords.map((k) => `      - ${k}`),
    `    path: ${p.path}`,
    `    articles: 0`,
  ]);
  return ["---", "kind: kb-root", "version: 1", "projects:", ...projectLines, "---", "", "# Knowledge Base"].join("\n");
}

beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-resolve-project-"));

  // Two projects:
  //   "alpha" — keywords: [alpha, shared]
  //   "beta"  — keywords: [beta, shared]
  //
  // Driving statuses:
  //   match    → signals.name = "alpha"         (exact name lookup)
  //   ambiguous → signals.keywords = ["shared"] (both projects score 1 — tied)
  //   none     → signals.keywords = ["zzz"]     (no project scores > 0)

  writeFileSync(
    join(kb, "_index.md"),
    makeRootIndex([
      { name: "alpha", description: "alpha project", keywords: ["alpha", "shared"], path: "projects/alpha" },
      { name: "beta", description: "beta project", keywords: ["beta", "shared"], path: "projects/beta" },
    ])
  );

  // Minimal project dirs (resolve only reads _index.md at root, but be safe)
  for (const proj of ["alpha", "beta"]) {
    mkdirSync(join(kb, "projects", proj, "wiki"), { recursive: true });
    writeFileSync(
      join(kb, "projects", proj, "wiki", "_index.md"),
      [
        "---",
        `kind: kb-project`,
        `name: ${proj}`,
        `description: ${proj} project`,
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
  }
});

afterEach(() => rmSync(kb, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveProject — strong match path", () => {
  it("returns the matched project name without calling adjudicate", async () => {
    const adjudicateSpy = vi.fn((_candidates: ProjectRegistryEntry[], _signals: ResolveSignals) => ({
      name: "should-never-be-called",
    }));

    const result = await resolveProject(kb, { name: "alpha", keywords: [] }, adjudicateSpy);

    expect(result.project).toBe("alpha");
    expect(result.created).toBe(false);
    expect(adjudicateSpy).not.toHaveBeenCalled();
  });
});

describe("resolveProject — ambiguous path", () => {
  it("calls adjudicate with candidates and returns its choice", async () => {
    let capturedCandidates: ProjectRegistryEntry[] = [];
    let capturedSignals: ResolveSignals | null = null;

    const adjudicate: Adjudicate = (candidates, signals) => {
      capturedCandidates = candidates;
      capturedSignals = signals;
      return { name: "beta" }; // picks one of the tied candidates
    };

    const signals: ResolveSignals = { keywords: ["shared"] }; // ties alpha and beta
    const result = await resolveProject(kb, signals, adjudicate);

    // adjudicate was called
    expect(capturedCandidates.length).toBe(2);
    expect(capturedCandidates.map((c) => c.name).sort()).toEqual(["alpha", "beta"]);
    expect(capturedSignals).toEqual(signals);

    // returned the adjudicator's choice
    expect(result.project).toBe("beta");
    // "beta" IS among the candidates → not a newly created project
    expect(result.created).toBeFalsy();
  });

  it("sets created=true when adjudicator proposes a name not in candidates", async () => {
    const adjudicate: Adjudicate = () => ({ name: "brand-new" });

    const signals: ResolveSignals = { keywords: ["shared"] };
    const result = await resolveProject(kb, signals, adjudicate);

    expect(result.project).toBe("brand-new");
    expect(result.created).toBe(true);
  });
});

describe("resolveProject — none path", () => {
  it("calls adjudicate with empty candidates and returns proposed name with created=true", async () => {
    let capturedCandidates: ProjectRegistryEntry[] | null = null;

    const adjudicate: Adjudicate = (candidates) => {
      capturedCandidates = candidates;
      return { name: "new-project" };
    };

    const signals: ResolveSignals = { keywords: ["zzz-no-match"] };
    const result = await resolveProject(kb, signals, adjudicate);

    expect(capturedCandidates).toEqual([]);
    expect(result.project).toBe("new-project");
    expect(result.created).toBe(true);
  });
});

describe("resolveProject — async adjudicate support", () => {
  it("handles a Promise-returning adjudicate correctly", async () => {
    const adjudicate: Adjudicate = async (_candidates, _signals) => {
      return Promise.resolve({ name: "async-choice" });
    };

    const signals: ResolveSignals = { keywords: ["shared"] }; // ambiguous
    const result = await resolveProject(kb, signals, adjudicate);

    expect(result.project).toBe("async-choice");
  });
});
