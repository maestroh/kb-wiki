/**
 * react.ts — ReAct inner loop for the kb-wiki-agent.
 *
 * `runLoop` is an async generator that drives one complete agent turn sequence:
 *   1. Stream a turn from the LLM.
 *   2. If the LLM returns tool calls, dispatch them (with repeat + backoff guards),
 *      append tool result messages, then loop back for the next LLM turn.
 *   3. If the LLM returns text only, append an assistant message and return.
 *   4. If the step budget is exhausted, inject a budget-exhaustion user message
 *      and force one final LLM turn with tools disabled — guaranteeing termination.
 *
 * Yields: AgentEvent (token | tool_call | tool_result) — NOT "done".
 * Returns: { response: string; messages: Message[] } — the full internal transcript.
 * P7.1 wraps this generator, yields the "done" event, and builds the public transcript.
 *
 * --- Synthetic tool-call ids ---
 * llm.stream() yields tool calls WITHOUT ids (by design — see P3.1 notes).
 * The loop assigns its own synthetic ids of the form `call_<step>_<i>` where
 * `step` is the 1-indexed turn number and `i` is the 0-indexed position of the
 * tool call in that turn.  The SAME id is used in both:
 *   - The assistant message's `tool_calls[i].id`
 *   - The corresponding `{ role:"tool", tool_call_id }` message
 * This keeps the replayed transcript internally consistent for the provider,
 * which only requires that each tool result's tool_call_id matches an id in
 * the preceding assistant tool_calls array.
 *
 * --- Token budget limitation ---
 * llm.stream() is a streaming generator that does NOT yield token-usage metadata.
 * As a result, the `tokens` counter remains ~0 throughout a run and the token
 * budget (cfg.maxTokens) is effectively not enforced. The STEP budget
 * (cfg.maxSteps, default 15) is the operative termination guard. P7.1 should
 * note this limitation; a future improvement would be a separate usage-reporting
 * hook on LLMClient.
 *
 * --- Termination guarantee ---
 * - The step budget bounds normal iterations: at the cap, the forced final turn
 *   runs with toolChoice:"none" and no tool defs, so the LLM cannot produce
 *   additional tool calls. After the forced final turn, the function returns.
 * - Within the budget, repeat detection prevents identical-call re-dispatch;
 *   the injected "do something different" message nudges the LLM toward text.
 * - Backoff blocks tools that have failed ≥ 2 times; the "temporarily disabled"
 *   message nudges the LLM to route around them.
 * - No combination of LLM output can prevent eventual return.
 */

import type { AgentEvent, GuardsConfig, LLMClient, Message } from "../types.js";
import type { ToolRegistry } from "./tools.js";
import {
  budgetExceeded,
  repeatKey,
  RepeatTracker,
  ErrorBackoff,
} from "./guards.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunLoopInput {
  llm: LLMClient;
  tools: ToolRegistry;
  messages: Message[];
  guards: GuardsConfig;
}

export interface RunLoopReturn {
  response: string;
  messages: Message[];
}

/**
 * Run the ReAct loop.
 *
 * @yields AgentEvent — token | tool_call | tool_result (caller yields "done")
 * @returns { response, messages } — final text + full internal transcript
 */
