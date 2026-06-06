/**
 * agent.sync.test.ts — Isolated test for agent.sync() delegation.
 *
 * Kept separate from agent.test.ts because vi.mock() is hoisted per-file —
 * mocking kb-wiki-scripts/sync.js here prevents the mock from leaking into
 * the chat/run tests that rely on the real registry/sync KB behavior.
 *
 * vi.hoisted() is used so the mockSync reference is available inside the
 * vi.mock() factory (which is hoisted to the top of the file by Vitest).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Hoist the mock function so it's in scope inside the vi.mock() factory.
// ---------------------------------------------------------------------------

const { mockSync } = vi.hoisted(() => ({
  mockSync: vi.fn((_repoDir: string, _opts?: { token?: string; message?: string }) => ({
    committed: false,
    pushed: false,
    files: [] as string[],
  })),
}));

vi.mock("kb-wiki-scripts/sync.js", () => ({
  sync: mockSync,
  tokenizeRemoteUrl: vi.fn((url: string, token: string) =>
    url.replace(/^https:\/\//, `https://${token}@`)
  ),
}));

// Import AFTER mock is registered
import { createAgent } from "./agent.js";
import type { LLMClient, LLMRequest, LLMChunk } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRootIndex(): string {
  return [
    "---",
    "kind: kb-root",
    "version: 1",
    "projects:",
    "---",
    "",
    "# Knowledge Base",
  ].join("\n");
}

function makeStubLLM(): LLMClient {
  return {
    async *stream(_req: LLMRequest): AsyncGenerator<LLMChunk> {
      yield { content: "ok" };
      yield { done: true };
    },
    async complete(_req: LLMRequest) {
      return { content: "general-notes" };
    },
  };
}

let kb: string;

beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-sync-test-"));
  writeFileSync(join(kb, "_index.md"), makeRootIndex());
  mockSync.mockClear();
});

afterEach(() => {
  rmSync(kb, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createAgent — sync()", () => {
  it("delegates to Layer 1 sync with the kbPath", () => {
    const agent = createAgent({
      llm: makeStubLLM(),
      memory: { kbPath: kb },
    });

    const result = agent.sync();

    expect(mockSync).toHaveBeenCalledOnce();
    // First argument is the kbPath
    expect(mockSync.mock.calls[0][0]).toBe(kb);
    // Returns a valid SyncResult shape
    expect(result).toMatchObject({ committed: false, pushed: false, files: [] });
  });

  it("passes gitToken to Layer 1 sync when configured", () => {
    const token = "ghp_testtoken";
    const agent = createAgent({
      llm: makeStubLLM(),
      memory: { kbPath: kb, gitToken: token },
    });

    agent.sync();

    expect(mockSync).toHaveBeenCalledOnce();
    const callArgs = mockSync.mock.calls[0];
    expect(callArgs[0]).toBe(kb);
    // token is passed through the opts object
    expect(callArgs[1]).toMatchObject({ token });
  });
});
