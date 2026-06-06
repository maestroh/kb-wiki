/**
 * react.test.ts — TDD suite for the ReAct inner loop.
 *
 * Contracts under test:
 *
 *   runLoop({ llm, tools, messages, guards })
 *     - Is an async generator that yields AgentEvents and returns
 *       { response: string; messages: Message[] } as its generator return value.
 *     - Yields: token | tool_call | tool_result  (NOT done — that's P7.1's job).
 *     - Calls llm.stream each turn; if the turn produces tool calls, dispatches
 *       them and appends tool messages before the next turn.
 *     - Enforces repeat detection: a repeated (name, args) pair is not re-dispatched;
 *       instead a "do something different" message is injected.
 *     - Enforces step budget: at the cap, a forced final turn runs with tools:[],
 *       toolChoice:"none" and the loop terminates.
 *     - Guarantees termination — cannot iterate forever.
 *     - Returns the full internal transcript (msgs) as messages.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLoop, REPEAT_MESSAGE, BUDGET_MESSAGE } from "./react";
import type { LLMClient, LLMChunk, LLMRequest, AgentEvent, Message } from "../types";
import type { ToolRegistry } from "./tools";

// ---------------------------------------------------------------------------
// Helper: drain a generator into [events[], returnValue]
// ---------------------------------------------------------------------------
async function drainLoop(
  gen: AsyncGenerator<AgentEvent, { response: string; messages: Message[] }>
): Promise<{ events: AgentEvent[]; result: { response: string; messages: Message[] } }> {
  const events: AgentEvent[] = [];
  while (true) {
    const { value, done } = await gen.next();
    if (done) {
      return { events, result: value as { response: string; messages: Message[] } };
    }
    events.push(value as AgentEvent);
  }
}

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

/**
 * Build a scripted LLM stub where each element of `turns` defines what
 * the LLM yields on that call index.
 *
 * A turn entry is an array of LLMChunk objects that will be yielded in order.
 * If toolChoice is "none" on the request (the forced-final signal), optionally
 * branch by supplying a `forcedFinalChunks` array that is used instead.
 *
 * Note: we detect forced-final via `toolChoice === "none"` rather than
 * `tools.length === 0`, because in tests the tools stub may have defs:[]
 * throughout — using toolChoice:"none" is the reliable discriminator.
 */
function makeScriptedLLM(
  turns: LLMChunk[][],
  forcedFinalChunks?: LLMChunk[]
): LLMClient {
  let callIndex = 0;

  async function* stream(req: LLMRequest): AsyncGenerator<LLMChunk> {
    // Detect forced-final turn by toolChoice:"none" (set only by the loop's
    // budget-exhaustion path).
    const isForcedFinal =
      forcedFinalChunks !== undefined && req.toolChoice === "none";

    const chunks = isForcedFinal ? forcedFinalChunks! : (turns[callIndex] ?? [{ done: true }]);
    if (!isForcedFinal) callIndex++;

    for (const chunk of chunks) {
      yield chunk;
    }
  }

  return {
    stream,
    complete: async () => {
      throw new Error("complete() not used in loop tests");
    },
  };
}

function makeToolsStub(
  dispatchResult: { ok: boolean; output: string } = { ok: true, output: "recalled stuff" }
): ToolRegistry & { dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn(async (_name: string, _args: unknown) => dispatchResult);
  return { defs: [], dispatch };
}

