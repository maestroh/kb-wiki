/**
 * compile.ts — threshold-gated, best-effort background compile.
 *
 * maybeCompile reads the total pending count across all projects; if it meets
 * or exceeds opts.threshold it calls the LLM to synthesize articles and commits
 * the result. Errors are swallowed (best-effort, fire-and-forget): pending
 * stays pending until a future call succeeds.
 *
 * NOTE: A per-request model override for cheaper compile models is deferred to
 * P7.1, which may construct a compile-specific LLMClient. opts only accepts
 * {threshold} for now.
 *
 * NOTE: Batching (SKILL.md §"Large topics") is out of scope here — one
 * commit per project is sufficient for P5.6.
 */

import type { LLMClient } from "../types.js";
import { readRoot, buildPlan, commit } from "./kb.js";
import type { CommitInput } from "./kb.js";
import { buildCompileMessages } from "./compile-prompt.js";
import { logger } from "../llm/logger.js";

// ---------------------------------------------------------------------------
// Fence-strip helper
// ---------------------------------------------------------------------------

/**
 * Defensively strip leading/trailing ```json (or ```) fences and whitespace
 * before parsing, because LLMs occasionally wrap JSON in markdown code blocks
 * even when instructed not to.
 */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

// ---------------------------------------------------------------------------
// maybeCompile
// ---------------------------------------------------------------------------

export interface CompileOpts {
  /** Compile is skipped unless total pending count is ≥ threshold. */
  threshold: number;
}

/**
 * Best-effort, threshold-gated compile.
 *
 * 1. Sum pending sources across all registered projects.
 * 2. If total < threshold → return immediately (no-op).
 * 3. For each project that has pending sources:
 *    a. Build the compile prompt from the plan.
 *    b. Call llm.complete with temperature=0.
 *    c. Parse the JSON response (strip fences defensively).
 *    d. commit() the result into the KB.
 * 4. Any error at any stage is caught and logged; the function never throws.
 */
export async function maybeCompile(
  kbRoot: string,
  llm: LLMClient,
  opts: CompileOpts
): Promise<void> {
  try {
    // ── 1. Count total pending across all projects ───────────────────────────
    const root = readRoot(kbRoot);
    const plans: Array<{ project: string; pendingCount: number }> = [];

    for (const entry of root.projects) {
      try {
        const plan = buildPlan(kbRoot, entry.name);
        if (plan.pendingSources.length > 0) {
          plans.push({ project: entry.name, pendingCount: plan.pendingSources.length });
        }
      } catch (err) {
        // A malformed project (missing wiki/_index.md) should not abort the
        // count — skip it and continue.
        logger.error(
          `[compile] skipping malformed project "${entry.name}":`,
          (err as Error).message
        );
      }
    }

    const total = plans.reduce((sum, p) => sum + p.pendingCount, 0);

    // ── 2. Threshold gate ────────────────────────────────────────────────────
    if (total < opts.threshold) {
      return;
    }

    // ── 3. Per-project compile ───────────────────────────────────────────────
    for (const { project } of plans) {
      try {
        const plan = buildPlan(kbRoot, project);

        // Build prompt messages and call the LLM.
        const messages = buildCompileMessages(plan);
        const res = await llm.complete({ messages, temperature: 0, toolChoice: "none" });

        // Parse JSON response, defensively stripping fences.
        const parsed: CommitInput = JSON.parse(stripFences(res.content));

        // Commit the synthesized articles.
        commit(kbRoot, parsed);
      } catch (err) {
        // Per-project errors are swallowed so one bad project doesn't abort
        // the rest. Pending stays pending (idempotent — next call retries).
        logger.error(
          `[compile] error compiling project "${project}":`,
          (err as Error).message
        );
      }
    }
  } catch (err) {
    // Top-level guard: readRoot or unexpected errors never propagate.
    logger.error("[compile] unexpected error in maybeCompile:", (err as Error).message);
  }
}
