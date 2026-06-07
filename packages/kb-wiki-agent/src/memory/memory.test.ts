/**
 * memory.test.ts — TDD for the Memory facade (P5.7).
 *
 * Test 1: createMemory exposes the five required methods.
 * Test 2: coreFacts() returns seeded facts from a temp KB.
 * Test 3: recall() returns a string; capture() ingests; sync existence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemory } from "./index.js";
import type { Adjudicate } from "./index.js";
import type { Message } from "../types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
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

/**
 * Create core/_index.md with seeded facts.
 * listFacts() parses lines matching /^- (.*)$/ and strips a trailing
 * (YYYY-MM-DD) date. We write plain `- <fact>` lines (no date) for simplicity.
 */
function seedCoreFacts(kb: string, facts: string[]): void {
  const coreDir = join(kb, "core");
  mkdirSync(coreDir, { recursive: true });
  const body = ["# Core Memory", "", ...facts.map((f) => `- ${f}`)].join("\n");
  const content = [
    "---",
    "kind: kb-core",
    "version: 1",
    "---",
    "",
    body,
  ].join("\n");
  writeFileSync(join(coreDir, "_index.md"), content);
}

function scaffoldProject(kb: string, name: string, keywords: string[]): void {
  writeFileSync(
    join(kb, "_index.md"),
    makeRootIndex([
      { name, description: `${name} project`, keywords, path: `projects/${name}` },
    ])
  );
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
  kb = mkdtempSync(join(tmpdir(), "kb-memory-facade-"));
});

afterEach(() => rmSync(kb, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Test 1 — createMemory exposes all five methods
// ---------------------------------------------------------------------------

describe("createMemory — five-method surface", () => {
  it("exposes recall, capture, maybeCompile, coreFacts, sync as functions", () => {
    // Seed a minimal root index (needed for recall/capture to not throw on
    // readRoot at call time — some methods read the KB lazily).
    writeFileSync(
      join(kb, "_index.md"),
      makeRootIndex([])
    );

    const mem = createMemory({ kbPath: kb });

    expect(typeof mem.recall).toBe("function");
    expect(typeof mem.capture).toBe("function");
    expect(typeof mem.maybeCompile).toBe("function");
    expect(typeof mem.coreFacts).toBe("function");
    expect(typeof mem.addCoreFact).toBe("function");
    expect(typeof mem.sync).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Test 1b — addCoreFact() writes durable facts to core/_index.md
// ---------------------------------------------------------------------------

describe("createMemory — addCoreFact()", () => {
  it("writes a new fact and surfaces it via coreFacts()", () => {
    writeFileSync(join(kb, "_index.md"), makeRootIndex([]));

    const mem = createMemory({ kbPath: kb });
    const res = mem.addCoreFact("The user is based in Dubai");

    expect(res).toEqual({ added: true });
    expect(mem.coreFacts()).toContain("The user is based in Dubai");
  });

  it("is idempotent — a normalized duplicate is not re-added", () => {
    writeFileSync(join(kb, "_index.md"), makeRootIndex([]));

    const mem = createMemory({ kbPath: kb });
    mem.addCoreFact("Prefers vitest for tests");
    const res = mem.addCoreFact("prefers   VITEST   for tests"); // same after normalize

    expect(res).toEqual({ added: false });
    expect(mem.coreFacts().filter((f) => /vitest/i.test(f)).length).toBe(1);
  });

  it("returns { added: false } for a blank fact", () => {
    writeFileSync(join(kb, "_index.md"), makeRootIndex([]));

    const mem = createMemory({ kbPath: kb });
    expect(mem.addCoreFact("   ")).toEqual({ added: false });
  });
});

// ---------------------------------------------------------------------------
// Test 2 — coreFacts() returns seeded facts
// ---------------------------------------------------------------------------

describe("createMemory — coreFacts()", () => {
  it("returns the seeded fact strings from core/_index.md", () => {
    const facts = [
      "The user prefers TypeScript over JavaScript",
      "Always use strict mode",
    ];
    seedCoreFacts(kb, facts);

    const mem = createMemory({ kbPath: kb });
    const result = mem.coreFacts();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain("The user prefers TypeScript over JavaScript");
    expect(result).toContain("Always use strict mode");
    expect(result.length).toBe(2);
  });

  it("returns an empty array when core/_index.md does not exist", () => {
    // No core dir seeded — listFacts handles missing file gracefully
    const mem = createMemory({ kbPath: kb });
    const result = mem.coreFacts();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — recall() and capture() delegate to the KB
// ---------------------------------------------------------------------------

describe("createMemory — recall() and capture() delegation", () => {
  it("recall() returns a string (no-match note) when no project matches", () => {
    writeFileSync(join(kb, "_index.md"), makeRootIndex([]));

    const mem = createMemory({ kbPath: kb });
    const result = mem.recall("totally unrelated query xyz");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("capture() returns { ingested: true } for a substantive exchange", async () => {
    scaffoldProject(kb, "typescript-notes", ["typescript", "compiler"]);

    const exchange: Message[] = [
      {
        role: "user",
        content: "How does the typescript compiler handle incremental builds?",
      },
      {
        role: "assistant",
        content: "The typescript compiler uses a program cache for incremental builds.",
      },
    ];

    // Strong keyword match → adjudicate should not be called
    const adjudicate: Adjudicate = async () => {
      throw new Error("adjudicate should not be called on a strong match");
    };

    const mem = createMemory({ kbPath: kb });
    const result = await mem.capture(exchange, adjudicate);

    expect(result.ingested).toBe(true);
    expect(result.project).toBe("typescript-notes");
    expect(result.path).toBeTruthy();
  });

  it("capture() returns { ingested: false } for a plumbing-only exchange", async () => {
    scaffoldProject(kb, "typescript-notes", ["typescript"]);

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
      throw new Error("adjudicate should not be called");
    };

    const mem = createMemory({ kbPath: kb });
    const result = await mem.capture(exchange, adjudicate);

    expect(result.ingested).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — threshold config flows through
// ---------------------------------------------------------------------------

describe("createMemory — config shape", () => {
  it("accepts threshold option (does not throw on construction)", () => {
    writeFileSync(join(kb, "_index.md"), makeRootIndex([]));
    // Should not throw
    expect(() => createMemory({ kbPath: kb, threshold: 5 })).not.toThrow();
  });

  it("accepts gitToken option (does not throw on construction)", () => {
    writeFileSync(join(kb, "_index.md"), makeRootIndex([]));
    expect(() => createMemory({ kbPath: kb, gitToken: "ghp_fake" })).not.toThrow();
  });
});
