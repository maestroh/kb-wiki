/**
 * guards.ts — Deterministic anti-wander guards for the ReAct loop.
 *
 * All helpers are pure (no I/O, no LLM, no global mutable state outside
 * class instances). The only import is the shared GuardsConfig type.
 *
 * Boundary semantics (explicit):
 *
 *   budgetExceeded(step, tokens, cfg)
 *     - `step` is 1-indexed: the number of the loop iteration that just completed.
 *     - Trips when step >= (cfg.maxSteps ?? 15).
 *       So with maxSteps=3: step=2 → false, step=3 → true (AT the cap).
 *     - Trips when cfg.maxTokens is set AND tokens >= cfg.maxTokens.
 *     - Either condition independently causes a trip (logical OR).
 *
 *   repeatKey(name, args) → string
 *     - Canonicalises by recursively sorting object keys before JSON.stringify.
 *     - Stable: same (name, args) always produces the same string regardless
 *       of property insertion order.
 *
 *   RepeatTracker.seen(key): boolean
 *     - Mutates: adds the key to the internal set AND returns whether it was
 *       already present (false on first call, true on subsequent calls).
 *
 *   ErrorBackoff.record(name): void — increments failure count for the tool.
 *   ErrorBackoff.blocked(name, k=2): boolean — read-only; returns true once
 *     failures >= k. Does NOT mutate state.
 *
 *   anchorGoal(systemPrompt, goal): string
 *     - Format: `${goal}\n\n${systemPrompt}`
 *     - Result starts with the goal verbatim (satisfies output.startsWith(goal)).
 */

import type { GuardsConfig } from "../types";

// ---------------------------------------------------------------------------
// Step / token budget
// ---------------------------------------------------------------------------

/** Default maximum loop steps when cfg.maxSteps is not provided. */
const DEFAULT_MAX_STEPS = 15;

/**
 * Returns true when the loop should halt due to hitting the hard step or
 * token budget.
 *
 * @param step    1-indexed step number of the iteration that just ran.
 * @param tokens  Cumulative token count so far.
 * @param cfg     Guard configuration (maxSteps, maxTokens).
 */
export function budgetExceeded(
  step: number,
  tokens: number,
  cfg: GuardsConfig
): boolean {
  const maxSteps = cfg.maxSteps ?? DEFAULT_MAX_STEPS;
  if (step >= maxSteps) return true;
  if (cfg.maxTokens !== undefined && tokens >= cfg.maxTokens) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Repeat detection
// ---------------------------------------------------------------------------

/**
 * Recursively sorts object keys so that JSON.stringify produces a stable
 * canonical string regardless of property insertion order.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Returns a stable, order-independent string key for a (tool name, args) pair.
 * Use this as the lookup key for RepeatTracker.
 */
export function repeatKey(name: string, args: unknown): string {
  return `${name}:${JSON.stringify(canonicalize(args))}`;
}

/**
 * Tracks which (name, args) combinations have been seen in this loop run.
 * One instance per agent run; not shared globally.
 */
export class RepeatTracker {
  private readonly _seen = new Set<string>();

  /**
   * Returns whether `key` was already present, then records it.
   * - First call for a key: returns false (adds to set).
   * - Subsequent calls for the same key: returns true.
   */
  seen(key: string): boolean {
    const alreadySeen = this._seen.has(key);
    this._seen.add(key);
    return alreadySeen;
  }
}

// ---------------------------------------------------------------------------
// Error backoff
// ---------------------------------------------------------------------------

/**
 * Tracks per-tool failure counts to block stuck tools.
 * One instance per agent run.
 */
export class ErrorBackoff {
  private readonly _counts = new Map<string, number>();

  /** Increment the failure count for `name`. */
  record(name: string): void {
    this._counts.set(name, (this._counts.get(name) ?? 0) + 1);
  }

  /**
   * Read-only. Returns true once the tool has accumulated >= k failures.
   * Does NOT mutate state.
   *
   * @param name  Tool name.
   * @param k     Failure threshold (default 2).
   */
  blocked(name: string, k = 2): boolean {
    return (this._counts.get(name) ?? 0) >= k;
  }
}

// ---------------------------------------------------------------------------
// Goal re-anchoring
// ---------------------------------------------------------------------------

/**
 * Prepends the pinned objective to the system prompt so the goal cannot drift.
 *
 * Format: `${goal}\n\n${systemPrompt}`
 *
 * The returned string starts with `goal` verbatim, satisfying:
 *   anchorGoal(systemPrompt, goal).startsWith(goal)
 */
export function anchorGoal(systemPrompt: string, goal: string): string {
  return `${goal}\n\n${systemPrompt}`;
}
