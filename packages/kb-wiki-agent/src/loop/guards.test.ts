/**
 * guards.test.ts — TDD suite for deterministic loop guards.
 *
 * Semantics under test (documented here so readers don't have to open guards.ts):
 *
 * budgetExceeded:
 *   - `step` is 1-indexed (the step number of the iteration that just ran).
 *   - Trips when step >= maxSteps (so step=3 with maxSteps=3 → true; step=2 → false).
 *   - Trips when tokens >= maxTokens (when maxTokens is set).
 *
 * repeatKey:
 *   - Returns a stable string for (name, args): same output regardless of object
 *     key insertion order. Object keys are sorted recursively before serialisation.
 *
 * RepeatTracker.seen:
 *   - Mutates: first call for a key adds it and returns false (not yet seen).
 *   - Second identical call returns true (was already seen).
 *
 * ErrorBackoff:
 *   - record(name) increments failure count for that tool.
 *   - blocked(name, k=2) returns true once failure count >= k.
 *   - blocked is read-only; only record mutates state.
 *
 * anchorGoal:
 *   - Returns `${goal}\n\n${systemPrompt}` — goal is prepended verbatim, result
 *     starts with the exact goal string.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  budgetExceeded,
  repeatKey,
  RepeatTracker,
  ErrorBackoff,
  anchorGoal,
} from "./guards";

// ---------------------------------------------------------------------------
// budgetExceeded
// ---------------------------------------------------------------------------
describe("budgetExceeded", () => {
  it("returns false when step is below maxSteps", () => {
    expect(budgetExceeded(2, 0, { maxSteps: 3 })).toBe(false);
  });

  it("returns true AT maxSteps (step=3 with maxSteps=3)", () => {
    expect(budgetExceeded(3, 0, { maxSteps: 3 })).toBe(true);
  });

  it("returns true above maxSteps", () => {
    expect(budgetExceeded(4, 0, { maxSteps: 3 })).toBe(true);
  });

  it("uses default maxSteps=15 when cfg omits maxSteps", () => {
    expect(budgetExceeded(14, 0, {})).toBe(false);
    expect(budgetExceeded(15, 0, {})).toBe(true);
  });

  it("trips on token budget when tokens >= maxTokens", () => {
    expect(budgetExceeded(1, 999, { maxTokens: 1000 })).toBe(false);
    expect(budgetExceeded(1, 1000, { maxTokens: 1000 })).toBe(true);
    expect(budgetExceeded(1, 1500, { maxTokens: 1000 })).toBe(true);
  });

  it("never trips on tokens alone when maxTokens is not set", () => {
    expect(budgetExceeded(1, 9_999_999, {})).toBe(false);
  });

  it("trips on either condition independently (step wins)", () => {
    expect(budgetExceeded(15, 0, { maxSteps: 15, maxTokens: 10000 })).toBe(true);
  });

  it("trips on either condition independently (tokens win)", () => {
    expect(budgetExceeded(1, 10000, { maxSteps: 15, maxTokens: 10000 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// repeatKey
// ---------------------------------------------------------------------------
describe("repeatKey", () => {
  it("returns the same key for the same name and args", () => {
    expect(repeatKey("search", { query: "hello" })).toBe(
      repeatKey("search", { query: "hello" })
    );
  });

  it("returns the same key regardless of object key insertion order", () => {
    const a = repeatKey("tool", { b: 2, a: 1 });
    const b = repeatKey("tool", { a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("returns different keys for different tool names", () => {
    expect(repeatKey("search", { query: "hi" })).not.toBe(
      repeatKey("fetch", { query: "hi" })
    );
  });

  it("returns different keys for different args", () => {
    expect(repeatKey("search", { query: "hello" })).not.toBe(
      repeatKey("search", { query: "world" })
    );
  });

  it("handles null args", () => {
    expect(repeatKey("noop", null)).toBe(repeatKey("noop", null));
    expect(repeatKey("noop", null)).not.toBe(repeatKey("other", null));
  });

  it("handles nested objects — order independent at every level", () => {
    const a = repeatKey("t", { x: { b: 2, a: 1 } });
    const b = repeatKey("t", { x: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// RepeatTracker
// ---------------------------------------------------------------------------
describe("RepeatTracker", () => {
  let tracker: RepeatTracker;

  beforeEach(() => {
    tracker = new RepeatTracker();
  });

  it("returns false on first encounter of a key", () => {
    expect(tracker.seen("abc")).toBe(false);
  });

  it("returns true on second encounter of the same key", () => {
    tracker.seen("abc"); // marks as seen
    expect(tracker.seen("abc")).toBe(true);
  });

  it("returns false for a different key even after others were seen", () => {
    tracker.seen("abc");
    expect(tracker.seen("xyz")).toBe(false);
  });

  it("is independent per instance", () => {
    const t2 = new RepeatTracker();
    tracker.seen("abc");
    expect(t2.seen("abc")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ErrorBackoff
// ---------------------------------------------------------------------------
describe("ErrorBackoff", () => {
  let backoff: ErrorBackoff;

  beforeEach(() => {
    backoff = new ErrorBackoff();
  });

  it("is not blocked initially", () => {
    expect(backoff.blocked("tool-a")).toBe(false);
  });

  it("is not blocked after 1 failure (default k=2)", () => {
    backoff.record("tool-a");
    expect(backoff.blocked("tool-a")).toBe(false);
  });

  it("is blocked after k=2 failures (default)", () => {
    backoff.record("tool-a");
    backoff.record("tool-a");
    expect(backoff.blocked("tool-a")).toBe(true);
  });

  it("a different tool remains unblocked", () => {
    backoff.record("tool-a");
    backoff.record("tool-a");
    expect(backoff.blocked("tool-b")).toBe(false);
  });

  it("respects a custom k value", () => {
    backoff.record("tool-a");
    backoff.record("tool-a");
    // not blocked at k=3
    expect(backoff.blocked("tool-a", 3)).toBe(false);
    backoff.record("tool-a");
    expect(backoff.blocked("tool-a", 3)).toBe(true);
  });

  it("blocked is read-only — calling it does not change state", () => {
    backoff.blocked("tool-a"); // should not record
    backoff.blocked("tool-a");
    expect(backoff.blocked("tool-a")).toBe(false); // still 0 failures
  });
});

// ---------------------------------------------------------------------------
// anchorGoal
// ---------------------------------------------------------------------------
describe("anchorGoal", () => {
  const goal = "Find the answer to the user's question about TypeScript.";
  const systemPrompt = "You are a helpful assistant with access to tools.";

  it("result starts with the goal verbatim", () => {
    const result = anchorGoal(systemPrompt, goal);
    expect(result.startsWith(goal)).toBe(true);
  });

  it("result contains the original system prompt", () => {
    const result = anchorGoal(systemPrompt, goal);
    expect(result).toContain(systemPrompt);
  });

  it("goal appears before the system prompt", () => {
    const result = anchorGoal(systemPrompt, goal);
    expect(result.indexOf(goal)).toBeLessThan(result.indexOf(systemPrompt));
  });

  it("handles empty system prompt", () => {
    const result = anchorGoal("", goal);
    expect(result.startsWith(goal)).toBe(true);
  });

  it("handles empty goal — returns systemPrompt (possibly with separator)", () => {
    const result = anchorGoal(systemPrompt, "");
    expect(result).toContain(systemPrompt);
  });
});
