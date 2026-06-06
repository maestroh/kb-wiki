/**
 * agent.ts — Public API: createAgent + streaming chat() generator.
 *
 * `createAgent(config)` wires together skills, memory, and the ReAct loop and
 * returns a `{ chat }` object (run/sync added in P7.2).
 *
 * chat({ history, message }) is an async generator that:
 *   1. Initialises the system prompt (coreFacts + systemPrompt + anchorGoal).
 *   2. Runs the ReAct loop, yielding token/tool_call/tool_result events.
 *   3. AWAITS memory.capture() then fires memory.maybeCompile() (fire-and-forget).
 *   4. Yields a final `done` event with `messages = [userMsg, assistantMsg]`.
 *
 * Capture runs BEFORE yielding `done` (not after). The visible response has
 * already streamed as `token` events during the loop, so awaiting capture here
 * only delays the completion signal, not the answer — and it guarantees capture
 * runs regardless of whether the consumer drains or breaks on `done`.
 * (Deliberate deviation from the plan's "after yielding done" wording, made to
 * fix a data-loss bug: a consumer that breaks on `done` never resumes the
 * generator, so post-yield code is silently skipped.)
 */

import { createMemory }    from "./memory/index.js";
import { SkillService }    from "./skills/SkillService.js";
import { buildTools }      from "./loop/tools.js";
import { runLoop }         from "./loop/react.js";
import { anchorGoal }      from "./loop/guards.js";
import logger              from "./llm/logger.js";

import type { AgentConfig, AgentEvent, ChatInput, Message } from "./types.js";
import type { Memory, Adjudicate, SyncResult } from "./memory/index.js";
import type { SkillProvider } from "./loop/tools.js";

// ---------------------------------------------------------------------------
// createAgent
// ---------------------------------------------------------------------------

export interface Agent {
  chat(input: ChatInput): AsyncGenerator<AgentEvent, void>;
  run(input: ChatInput): Promise<{ response: string; messages: Message[] }>;
  sync(): SyncResult;
}

/**
 * Create an Agent bound to the supplied configuration.
 *
 * Memory is created immediately (cheap — no I/O at construction time).
 * SkillService is created and initialised lazily, once, on the first chat()
 * call that needs it (so repeated chat() calls never re-scan disk).
 */
