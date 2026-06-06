/**
 * agent.e2e.test.ts — End-to-end test: capture → compile → recall.
 *
 * Only the LLM is stubbed. Everything else is real:
 *   - Real temp KB on disk (kb-wiki init layout via makeTempKb())
 *   - Real SkillService (discovers + executes the echo fixture skill subprocess)
 *   - Real memory pipeline (capture → preclean → resolve → ingest, maybeCompile → commit)
 *   - Real ReAct loop (react.ts)
 *   - Real recall (wiki ∪ pending read-merge)
 *
 * Three turns in a single cohesive it() (sequential, shared KB state):
 *
 *   Turn 1  (threshold:99  — compile NOT fired yet)
 *     LLM:  calls echo skill → then yields text response
 *     Assert: tool_result event for "echo" ok:true; done event with response text;
 *             a pending note exists in the project dir.
 *
 *   Turn 2  (threshold:1   — compile fires after capture)
 *     LLM:  simple text response; no tools.
 *     Assert: after polling (≤ 5s, 50ms intervals), pending is drained AND the
 *             wiki article file exists.
 *
 *   Turn 3  (threshold:99  — no second compile)
 *     LLM:  calls recall tool → yields text acknowledging recalled content.
 *     Assert: tool_result event for "recall" ok:true; the live recall() call returns
 *             a string containing the compiled article slug + summary.
 *
 * DESIGN NOTE — single it() vs. multiple it() blocks:
 * All three turns share one KB on disk and one stub-LLM counter. Using a single
 * it() guarantees sequential execution and lets the fire-and-forget compile
 * settle naturally (microtasks/macrotasks run between turns inside the same
 * async function). Multiple it() blocks in separate vitest workers can cause
 * the compile Promise to be starved between test boundaries.
 */

