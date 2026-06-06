/**
 * capture.test.ts — TDD for the deterministic write path.
 *
 * Three scenarios:
 *   1. Substantive exchange → resolves to existing project → ingests pending note.
 *   2. All-plumbing exchange → preclean yields empty → no ingest.
 *   3. New-project path (created) → ensureProject scaffolds then ingests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { capture } from "./capture.js";
import { readRoot } from "./kb.js";
import { listPending } from "kb-wiki-scripts/index-sections.js";
import { parseDoc } from "kb-wiki-scripts/contract.js";
import type { Adjudicate } from "./resolve-project.js";
import type { Message } from "../types.js";

// ---------------------------------------------------------------------------
// Helper: write a minimal temp-KB with one project
// ---------------------------------------------------------------------------

function makeRootIndex(
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

function makeProjectIndex(name: string): string {
  return [
    "---",
    `kind: kb-project`,
    `name: ${name}`,
    `description: ${name} project`,
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
  ].join("\n");
}

function scaffoldProject(kb: string, name: string, keywords: string[]): void {
  // Root registry
  writeFileSync(
    join(kb, "_index.md"),
    makeRootIndex([
      { name, description: `${name} project`, keywords, path: `projects/${name}` },
    ])
  );
  // Project dirs + wiki/_index.md
  const wiki = join(kb, "projects", name, "wiki");
  const rawNotes = join(kb, "projects", name, "raw", "notes");
  mkdirSync(wiki, { recursive: true });
  mkdirSync(rawNotes, { recursive: true });
  writeFileSync(join(wiki, "_index.md"), makeProjectIndex(name));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let kb: string;

beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-capture-test-"));
});

afterEach(() => rmSync(kb, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Test 1 — Substantive exchange → ingests into existing project
// ---------------------------------------------------------------------------

describe("capture — substantive exchange → ingest into existing project", () => {
  it("returns ingested:true, correct project, and a pending note file exists", async () => {
    // "typescript" and "compiler" are keywords on the project; the exchange
    // text contains those words so resolve gets a keyword match.
    scaffoldProject(kb, "typescript-notes", ["typescript", "compiler"]);

    const exchange: Message[] = [
      {
        role: "user",
        content: "How does the typescript compiler handle incremental builds? I want to understand the process.",
      },
      {
        role: "assistant",
        content: "The typescript compiler uses a program cache. Incremental compilation checks file hashes.",
      },
    ];

    // adjudicate should NOT be called (strong keyword match)
    const adjudicate: Adjudicate = async () => {
      throw new Error("adjudicate should not be called on a strong match");
    };

    const result = await capture(kb, exchange, adjudicate);

    expect(result.ingested).toBe(true);
    expect(result.project).toBe("typescript-notes");
    expect(result.path).toBeTruthy();

    // The pending file must actually exist on disk
    expect(existsSync(join(kb, "projects", "typescript-notes", result.path!))).toBe(true);

    // The wiki/_index.md must list it as pending
    const idxRaw = readFileSync(
      join(kb, "projects", "typescript-notes", "wiki", "_index.md"),
      "utf-8"
    );
    const { body } = parseDoc(idxRaw);
    const pending = listPending(body);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0]).toContain(result.path);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — All-plumbing exchange → ingests nothing
// ---------------------------------------------------------------------------

describe("capture — all-plumbing exchange → no ingest", () => {
  it("returns ingested:false and creates no pending notes", async () => {
    scaffoldProject(kb, "typescript-notes", ["typescript"]);

    // Only system message + tool calls + tool result — preclean drops all of these
    const exchange: Message[] = [
      { role: "system", content: "You are an assistant." },
      {
        role: "assistant",
        content: "calling tool",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "do_thing", arguments: "{}" } },
        ],
      } as Message,
      { role: "tool", tool_call_id: "c1", content: "tool result output" } as Message,
    ];

    const adjudicate: Adjudicate = async () => {
      throw new Error("adjudicate should never be called for empty exchange");
    };

    const result = await capture(kb, exchange, adjudicate);

    expect(result.ingested).toBe(false);
    expect(result.project).toBeUndefined();
    expect(result.path).toBeUndefined();

    // No raw notes were written
    const rawNotes = join(kb, "projects", "typescript-notes", "raw", "notes");
    const { readdirSync } = await import("node:fs");
    const files = existsSync(rawNotes) ? readdirSync(rawNotes) : [];
    expect(files.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — New-project path (created) → ensureProject scaffolds then ingests
// ---------------------------------------------------------------------------

describe("capture — new project path → ensureProject scaffolds + ingests", () => {
  it("creates the project dirs, wiki/_index.md, registry entry, and ingests the note", async () => {
    // KB with NO matching project — root registry is empty of relevant keywords
    writeFileSync(
      join(kb, "_index.md"),
      makeRootIndex([])  // no projects at all
    );

    const exchange: Message[] = [
      {
        role: "user",
        content: "I want to track notes about astronomy and telescope observations.",
      },
      {
        role: "assistant",
        content: "Great! Let me help you organize astronomy and telescope observation notes.",
      },
    ];

    // adjudicate proposes a brand-new project name
    const adjudicate: Adjudicate = async () => ({ name: "fresh-topic" });

    const result = await capture(kb, exchange, adjudicate);

    expect(result.ingested).toBe(true);
    expect(result.project).toBe("fresh-topic");
    expect(result.path).toBeTruthy();

    // wiki/_index.md was scaffolded
    const wikiIdx = join(kb, "projects", "fresh-topic", "wiki", "_index.md");
    expect(existsSync(wikiIdx)).toBe(true);

    // The file is parseable with the expected frontmatter
    const raw = readFileSync(wikiIdx, "utf-8");
    const { data, body } = parseDoc(raw);
    expect(data.kind).toBe("kb-project");
    expect(data.name).toBe("fresh-topic");
    // parseDoc uses default YAML schema; bare YYYY-MM-DD values are parsed as
    // Date objects by js-yaml. Coerce for the assertion.
    const createdStr =
      data.created instanceof Date
        ? data.created.toISOString().slice(0, 10)
        : String(data.created);
    expect(createdStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The body has the required sections
    expect(body).toContain("## Articles");
    expect(body).toContain("## Raw Sources (pending)");
    expect(body).toContain("## Raw Sources (compiled)");
    expect(body).toContain("## Raw Sources (archived)");

    // The registry now contains the new project
    const root = readRoot(kb);
    const entry = root.projects.find((p) => p.name === "fresh-topic");
    expect(entry).toBeTruthy();
    expect(entry?.path).toBe("projects/fresh-topic");

    // The note was ingested (pending is non-empty)
    const { body: idxBody } = parseDoc(readFileSync(wikiIdx, "utf-8"));
    const pending = listPending(idxBody);
    expect(pending.length).toBeGreaterThan(0);
  });
});