export function createAgent(config: AgentConfig): Agent {
  // ------------------------------------------------------------------
  // Memory — created once at construction time; stateless until a method
  // is called so there is no cost here.
  // ------------------------------------------------------------------
  const memory: Memory = createMemory({
    ...config.memory,
    threshold: config.compile?.threshold,
  });

  // ------------------------------------------------------------------
  // SkillService — lazy, memoised Promise so initialize() runs at most once.
  // Resolves to null if no skill paths are configured.
  // ------------------------------------------------------------------
  let skillsPromise: Promise<SkillProvider | null> | null = null;

  function getSkills(): Promise<SkillProvider | null> {
    if (skillsPromise !== null) return skillsPromise;

    const paths = config.skills?.paths;
    if (!paths?.length) {
      skillsPromise = Promise.resolve(null);
      return skillsPromise;
    }

    // Do NOT assign to skillsPromise before we know the init succeeded —
    // a rejected promise in the cache would brick every future chat() call.
    const attempt = (async (): Promise<SkillProvider | null> => {
      try {
        const svc = new SkillService({ enabled: true, paths });
        await svc.initialize();
        return svc as SkillProvider;
      } catch (err) {
        logger.warn("[agent] SkillService.initialize() failed — degrading to no-skills (will retry on next call)", { err });
        // Reset so a later call can retry.
        skillsPromise = null;
        return null;
      }
    })();

    // Only cache on the happy path: once the promise settles successfully we
    // keep it; if it resolved to null due to the caught error we already reset.
    skillsPromise = attempt;
    return skillsPromise;
  }

  // ------------------------------------------------------------------
  // adjudicate — wraps llm.complete to pick / propose a project name.
  //
  // The prompt:
  //   - If candidates exist: lists them (name + description) and asks the
  //     model to pick the best match OR propose a new kebab-case name.
  //   - If no candidates: asks for a brand-new kebab-case project name
  //     derived from the keywords.
  //
  // Sanitisation: trim → lowercase → replace non-alphanumeric runs with "-"
  //   → collapse repeated dashes → strip leading/trailing dashes.
  //
  // Fallback (empty / unparseable result): join first 1-2 keywords from
  //   signals.keywords with "-", or "general" if keywords are empty.
  // ------------------------------------------------------------------
  const adjudicate: Adjudicate = async (candidates, signals) => {
    const kw = signals.keywords ?? [];

    const instructions = [
      "You are a knowledge-base project name assistant.",
      "Return ONLY a single kebab-case project name (e.g. \"fly-io-postgres\").",
      "No explanation, no quotes, no punctuation — just the slug.",
    ].join(" ");

    const candidateText =
      candidates.length > 0
        ? [
            "Existing projects (pick the best match OR propose a new one if none fit):",
            ...candidates.map((c) => `  - ${c.name}: ${c.description ?? ""}`),
          ].join("\n")
        : "There are no existing projects. Propose a new kebab-case project name.";

    const userText = [
      candidateText,
      "",
      `Keywords from the conversation: ${kw.length ? kw.join(", ") : "(none)"}`,
      "",
      "Return ONLY the project name slug.",
    ].join("\n");

    let raw = "";
    try {
      const res = await config.llm.complete({
        messages: [
          { role: "system", content: instructions },
          { role: "user",   content: userText },
        ],
        temperature: 0,
      });
      raw = res.content ?? "";
    } catch (err) {
      logger.warn("[agent] adjudicate llm.complete failed, using keyword fallback", { err });
    }

    // Sanitise: lowercase, replace non-alphanumeric runs with "-", collapse
    // dashes, strip leading/trailing dashes, cap at 63 chars (matches the
    // skill-name cap in models.ts) to prevent ENAMETOOLONG on long LLM outputs.
    const sanitise = (s: string): string =>
      s
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 63)
        .replace(/-$/, "");

    const slug = sanitise(raw);

    if (slug.length > 0) {
      return { name: slug };
    }

    // Fallback: derive from keywords or default to "general".
    const fallback = kw.slice(0, 2).map(sanitise).filter(Boolean).join("-").slice(0, 63).replace(/-$/, "") || "general";
    return { name: fallback };
  };

  // ------------------------------------------------------------------
  // formatCoreFacts — renders facts[] into a labeled block or "" if empty.
  // ------------------------------------------------------------------
  function formatCoreFacts(facts: string[]): string {
    if (facts.length === 0) return "";
    return ["Core facts about the user:", ...facts.map((f) => `- ${f}`)].join("\n");
  }

  // ------------------------------------------------------------------
  // chat — the streaming generator
  // ------------------------------------------------------------------
  async function* chat({ history, message }: ChatInput): AsyncGenerator<AgentEvent, void> {
    const skills = await getSkills();

    // Build system content:
    //   base = config.systemPrompt + coreFacts block (order: systemPrompt first,
    //   then coreFacts so facts augment rather than override instructions)
    //   then anchorGoal pins the current message as the goal at the very top.
    const coreFactsBlock = formatCoreFacts(memory.coreFacts());
    const base = [config.systemPrompt, coreFactsBlock].filter(Boolean).join("\n\n");
    const systemContent = anchorGoal(base, message);

    const userMsg: Message = { role: "user", content: message };

    const messages: Message[] = [
      { role: "system", content: systemContent },
      ...history,
      userMsg,
    ];

    const tools = buildTools(skills, memory);

    // Run the ReAct loop — yield* passes token/tool_call/tool_result events
    // directly to the caller; the loop returns when the LLM gives a text-only turn.
    const result = yield* runLoop({
      llm: config.llm,
      tools,
      messages,
      guards: config.guards ?? {},
    });

    const assistantMsg: Message = { role: "assistant", content: result.response };

    // Await capture BEFORE yielding done so it runs whether or not the consumer
    // drains the generator past the done event. (A consumer that breaks on done
    // never resumes the generator, so post-yield code is silently skipped —
    // see module-level comment for the full rationale.)
    // maybeCompile is fire-and-forget: it never throws internally.
    try {
      await memory.capture(result.messages, adjudicate);
      void memory.maybeCompile(config.llm);  // best-effort; swallows errors internally
    } catch (err) {
      logger.error("[agent] capture/compile failed", { err });
    }

    // Yield the public "done" event with user + assistant only.
    yield { type: "done", response: result.response, messages: [userMsg, assistantMsg] };
  }

  // ------------------------------------------------------------------
  // run — non-streaming collector: drains chat() and returns the done payload.
  //
  // Iterates ALL events so the generator is fully drained (no dangling iterator
  // state). token events are concatenated for diagnostic parity-checking.
  // The authoritative response comes from the `done` event (not the concatenation)
  // because the ReAct loop may emit partial tokens and then normalise the final
  // response in the done event.
  // ------------------------------------------------------------------
  async function run(input: ChatInput): Promise<{ response: string; messages: Message[] }> {
    let collected = "";
    let donePayload: { response: string; messages: Message[] } | undefined;

    for await (const event of chat(input)) {
      if (event.type === "token") {
        collected += event.text;
      } else if (event.type === "done") {
        donePayload = { response: event.response, messages: event.messages };
        // Continue draining — do NOT break here so the generator completes cleanly.
      }
    }

    if (donePayload === undefined) {
      // Should never happen: chat() always yields a done event.
      throw new Error("[agent] run(): chat generator completed without a done event");
    }

    if (collected !== donePayload.response) {
      logger.debug("[agent] run(): collected tokens differ from done.response", {
        collected,
        response: donePayload.response,
      });
    }

    return donePayload;
  }

  // ------------------------------------------------------------------
  // sync — delegate to memory.sync() (Layer 1 git stage→commit→pull→push).
  // ------------------------------------------------------------------
  function sync(): SyncResult {
    return memory.sync();
  }

  return { chat, run, sync };
}
