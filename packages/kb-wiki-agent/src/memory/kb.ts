/**
 * kb.ts — stable typed surface for kb-wiki Layer 1 scripts.
 *
 * Re-exports the functions and types the memory module needs so the rest of
 * the agent never reaches into script internals directly. No business logic
 * lives here beyond the `resolve` 1-liner composition convenience.
 */

// ── Functions ────────────────────────────────────────────────────────────────
export { buildPlan }        from "kb-wiki-scripts/compile-plan.js";
export { commit,
         validateCommit,
         renderArticle }    from "kb-wiki-scripts/compile-commit.js";
export { ingest,
         classifyDestination } from "kb-wiki-scripts/ingest.js";
export { gather }           from "kb-wiki-scripts/retrieve.js";
export { listFacts,
         addFact }          from "kb-wiki-scripts/core.js";
export { sync,
         tokenizeRemoteUrl } from "kb-wiki-scripts/sync.js";
export { readRoot,
         writeRoot,
         upsertProject }    from "kb-wiki-scripts/registry.js";
export { parseDoc,
         stringifyDoc }     from "kb-wiki-scripts/contract.js";

// ── Types ────────────────────────────────────────────────────────────────────
export type { CompilePlan,
              PendingSource as CompilePendingSource } from "kb-wiki-scripts/compile-plan.js";
export type { ArticleOp,
              CommitInput,
              CommitResult }  from "kb-wiki-scripts/compile-commit.js";
export type { IngestSource,
              IngestResult }  from "kb-wiki-scripts/ingest.js";
export type { RetrieveResult,
              PendingSource as RetrievePendingSource } from "kb-wiki-scripts/retrieve.js";
export type { SyncResult }   from "kb-wiki-scripts/sync.js";
export type { ResolveSignals,
              ResolveResult } from "kb-wiki-scripts/resolve.js";
// Shapes surfaced through CompilePlan / RetrieveResult / ResolveResult that
// downstream memory units (recall, compile) need to annotate intermediates.
export type { ArticleEntry } from "kb-wiki-scripts/index-sections.js";
export type { ProjectRegistryEntry,
              RootFrontmatter } from "kb-wiki-scripts/contract.js";

// ── resolve convenience wrapper ───────────────────────────────────────────────
// Composes readRoot + matchProject so callers can resolve from a kbRoot path
// rather than needing to read the root frontmatter themselves.
import { readRoot }       from "kb-wiki-scripts/registry.js";
import { matchProject }   from "kb-wiki-scripts/resolve.js";
// Local import needed for the signature below: a re-export does not bind the
// names into this module's scope.
import type { ResolveSignals, ResolveResult } from "kb-wiki-scripts/resolve.js";

export function resolve(kbRoot: string, signals: ResolveSignals): ResolveResult {
  return matchProject(readRoot(kbRoot), signals);
}
