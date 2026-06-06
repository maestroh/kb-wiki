/**
 * agent.test.ts — Integration test for createAgent + streaming chat().
 *
 * TDD order: write failing test first (red), then implement agent.ts (green).
 *
 * Scenario:
 *   - Temp KB with an empty project registry (so capture hits the new-project path).
 *   - Stub LLM: stream() yields a simple text response; complete() returns a
 *     stable kebab project name for the adjudicate callback.
 *   - Drive chat({ history: [], message: "We deploy via Fly.io and use Postgres." }).
 *   - Assert: done event with correct response and [user, assistant] messages.
 *   - Assert: capture ran — the KB registry now contains a new project entry
 *     (since capture is awaited before chat completes, it must exist on return).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgent } from "./agent.js";
import { readRoot } from "./memory/kb.js";
import type { LLMClient, LLMRequest, LLMChunk, AgentEvent, Message } from "./types.js";

// ---------------------------------------------------------------------------
// Fixture helpers (mirrors the pattern from memory tests)
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

// ---------------------------------------------------------------------------
// Stub LLM
// ---------------------------------------------------------------------------

/**
 * Minimal LLMClient stub.
 *
 * stream(): yields a single text chunk then done — simulates a one-shot text
 *   turn so the ReAct loop terminates immediately (no tool calls).
 *
 * complete(): returns a fixed project name for the adjudicate callback.
 *   The real adjudicate path is hit when resolve() returns "none" (empty registry).
 */
const STUB_RESPONSE = "Hello, done.";
const STUB_PROJECT_NAME = "general-notes";

function makeStubLLM(): LLMClient {
  return {
    async *stream(_req: LLMRequest): AsyncGenerator<LLMChunk> {
      yield { content: STUB_RESPONSE };
      yield { done: true };
    },

    async complete(_req: LLMRequest) {
      return { content: STUB_PROJECT_NAME };
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let kb: string;

beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-agent-test-"));
  // Empty project registry — capture will hit the "none" path and call adjudicate.
  writeFileSync(join(kb, "_index.md"), makeRootIndex([]));
});

afterEach(() => rmSync(kb, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createAgent — chat() generator", () => {
  it("yields a done event with correct response and [user, assistant] messages", async () => {
    const agent = createAgent({
      llm: makeStubLLM(),
      memory: { kbPath: kb },
    });

    const message = "We deploy via Fly.io and use Postgres.";
    const events: AgentEvent[] = [];

    const gen = agent.chat({ history: [], message });
    for await (const event of gen) {
      events.push(event);
    }

    // A done event must be present
    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);

    const done = doneEvents[0] as Extract<AgentEvent, { type: "done" }>;
    expect(done.response).toBe(STUB_RESPONSE);

    // Public messages = [user, assistant] only
    expect(done.messages).toHaveLength(2);
    expect(done.messages[0].role).toBe("user");
    expect((done.messages[0] as { role: string; content: string }).content).toBe(message);
    expect(done.messages[1].role).toBe("assistant");
    expect((done.messages[1] as { role: string; content: string }).content).toBe(STUB_RESPONSE);
  });

  it("awaits capture before completing — project is in registry after chat", async () => {
    const agent = createAgent({
      llm: makeStubLLM(),
      memory: { kbPath: kb },
    });

    const message = "We deploy via Fly.io and use Postgres.";

    // Drain the generator to completion.
    const gen = agent.chat({ history: [], message });
    for await (const _ of gen) { /* consume all events */ }

    // capture was awaited before chat returned, so the new project must exist.
    const root = readRoot(kb);
    const captured = root.projects.find((p) => p.name === STUB_PROJECT_NAME);
    expect(captured).toBeTruthy();
    expect(captured?.name).toBe(STUB_PROJECT_NAME);
  });

  it("token events are yielded before done", async () => {
    const agent = createAgent({
      llm: makeStubLLM(),
      memory: { kbPath: kb },
    });

    const events: AgentEvent[] = [];
    for await (const event of agent.chat({ history: [], message: "test" })) {
      events.push(event);
    }

    const tokenEvents = events.filter((e) => e.type === "token");
    expect(tokenEvents.length).toBeGreaterThan(0);

    // All token events appear before the done event.
    const doneIdx = events.findIndex((e) => e.type === "done");
    expect(doneIdx).toBeGreaterThan(0);
    for (const te of tokenEvents) {
      expect(events.indexOf(te)).toBeLessThan(doneIdx);
    }
  });

  it("history is threaded into the messages sent to the LLM", async () => {
    const capturedMessages: Message[][] = [];
    const message = "follow-up";
    const llm: LLMClient = {
      async *stream(req: LLMRequest): AsyncGenerator<LLMChunk> {
        capturedMessages.push([...req.messages]);
        yield { content: "ok" };
        yield { done: true };
      },
      async complete(_req: LLMRequest) {
        return { content: STUB_PROJECT_NAME };
      },
    };

    const agent = createAgent({ llm, memory: { kbPath: kb } });
    const history: Message[] = [
      { role: "user", content: "previous question" },
      { role: "assistant", content: "previous answer" },
    ];

    for await (const _ of agent.chat({ history, message })) { /* drain */ }

    expect(capturedMessages.length).toBeGreaterThan(0);
    const msgs = capturedMessages[0];
    // system is first
    expect(msgs[0].role).toBe("system");
    // system message content contains the anchored goal (current message)
    expect((msgs[0] as { role: string; content: string }).content).toContain(message);
    // history follows
    expect(msgs[1].role).toBe("user");
    expect((msgs[1] as { role: string; content: string }).content).toBe("previous question");
    expect(msgs[2].role).toBe("assistant");
    // current message is last
    const lastMsg = msgs[msgs.length - 1];
    expect(lastMsg.role).toBe("user");
    expect((lastMsg as { role: string; content: string }).content).toBe("follow-up");
  });

  it("capture runs even when consumer breaks immediately after done event", async () => {
    const agent = createAgent({
      llm: makeStubLLM(),
      memory: { kbPath: kb },
    });

    const message = "We deploy via Fly.io and use Postgres.";

    // Consume the generator but BREAK as soon as we see the done event —
    // do NOT drain further. If capture were placed after the yield, it would
    // be silently skipped here.
    const gen = agent.chat({ history: [], message });
    for await (const event of gen) {
      if (event.type === "done") break;
    }

    // Capture must have run before the done event was yielded (Fix 1).
    const root = readRoot(kb);
    const captured = root.projects.find((p) => p.name === STUB_PROJECT_NAME);
    expect(captured).toBeTruthy();
    expect(captured?.name).toBe(STUB_PROJECT_NAME);
  });
});