import { describe, it, expect, afterAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "node:fs";
import { makeTempKb, cleanupKb } from "./__tests__/kb-fixtures.js";
import { createAgent } from "./agent.js";
import { buildPlan } from "./memory/kb.js";
import { recall as recallDirect } from "./memory/recall.js";
import type { LLMClient, LLMRequest, LLMChunk, AgentEvent } from "./types.js";

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fixtures directory: parent of each skill subdirectory (skills.test.ts pattern)
const FIXTURES_DIR = path.join(__dirname, "skills", "__fixtures__");

// ---------------------------------------------------------------------------
// Shared KB — one temp dir for the whole test suite.
// ---------------------------------------------------------------------------

const kbPath = makeTempKb();

afterAll(() => {
  cleanupKb(kbPath);
});

// ---------------------------------------------------------------------------
// Stub LLM
//
// stream() is scripted by a global call counter:
//   Call 0: echo tool call (Turn 1, LLM iteration 1)
//   Call 1: text response  (Turn 1, LLM iteration 2 — after tool result injected)
//   Call 2: text "Acknowledged." (Turn 2, simple text, no tools)
//   Call 3: recall tool call (Turn 3, LLM iteration 1)
//   Call 4: text acknowledging recall result (Turn 3, LLM iteration 2)
//
// complete() distinguishes compile vs adjudicate by inspecting the system message:
//   - Compile: system contains "synthesized wiki articles" (from SYSTEM_RULES in compile-prompt.ts)
//   - Adjudicate: any other request → return kebab project name "payments"
//
// For compile, the user message is the CompilePlan JSON brief; we parse it to
// extract the project name and ALL pending source paths, then return a valid
// CommitInput consuming all of them so validateCommit passes.
// ---------------------------------------------------------------------------

// Single source of truth for the Turn-1 final text, shared by the stub and
// the assertion below so the test fails if they ever drift apart.
const TURN1_REPLY = "Set up CI; noted you deploy via Fly.";

function makeE2EStubLLM(): LLMClient {
  // streamCallCount is SHARED across all three createAgent() instances created
  // in this test.  The mapping (call number → turn) relies on stream() only
  // ever being invoked from inside chat() — there are no construction-time or
  // preflight stream calls — so the counter advances exactly once per LLM
  // iteration across all turns in sequence.
  let streamCallCount = 0;

  return {
    async *stream(_req: LLMRequest): AsyncGenerator<LLMChunk> {
      const call = streamCallCount++;

      switch (call) {
        // ── Turn 1, LLM iteration 1: echo tool call ──────────────────────
        case 0:
          yield {
            toolCall: {
              name: "echo",
              arguments: { script: "run.sh", args: ["payments deploy via Fly"] },
            },
          };
          yield { done: true };
          break;

        // ── Turn 1, LLM iteration 2: text response ───────────────────────
        case 1:
          yield { content: TURN1_REPLY };
          yield { done: true };
          break;

        // ── Turn 2: simple text, no tools ────────────────────────────────
        case 2:
          yield { content: "Acknowledged." };
          yield { done: true };
          break;

        // ── Turn 3, LLM iteration 1: recall tool call ────────────────────
        case 3:
          yield {
            toolCall: {
              name: "recall",
              arguments: { query: "payments deploy Fly" },
            },
          };
          yield { done: true };
          break;

        // ── Turn 3, LLM iteration 2: text acknowledging recall ──────────
        case 4:
          yield {
            content:
              "Based on what I recall: you deploy via Fly and have CI set up.",
          };
          yield { done: true };
          break;

        // ── Unexpected call — fail loudly so regressions are visible ──────
        default:
          throw new Error(`E2E stub: unexpected stream call #${call}`);
      }
    },

    async complete(req: LLMRequest) {
      // Find the system message text to discriminate compile vs adjudicate.
      const sysMsg = req.messages.find((m) => m.role === "system");
      const sysText =
        typeof sysMsg?.content === "string" ? sysMsg.content : "";

      // ── Compile request ───────────────────────────────────────────────────
      // The SYSTEM_RULES in compile-prompt.ts opens with:
      //   "You are compiling a project's pending raw sources into synthesized wiki articles."
      if (sysText.includes("synthesized wiki articles")) {
        // Parse the user message JSON brief to get project name + ALL pending paths.
        const userMsg = req.messages.find((m) => m.role === "user");
        const userText =
          typeof userMsg?.content === "string" ? userMsg.content : "{}";

        let projectName = "payments";
        let pendingPaths: string[] = ["raw/notes/unknown.md"];
        try {
          const brief = JSON.parse(userText) as {
            project?: string;
            pendingSources?: Array<{ path: string; content: string }>;
          };
          if (brief.project) projectName = brief.project;
          if (brief.pendingSources?.length) {
            pendingPaths = brief.pendingSources.map((s) => s.path);
          }
        } catch {
          // fall through — use defaults
        }

        // Return a valid CommitInput: one article that lists ALL pending paths
        // as its sources, and consumedPending covers all of them. This satisfies
        // validateCommit (consumedPending ∪ archivedPending = full pending set).
        const commitInput = {
          project: projectName,
          articles: [
            {
              op: "create" as const,
              slug: "payments-ci",
              title: "Payments CI",
              summary: "CI + Fly deploy setup",
              body: "Deploy via Fly. [[payments-deploy]] for more details.",
              sources: pendingPaths,
            },
          ],
          consumedPending: pendingPaths,
          archivedPending: [],
        };

        return { content: JSON.stringify(commitInput) };
      }

      // ── Adjudicate request ────────────────────────────────────────────────
      // The adjudicate prompt in agent.ts has system:
      //   "You are a knowledge-base project name assistant."
      // Return a stable kebab project name.
      return { content: "payments" };
    },
  };
}

// ---------------------------------------------------------------------------
// Collect events helper
// ---------------------------------------------------------------------------

async function collectEvents(
  gen: AsyncGenerator<AgentEvent, void>
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Poll helper — waits for a condition with a bounded deadline.
// ---------------------------------------------------------------------------

async function pollUntil(
  check: () => boolean,
  maxMs: number,
  intervalMs: number
): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  // One final check at deadline.
  return check();
}

// ---------------------------------------------------------------------------
// End-to-end test — three turns in one it() so they run sequentially in the
// same async context, allowing compile's fire-and-forget Promise to settle
// between turns without depending on cross-it() scheduling.
// ---------------------------------------------------------------------------

describe("agent e2e — capture → compile → recall", () => {
  it(
    "exercises the full pipeline: Turn 1 (echo skill), Turn 2 (compile), Turn 3 (recall)",
    async () => {
      const stubLLM = makeE2EStubLLM();

      // ── Turn 1: threshold:99 so compile does NOT fire yet ─────────────────
      {
        const agent = createAgent({
          llm: stubLLM,
          skills: { paths: [FIXTURES_DIR] },
          memory: { kbPath },
          compile: { threshold: 99 },
        });

        const events = await collectEvents(
          agent.chat({
            history: [],
            message:
              "We deploy payments via Fly.io. Please echo that and note it.",
          })
        );

        // Assert: echo tool_call event was emitted.
        const toolCallEvents = events.filter(
          (e) => e.type === "tool_call"
        ) as Extract<AgentEvent, { type: "tool_call" }>[];
        const echoCall = toolCallEvents.find((e) => e.name === "echo");
        expect(echoCall, "expected a tool_call event for 'echo'").toBeTruthy();

        // Assert: echo tool_result ok:true (skill subprocess ran successfully).
        const toolResultEvents = events.filter(
          (e) => e.type === "tool_result"
        ) as Extract<AgentEvent, { type: "tool_result" }>[];
        const echoResult = toolResultEvents.find((e) => e.name === "echo");
        expect(
          echoResult,
          "expected a tool_result event for 'echo'"
        ).toBeTruthy();
        expect(echoResult!.ok, "echo skill should succeed").toBe(true);

        // Assert: done event with the exact Turn-1 text (TURN1_REPLY is the
        // single source of truth shared by the stub and this assertion).
        const doneEvents = events.filter(
          (e) => e.type === "done"
        ) as Extract<AgentEvent, { type: "done" }>[];
        expect(doneEvents).toHaveLength(1);
        expect(doneEvents[0].response).toBe(TURN1_REPLY);

        // Assert: capture ran and created a pending note.
        // (With threshold:99, compile did NOT fire — pending must still be there.)
        const plan1 = buildPlan(kbPath, "payments");
        expect(
          plan1.pendingSources.length,
          "expected at least one pending source after Turn 1"
        ).toBeGreaterThan(0);
      }

      // ── Turn 2: threshold:1 so compile fires fire-and-forget after capture ─
      {
        const agent = createAgent({
          llm: stubLLM,
          skills: { paths: [FIXTURES_DIR] },
          memory: { kbPath },
          compile: { threshold: 1 },
        });

        // Drive Turn 2. After this returns, maybeCompile is in flight.
        // NOTE: maybeCompile is NOT awaited inside chat(), so compile runs
        // concurrently; the pollUntil() below waits for it to settle on disk.
        await collectEvents(
          agent.chat({
            history: [],
            message: "Please acknowledge that we deploy via Fly.",
          })
        );

        // Article file that compile should create.
        const articleFile = path.join(
          kbPath,
          "projects",
          "payments",
          "wiki",
          "payments-ci.md"
        );

        // Poll up to 5 seconds for the fire-and-forget compile to settle.
        // (Compile is pure async — no real I/O beyond fs sync ops — so 5s is
        // very generous; in practice it settles within the first poll tick.)
        const compileDone = await pollUntil(
          () => {
            if (!existsSync(articleFile)) return false;
            try {
              const plan = buildPlan(kbPath, "payments");
              return plan.pendingSources.length === 0;
            } catch {
              return false;
            }
          },
          5000,
          50
        );

        expect(
          compileDone,
          "compile did not produce the wiki article or did not drain pending within 5 s"
        ).toBe(true);

        // Explicit assertions after poll confirms state.
        expect(
          existsSync(articleFile),
          "payments-ci.md must exist on disk"
        ).toBe(true);
        const plan2 = buildPlan(kbPath, "payments");
        expect(
          plan2.pendingSources.length,
          "pending should be empty after compile"
        ).toBe(0);
      }

      // ── Turn 3: recall the compiled article ───────────────────────────────
      {
        const agent = createAgent({
          llm: stubLLM,
          skills: { paths: [FIXTURES_DIR] },
          memory: { kbPath },
          compile: { threshold: 99 },
        });

        const events = await collectEvents(
          agent.chat({
            history: [],
            message: "What do you know about our payments deploy on Fly?",
          })
        );

        // Assert: recall tool_result ok:true.
        const toolResultEvents = events.filter(
          (e) => e.type === "tool_result"
        ) as Extract<AgentEvent, { type: "tool_result" }>[];
        const recallResult = toolResultEvents.find((e) => e.name === "recall");
        expect(
          recallResult,
          "expected a tool_result event for 'recall'"
        ).toBeTruthy();
        expect(
          recallResult!.ok,
          "recall tool should return ok:true"
        ).toBe(true);

        // Assert: done event is present.
        const doneEvents = events.filter(
          (e) => e.type === "done"
        ) as Extract<AgentEvent, { type: "done" }>[];
        expect(doneEvents).toHaveLength(1);

        // Assert: the real recall() returns the compiled article.
        // This is the most robust signal that compile produced a retrievable article.
        const recallOutput = recallDirect(kbPath, "payments deploy Fly");
        expect(
          recallOutput,
          "recall should return the compiled article slug"
        ).toContain("payments-ci");
        expect(
          recallOutput,
          "recall should contain the article summary"
        ).toContain("CI + Fly deploy");
      }
    },
    20000
  );
});