// ---------------------------------------------------------------------------
// Test A — happy path: tool call then text
// ---------------------------------------------------------------------------
describe("runLoop — Test A: tool call → text (happy path)", () => {
  let llm: LLMClient;
  let tools: ToolRegistry & { dispatch: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    llm = makeScriptedLLM([
      // Turn 1: one tool call
      [{ toolCall: { name: "recall", arguments: { query: "x" } } }, { done: true }],
      // Turn 2: plain text
      [{ content: "final answer" }, { done: true }],
    ]);
    tools = makeToolsStub({ ok: true, output: "recalled stuff" });
  });

  it("yields tool_call then tool_result then token(s), then returns response", async () => {
    const gen = runLoop({
      llm,
      tools,
      messages: [{ role: "user", content: "hi" }],
      guards: { maxSteps: 15 },
    });

    const { events, result } = await drainLoop(gen);

    // Event ordering
    const types = events.map((e) => e.type);
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
    expect(types).toContain("token");

    const toolCallIdx = types.indexOf("tool_call");
    const toolResultIdx = types.indexOf("tool_result");
    const tokenIdx = types.indexOf("token");

    expect(toolCallIdx).toBeLessThan(toolResultIdx);
    expect(toolResultIdx).toBeLessThan(tokenIdx);

    // Tool call event shape
    const tcEvent = events[toolCallIdx] as Extract<AgentEvent, { type: "tool_call" }>;
    expect(tcEvent.name).toBe("recall");
    expect(tcEvent.args).toEqual({ query: "x" });

    // Tool result event shape
    const trEvent = events[toolResultIdx] as Extract<AgentEvent, { type: "tool_result" }>;
    expect(trEvent.name).toBe("recall");
    expect(trEvent.ok).toBe(true);

    // Token event
    const tokenEvent = events[tokenIdx] as Extract<AgentEvent, { type: "token" }>;
    expect(tokenEvent.text).toBe("final answer");

    // dispatch called once
    expect(tools.dispatch).toHaveBeenCalledTimes(1);
    expect(tools.dispatch).toHaveBeenCalledWith("recall", { query: "x" });

    // Return value
    expect(result.response).toBe("final answer");
  });

  it("returned messages contains the assistant tool_calls message, tool result message, and final assistant message", async () => {
    const gen = runLoop({
      llm,
      tools,
      messages: [{ role: "user", content: "hi" }],
      guards: { maxSteps: 15 },
    });

    const { result } = await drainLoop(gen);

    const msgs = result.messages;
    // [user, assistant(tool_calls), tool(result), assistant(final)]
    expect(msgs.length).toBeGreaterThanOrEqual(4);

    // Find assistant message with tool_calls
    const assistantWithCalls = msgs.find(
      (m) => m.role === "assistant" && "tool_calls" in m && Array.isArray((m as any).tool_calls)
    );
    expect(assistantWithCalls).toBeDefined();

    // Find tool result message
    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect((toolMsg as any).tool_call_id).toMatch(/^call_/);

    // Find final assistant message (no tool_calls)
    const finalAssistant = msgs
      .filter((m) => m.role === "assistant")
      .find((m) => !("tool_calls" in m && Array.isArray((m as any).tool_calls)) ||
                   (m as any).tool_calls?.length === 0);
    expect(finalAssistant).toBeDefined();
  });

  it("synthetic tool_call ids are consistent between assistant message and tool message", async () => {
    const gen = runLoop({
      llm,
      tools,
      messages: [{ role: "user", content: "hi" }],
      guards: { maxSteps: 15 },
    });

    const { result } = await drainLoop(gen);
    const msgs = result.messages;

    const assistantMsg = msgs.find(
      (m) => m.role === "assistant" && "tool_calls" in m && Array.isArray((m as any).tool_calls)
    ) as any;
    const toolMsg = msgs.find((m) => m.role === "tool") as any;

    expect(assistantMsg).toBeDefined();
    expect(toolMsg).toBeDefined();

    const assistantCallId = assistantMsg.tool_calls[0].id;
    const toolCallId = toolMsg.tool_call_id;
    expect(assistantCallId).toBe(toolCallId);
    expect(assistantCallId).toMatch(/^call_\d+_\d+$/);
  });

  it("does not yield a 'done' event — that is P7.1's responsibility", async () => {
    const gen = runLoop({
      llm,
      tools,
      messages: [{ role: "user", content: "hi" }],
      guards: { maxSteps: 15 },
    });

    const { events } = await drainLoop(gen);
    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test B — repeat detection → termination
// ---------------------------------------------------------------------------
describe("runLoop — Test B: repeat detection forces termination", () => {
  it("terminates when the LLM keeps repeating the same tool call", async () => {
    // Always yields the same tool call, never text
    const alwaysRepeatLLM = makeScriptedLLM(
      // 20 copies — more than any plausible run
      Array.from({ length: 20 }, () => [
        { toolCall: { name: "recall", arguments: { query: "x" } } },
        { done: true },
      ]),
      // Forced final: return text
      [{ content: "forced final answer" }, { done: true }]
    );

    const tools = makeToolsStub({ ok: true, output: "recalled stuff" });

    const gen = runLoop({
      llm: alwaysRepeatLLM,
      tools,
      messages: [{ role: "user", content: "hi" }],
      guards: { maxSteps: 15 },
    });

    const { result } = await drainLoop(gen);

    // Must return a response (not hang)
    expect(typeof result.response).toBe("string");

    // dispatch should NOT be called 15+ times — repeat detection stops re-dispatch
    // After the first successful dispatch, all subsequent identical calls are
    // intercepted by the repeat guard without dispatching.
    expect(tools.dispatch).toHaveBeenCalledTimes(1);

    // Should have a response
    expect(result.response.length).toBeGreaterThan(0);
  });

  it("injects a 'do something different' tool message on repeat", async () => {
    const alwaysRepeatLLM = makeScriptedLLM(
      Array.from({ length: 20 }, () => [
        { toolCall: { name: "recall", arguments: { query: "x" } } },
        { done: true },
      ]),
      [{ content: "final" }, { done: true }]
    );

    const tools = makeToolsStub();

    const gen = runLoop({
      llm: alwaysRepeatLLM,
      tools,
      messages: [{ role: "user", content: "hi" }],
      guards: { maxSteps: 15 },
    });

    const { result } = await drainLoop(gen);

    // Look for the repeat-guard message in the transcript
    const repeatMsg = result.messages.find(
      (m) =>
        m.role === "tool" &&
        typeof (m as any).content === "string" &&
        (m as any).content === REPEAT_MESSAGE("recall")
    );
    expect(repeatMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test C — step budget → forced final turn
// ---------------------------------------------------------------------------
describe("runLoop — Test C: step budget forces final turn", () => {
  it("terminates via forced final when maxSteps is reached", async () => {
    // Each turn yields a distinct tool call (different n) so repeat-detection
    // does NOT fire — only the step budget terminates this.
    let turnCounter = 0;

    const alwaysNewToolCallLLM: LLMClient = {
      async *stream(req: LLMRequest): AsyncGenerator<LLMChunk> {
        // When forced final (toolChoice:"none"), return text
        if (req.toolChoice === "none") {
          yield { content: "budget forced response" };
          yield { done: true };
          return;
        }
        // Normal turn: yield a tool call with unique args
        turnCounter++;
        yield { toolCall: { name: "recall", arguments: { query: `q${turnCounter}` } } };
        yield { done: true };
      },
      complete: async () => {
        throw new Error("complete() not used");
      },
    };

    const tools = makeToolsStub({ ok: true, output: "result" });

    const gen = runLoop({
      llm: alwaysNewToolCallLLM,
      tools,
      messages: [{ role: "user", content: "hi" }],
      guards: { maxSteps: 3 },
    });

    const { result } = await drainLoop(gen);

    // Must terminate with a response
    expect(result.response).toBe("budget forced response");

    // dispatch called ~maxSteps times (3) — not unbounded
    expect(tools.dispatch).toHaveBeenCalledTimes(3);
  });

  it("forced final turn injects a budget-exhausted user message into transcript", async () => {
    let turnCounter = 0;
    const llm: LLMClient = {
      async *stream(req: LLMRequest): AsyncGenerator<LLMChunk> {
        if (req.toolChoice === "none") {
          yield { content: "done" };
          yield { done: true };
          return;
        }
        turnCounter++;
        yield { toolCall: { name: "recall", arguments: { query: `q${turnCounter}` } } };
        yield { done: true };
      },
      complete: async () => { throw new Error(); },
    };

    const tools = makeToolsStub();

    const gen = runLoop({
      llm,
      tools,
      messages: [{ role: "user", content: "start" }],
      guards: { maxSteps: 3 },
    });

    const { result } = await drainLoop(gen);

    // The budget-exhausted message should be in the transcript
    const budgetMsg = result.messages.find(
      (m) =>
        m.role === "user" &&
        typeof (m as any).content === "string" &&
        (m as any).content === BUDGET_MESSAGE
    );
    expect(budgetMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test D — terminal path: LLM returns only text (no tool calls)
// ---------------------------------------------------------------------------
describe("runLoop — Test D: text-only response (no tools)", () => {
  it("returns immediately with the text response when no tool calls are made", async () => {
    const llm = makeScriptedLLM([
      [{ content: "Hello, world!" }, { done: true }],
    ]);
    const tools = makeToolsStub();

    const gen = runLoop({
      llm,
      tools,
      messages: [{ role: "user", content: "hi" }],
      guards: { maxSteps: 15 },
    });

    const { events, result } = await drainLoop(gen);

    // Only token events, no tool_call or tool_result
    expect(events.every((e) => e.type === "token")).toBe(true);
    expect(result.response).toBe("Hello, world!");
    expect(tools.dispatch).not.toHaveBeenCalled();
  });

  it("appends the assistant message to the returned messages", async () => {
    const llm = makeScriptedLLM([
      [{ content: "answer" }, { done: true }],
    ]);
    const tools = makeToolsStub();

    const gen = runLoop({
      llm,
      tools,
      messages: [{ role: "user", content: "hi" }],
      guards: { maxSteps: 15 },
    });

    const { result } = await drainLoop(gen);

    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.role).toBe("assistant");
    expect((lastMsg as any).content).toBe("answer");
  });
});

// ---------------------------------------------------------------------------
// Test E — backoff guard
// ---------------------------------------------------------------------------
describe("runLoop — Test E: backoff guard blocks a repeatedly-failing tool", () => {
  it("does not re-dispatch a tool that has failed >= 2 times", async () => {
    let callIndex = 0;

    // Each turn calls the same "flaky" tool (different args to bypass repeat detection)
    const llm: LLMClient = {
      async *stream(req: LLMRequest): AsyncGenerator<LLMChunk> {
        if (req.toolChoice === "none") {
          yield { content: "gave up" };
          yield { done: true };
          return;
        }
        callIndex++;
        yield { toolCall: { name: "flaky", arguments: { n: callIndex } } };
        yield { done: true };
      },
      complete: async () => { throw new Error(); },
    };

    // Always fails
    const failDispatch = vi.fn(async () => ({ ok: false as const, output: "error" }));
    const tools: ToolRegistry & { dispatch: ReturnType<typeof vi.fn> } = {
      defs: [],
      dispatch: failDispatch,
    };

    const gen = runLoop({
      llm,
      tools,
      messages: [{ role: "user", content: "hi" }],
      guards: { maxSteps: 10 },
    });

    const { result, events } = await drainLoop(gen);

    // After 2 failures, subsequent calls should be blocked (not dispatched)
    // dispatch should be called at most 2 times
    expect(tools.dispatch).toHaveBeenCalledTimes(2);

    // A tool_result with ok:false should be emitted for the blocked call too
    const failedResults = events.filter(
      (e) => e.type === "tool_result" && !(e as any).ok
    );
    expect(failedResults.length).toBeGreaterThan(0);

    // Loop must still terminate
    expect(result.response).toBe("gave up");
  });
});
