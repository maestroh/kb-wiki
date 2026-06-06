/**
 * compile.test.ts — TDD for maybeCompile (threshold-gated background compile).
 *
 * Tests:
 *   A. threshold:1 with 1 pending note → article written, pending drained, llm called.
 *   B. threshold:99 with 1 pending note → nothing written, pending intact, llm not called.
 *   C. (best-effort) stub llm.complete throws → maybeCompile does NOT throw, pending intact.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { maybeCompile } from "./compile.js";
import { buildPlan } from "./kb.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../types.js";

// ---------------------------------------------------------------------------
// Temp KB helpers (reuse pattern from capture.test.ts)
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

/** Scaffold a minimal KB with one project and one pending note.
 *  Returns the kbRoot and the relative pending path (e.g. "raw/notes/note.md"). */
function scaffoldKbWithPending(
  name: string
): { kb: string; pendingPath: string } {
  const kb = mkdtempSync(join(tmpdir(), "kb-compile-test-"));

  // Root registry
  writeFileSync(
    join(kb, "_index.md"),
    makeRootIndex([
      { name, description: `${name} project`, keywords: [name], path: `projects/${name}` },
    ])
  );

  // Project dirs
  const wiki = join(kb, "projects", name, "wiki");
  const rawNotes = join(kb, "projects", name, "raw", "notes");
  mkdirSync(wiki, { recursive: true });
  mkdirSync(rawNotes, { recursive: true });

  // Pending note file
  const noteFile = "raw/notes/note.md";
  writeFileSync(
    join(kb, "projects", name, noteFile),
    "This is a note about something interesting."
  );

  // Project wiki/_index.md with one pending entry
  writeFileSync(
    join(wiki, "_index.md"),
    [
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
      `- ${noteFile} — added 2026-06-01, not yet compiled`,
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

  return { kb, pendingPath: noteFile };
}

// ---------------------------------------------------------------------------
// Stub LLM factory
// ---------------------------------------------------------------------------

/** Build a stub LLMClient whose complete() returns a valid CommitInput JSON. */
function makeStubLlm(
  project: string,
  pendingPath: string,
  opts: { shouldThrow?: boolean } = {}
): { llm: LLMClient; calls: LLMRequest[] } {
  const calls: LLMRequest[] = [];

  const llm: LLMClient = {
    async complete(req: LLMRequest): Promise<LLMResponse> {
      calls.push(req);
      if (opts.shouldThrow) {
        throw new Error("stub LLM error");
      }
      const commitInput = {
        project,
        articles: [
          {
            op: "create" as const,
            slug: "interesting-note",
            title: "Interesting Note",
            summary: "A note about something interesting.",
            body: "This note covers something interesting.\n\n[[wikilinks]] are supported.",
            sources: [pendingPath],
          },
        ],
        consumedPending: [pendingPath],
        archivedPending: [],
      };
      return { content: JSON.stringify(commitInput) };
    },
    async *stream() {
      throw new Error("stream not used in compile");
    },
  };

  return { llm, calls };
}

// ---------------------------------------------------------------------------
// Test A — threshold:1, 1 pending → article written, pending drained, llm called
// ---------------------------------------------------------------------------

describe("maybeCompile — threshold:1 with 1 pending note", () => {
  let kb: string;
  let pendingPath: string;
  const project = "my-project";

  beforeEach(() => {
    ({ kb, pendingPath } = scaffoldKbWithPending(project));
  });

  afterEach(() => rmSync(kb, { recursive: true, force: true }));

  it("writes the article file and drains pending; llm.complete is called", async () => {
    const { llm, calls } = makeStubLlm(project, pendingPath);

    await maybeCompile(kb, llm, { threshold: 1 });

    // Article file must exist
    const articlePath = join(kb, "projects", project, "wiki", "interesting-note.md");
    expect(existsSync(articlePath)).toBe(true);

    // Pending must be drained
    const plan = buildPlan(kb, project);
    expect(plan.pendingSources.length).toBe(0);

    // LLM was called exactly once
    expect(calls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test B — threshold:99, 1 pending → nothing happens, llm not called
// ---------------------------------------------------------------------------

describe("maybeCompile — threshold:99 with 1 pending note", () => {
  let kb: string;
  let pendingPath: string;
  const project = "my-project";

  beforeEach(() => {
    ({ kb, pendingPath } = scaffoldKbWithPending(project));
  });

  afterEach(() => rmSync(kb, { recursive: true, force: true }));

  it("writes nothing and does not call llm.complete", async () => {
    const { llm, calls } = makeStubLlm(project, pendingPath);

    await maybeCompile(kb, llm, { threshold: 99 });

    // No article file
    const articlePath = join(kb, "projects", project, "wiki", "interesting-note.md");
    expect(existsSync(articlePath)).toBe(false);

    // Pending still present
    const plan = buildPlan(kb, project);
    expect(plan.pendingSources.length).toBe(1);

    // LLM not called
    expect(calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test C — best-effort: llm.complete throws → maybeCompile does not throw
// ---------------------------------------------------------------------------

describe("maybeCompile — best-effort: llm error does not propagate", () => {
  let kb: string;
  let pendingPath: string;
  const project = "my-project";

  beforeEach(() => {
    ({ kb, pendingPath } = scaffoldKbWithPending(project));
  });

  afterEach(() => rmSync(kb, { recursive: true, force: true }));

  it("does not throw when llm.complete rejects, and pending remains intact", async () => {
    const { llm } = makeStubLlm(project, pendingPath, { shouldThrow: true });

    // Must not throw
    await expect(maybeCompile(kb, llm, { threshold: 1 })).resolves.toBeUndefined();

    // Pending is still present (commit never ran)
    const plan = buildPlan(kb, project);
    expect(plan.pendingSources.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test D — robust JSON extraction: prose preamble + fenced JSON still compiles
// ---------------------------------------------------------------------------

describe("maybeCompile — prose-wrapped fenced JSON is extracted correctly", () => {
  let kb: string;
  let pendingPath: string;
  const project = "my-project";

  beforeEach(() => {
    ({ kb, pendingPath } = scaffoldKbWithPending(project));
  });

  afterEach(() => rmSync(kb, { recursive: true, force: true }));

  it("writes article and drains pending when llm returns prose preamble + ```json fence", async () => {
    const calls: LLMRequest[] = [];

    const llm: LLMClient = {
      async complete(req: LLMRequest): Promise<LLMResponse> {
        calls.push(req);
        const commitInput = {
          project,
          articles: [
            {
              op: "create" as const,
              slug: "interesting-note",
              title: "Interesting Note",
              summary: "A note about something interesting.",
              body: "This note covers something interesting.\n\n[[wikilinks]] are supported.",
              sources: [pendingPath],
            },
          ],
          consumedPending: [pendingPath],
          archivedPending: [],
        };
        // Simulate LLM preamble prose + fenced JSON block
        return {
          content: `Sure! Here is the structured output:\n\`\`\`json\n${JSON.stringify(commitInput)}\n\`\`\``,
        };
      },
      async *stream() {
        throw new Error("stream not used in compile");
      },
    };

    await maybeCompile(kb, llm, { threshold: 1 });

    // Article file must exist despite preamble prose
    const articlePath = join(kb, "projects", project, "wiki", "interesting-note.md");
    expect(existsSync(articlePath)).toBe(true);

    // Pending must be drained
    const plan = buildPlan(kb, project);
    expect(plan.pendingSources.length).toBe(0);

    // LLM was called exactly once
    expect(calls.length).toBe(1);
  });
});
