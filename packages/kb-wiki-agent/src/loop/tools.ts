/**
 * tools.ts — Tool registry unifying skills ∪ the built-in memory tools
 * (`recall` read + `remember_core` write).
 *
 * `buildTools(skills, memory)` returns:
 *   - `defs`: array of ToolDefinition objects ready for the LLM request.
 *     Always includes the built-in `recall` and `remember_core` tools.
 *     Includes one def per skill
 *     when a SkillProvider is supplied. Skill descriptions are enriched with
 *     the list of available scripts (from loadSkill) so the model knows what
 *     to pass as `script`.
 *   - `dispatch(name, args)`: routes to the correct backend. Never throws —
 *     all error paths return `{ ok: false, output: <message> }` so the
 *     ReAct loop can handle failures without a try/catch at the call site.
 *
 * Design notes:
 *   - Accepts NARROW structural interfaces (SkillProvider, MemoryProvider)
 *     rather than the concrete SkillService / Memory classes. This keeps the
 *     module independently testable with tiny stubs while the real objects
 *     satisfy the interfaces structurally (no casting needed at P7.1).
 *   - No LLM, no loop state — pure registry + dispatcher.
 */

import type { ToolDefinition } from "../types.js";

// ---------------------------------------------------------------------------
// Narrow structural interfaces
// ---------------------------------------------------------------------------

/** Minimal subset of SkillService needed by the tool registry. */
export interface SkillProvider {
  getAvailableSkills(): { name: string; description: string }[];
  loadSkill(name: string): { scripts: string[] } | null;
  executeScript(
    skillName: string,
    scriptName: string,
    args: string[]
  ): Promise<{ success: boolean; stdout: string; stderr: string }>;
}

/** Minimal subset of the Memory facade needed by the tool registry. */
export interface MemoryProvider {
  recall(query: string): string;
  /** Persist a durable, cross-project fact. Idempotent; see Memory.addCoreFact. */
  addCoreFact(fact: string): { added: boolean };
}

/** @deprecated Use {@link MemoryProvider} — kept as an alias for compatibility. */
export type RecallProvider = MemoryProvider;

// ---------------------------------------------------------------------------
// Built-in recall ToolDefinition
// ---------------------------------------------------------------------------

const RECALL_DEF: ToolDefinition = {
  name: "recall",
  description:
    "Search the knowledge base (wiki ∪ recent pending) for relevant context.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query to look up in the knowledge base.",
      },
    },
    required: ["query"],
  },
};

// ---------------------------------------------------------------------------
// Built-in remember_core ToolDefinition
// ---------------------------------------------------------------------------

const REMEMBER_CORE_DEF: ToolDefinition = {
  name: "remember_core",
  description:
    "Save ONE durable, stable fact about the user to always-loaded core memory " +
    "(injected into every future conversation). Use ONLY for facts that are " +
    "true across projects and over time — the user's role, enduring " +
    "preferences, environment, or working style. Do NOT use it for transient " +
    "task details (those are captured automatically), one-off context, secrets " +
    "or credentials, or anything the user did not actually assert about " +
    "themselves. When in doubt, do not call this.",
  parameters: {
    type: "object",
    properties: {
      fact: {
        type: "string",
        description:
          "A single, self-contained fact about the user, phrased to make sense " +
          "with no surrounding context (e.g. \"Prefers TypeScript and vitest\").",
      },
    },
    required: ["fact"],
  },
};

// ---------------------------------------------------------------------------
// buildTools
// ---------------------------------------------------------------------------

export interface ToolRegistry {
  defs: ToolDefinition[];
  dispatch(name: string, args: any): Promise<{ ok: boolean; output: string }>;
}

/**
 * Build the tool registry for a single agent run.
 *
 * @param skills  A SkillProvider (or null/undefined if skills are unavailable).
 *                When null/undefined, only the built-in `recall` and
 *                `remember_core` tools are registered.
 * @param memory  A MemoryProvider; required — `recall` and `remember_core`
 *                are always available.
 *
 * @returns `{ defs, dispatch }` where:
 *   - `defs` is the array of ToolDefinitions to pass to the LLM.
 *   - `dispatch` routes a tool call to the appropriate backend and always
 *     resolves (never rejects) — errors are surfaced as `{ ok: false, output }`.
 */
export function buildTools(
  skills: SkillProvider | null | undefined,
  memory: MemoryProvider
): ToolRegistry {
  // ------------------------------------------------------------------
  // Build defs
  // ------------------------------------------------------------------
  const skillDefs: ToolDefinition[] =
    skills != null
      ? skills.getAvailableSkills().map((skill) => {
          // Optionally enrich description with available scripts
          const loaded = skills.loadSkill(skill.name);
          const scriptList = loaded?.scripts?.length
            ? ` Available scripts: ${loaded.scripts.join(", ")}.`
            : "";

          return {
            name: skill.name,
            description: `${skill.description}${scriptList}`,
            parameters: {
              type: "object",
              properties: {
                script: {
                  type: "string",
                  description:
                    "The script file in the skill's scripts/ directory to run.",
                },
                args: {
                  type: "array",
                  items: { type: "string" },
                  description: "Positional arguments to pass to the script.",
                },
              },
              required: ["script"],
            },
          } satisfies ToolDefinition;
        })
      : [];

  const defs: ToolDefinition[] = [RECALL_DEF, REMEMBER_CORE_DEF, ...skillDefs];

  // ------------------------------------------------------------------
  // dispatch — never throws
  // ------------------------------------------------------------------
  async function dispatch(
    name: string,
    args: any
  ): Promise<{ ok: boolean; output: string }> {
    // Route: recall
    if (name === "recall") {
      const query = String(args?.query ?? "");
      const output = memory.recall(query);
      return { ok: true, output };
    }

    // Route: remember_core
    if (name === "remember_core") {
      const fact = String(args?.fact ?? "").trim();
      if (!fact) {
        return {
          ok: false,
          output: 'tool "remember_core" requires a non-empty "fact" argument',
        };
      }
      const { added } = memory.addCoreFact(fact);
      return {
        ok: true,
        output: added
          ? "Saved to core memory."
          : "Already in core memory — no change.",
      };
    }

    // Route: skill
    if (skills == null) {
      return { ok: false, output: `unknown tool: ${name}` };
    }

    try {
      const scriptName: string = args?.script ?? "";
      if (!scriptName) {
        return { ok: false, output: `tool "${name}" requires a "script" argument` };
      }
      // Coerce args to strings — some providers emit non-string array items.
      const scriptArgs: string[] = Array.isArray(args?.args)
        ? args.args.map(String)
        : [];
      const res = await skills.executeScript(name, scriptName, scriptArgs);
      if (res.success) {
        return { ok: true, output: res.stdout };
      }
      // Prefer stderr; fall back to stdout; fall back to generic message
      const output = res.stderr || res.stdout || "skill failed";
      return { ok: false, output };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "skill failed");
      return { ok: false, output: message };
    }
  }

  return { defs, dispatch };
}