export async function* runLoop(
  input: RunLoopInput
): AsyncGenerator<AgentEvent, RunLoopReturn> {
  const { llm, tools, guards } = input;

  // Work on a local mutable copy of the message list so we never mutate caller's array.
  const msgs: Message[] = [...input.messages];

  // One tracker + one backoff per run (not global).
  const tracker = new RepeatTracker();
  const backoff = new ErrorBackoff();

  // step: 1-indexed count of completed turns.
  // tokens: best-effort cumulative token count — stays ~0 with streaming (see header).
  let step = 0;
  const tokens = 0;

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
  while (true) {
    // ------------------------------------------------------------------
    // Budget check BEFORE this turn (step is the count of turns completed so far)
    // ------------------------------------------------------------------
    if (budgetExceeded(step, tokens, guards)) {
      return yield* forcedFinalTurn(llm, msgs);
    }

    // ------------------------------------------------------------------
    // Stream a turn
    // ------------------------------------------------------------------
    let content = "";
    const toolCalls: Array<{ name: string; arguments: unknown }> = [];

    for await (const chunk of llm.stream({
      messages: msgs,
      tools: tools.defs,
    })) {
      if (chunk.content) {
        content += chunk.content;
        yield { type: "token", text: chunk.content };
      }
      if (chunk.toolCall) {
        toolCalls.push(chunk.toolCall);
      }
      // chunk.done just signals end-of-stream — no action needed
    }

    step++;

    // ------------------------------------------------------------------
    // No tool calls → terminal: return with the accumulated text
    // ------------------------------------------------------------------
    if (toolCalls.length === 0) {
      msgs.push({ role: "assistant", content });
      return { response: content, messages: msgs };
    }

    // ------------------------------------------------------------------
    // Tool calls present
    // ------------------------------------------------------------------

    // Build the OpenAI-style assistant tool-call message.
    // Synthetic ids: call_<step>_<i> — consistent with corresponding tool messages.
    // Cast to Message: OpenAI's ChatCompletionAssistantMessageParam accepts this shape.
    const assistantMsg = {
      role: "assistant" as const,
      // OpenAI requires content to be string | null when tool_calls is present
      content: content || null,
      tool_calls: toolCalls.map((tc, i) => ({
        id: `call_${step}_${i}`,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments ?? {}),
        },
      })),
    } satisfies Message;
    msgs.push(assistantMsg);

    // ------------------------------------------------------------------
    // Dispatch each tool call
    // ------------------------------------------------------------------
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const id = `call_${step}_${i}`;
      const { name, arguments: args } = tc;

      // --- Backoff guard ---
      if (backoff.blocked(name)) {
        msgs.push({
          role: "tool",
          tool_call_id: id,
          content: `tool "${name}" is temporarily disabled after repeated failures — route around it or finish.`,
        });
        yield { type: "tool_result", name, ok: false };
        continue;
      }

      // --- Repeat guard ---
      const key = repeatKey(name, args);
      if (tracker.seen(key)) {
        msgs.push({
          role: "tool",
          tool_call_id: id,
          content: `You already ran ${name} with these exact arguments; the result is earlier in this conversation. Do something different or give your final answer.`,
        });
        yield { type: "tool_result", name, ok: false };
        continue;
      }

      // --- Normal dispatch ---
      yield { type: "tool_call", name, args };
      const res = await tools.dispatch(name, args);
      if (!res.ok) {
        backoff.record(name);
      }
      msgs.push({
        role: "tool",
        tool_call_id: id,
        content: res.output,
      });
      yield { type: "tool_result", name, ok: res.ok };
    }

    // Continue to next turn (loop back)
  }
}

// ---------------------------------------------------------------------------
// Forced final turn (budget exhausted)
// ---------------------------------------------------------------------------

/**
 * Inject a budget-exhaustion message and run ONE final LLM turn with tools
 * disabled.  Any tool calls the model attempts are silently ignored (we
 * collect only content).  Appends the final assistant message and returns.
 *
 * This is a generator so we can yield token events with `yield*`.
 */
async function* forcedFinalTurn(
  llm: LLMClient,
  msgs: Message[]
): AsyncGenerator<AgentEvent, RunLoopReturn> {
  // Inject the budget-exhaustion instruction
  msgs.push({
    role: "user",
    content:
      "You are out of step/tool budget. Provide your best final answer now. Do not call any tools.",
  });

  // Stream with tools disabled
  let content = "";
  for await (const chunk of llm.stream({
    messages: msgs,
    tools: [],
    toolChoice: "none",
  })) {
    if (chunk.content) {
      content += chunk.content;
      yield { type: "token", text: chunk.content };
    }
    // Ignore any tool calls the model might attempt — toolChoice:"none" should
    // prevent them, but we defensively skip them here too.
  }

  msgs.push({ role: "assistant", content });
  return { response: content, messages: msgs };
}
