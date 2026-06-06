/**
 * resolve-project.ts — headless project-resolution policy for the agent.
 *
 * Wraps Layer 1 `resolve()` with an injected `adjudicate` callback so the
 * policy stays pure and testable.  The real adjudicator (P7.1) wraps
 * llm.complete; tests pass lightweight stubs.
 *
 * Status routing:
 *   match     → return the matched name immediately, adjudicate never called.
 *   ambiguous → call adjudicate(candidates, signals); return its choice.
 *               created=true only if the chosen name is NOT among the candidates
 *               (the reasoner may propose a brand-new project even when there
 *               are partial matches).
 *   none      → call adjudicate([], signals); always created=true (nothing existed).
 */

import { resolve } from "./kb.js";
import type { ResolveSignals, ProjectRegistryEntry } from "./kb.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Callback that picks (or proposes) a project name when Layer 1 cannot
 * produce a unique match.  The real implementation (P7.1) is async (calls
 * LLM); stubs may be sync.  `resolveProject` awaits the result so both work.
 */
export type Adjudicate = (
  candidates: ProjectRegistryEntry[],
  signals: ResolveSignals
) => Promise<{ name: string }> | { name: string };

// ---------------------------------------------------------------------------
// resolveProject
// ---------------------------------------------------------------------------

export async function resolveProject(
  kbRoot: string,
  signals: ResolveSignals,
  adjudicate: Adjudicate
): Promise<{ project: string; created?: boolean }> {
  const result = resolve(kbRoot, signals);

  switch (result.status) {
    case "match":
      // Deterministic — no LLM needed.
      return { project: result.project!.name, created: false };

    case "ambiguous": {
      const candidates = result.candidates ?? [];
      const { name } = await adjudicate(candidates, signals);
      // created=true only if the adjudicator proposed a name outside the candidate set.
      const created = !candidates.some((c) => c.name === name);
      return { project: name, created };
    }

    case "none": {
      const { name } = await adjudicate([], signals);
      // Nothing existed → whatever name comes back is new.
      return { project: name, created: true };
    }
  }
}
