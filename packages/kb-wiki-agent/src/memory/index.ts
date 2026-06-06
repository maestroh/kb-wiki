/**
 * index.ts — Memory facade: the single public entry point for the memory module.
 *
 * `createMemory(config)` returns a `Memory` object that delegates each method
 * to the appropriate memory unit, binding `kbPath` (and optionally `gitToken`
 * and a compile `threshold`) at construction time.
 *
 * THRESHOLD CONFIG: The facade accepts an optional `threshold` (default 10,
 * matching the design's `compile: { threshold: 10 }`). P7.1 will pass
 * `config.compile?.threshold` through here when constructing the Memory.
 *
 * PUBLIC SURFACE (re-exported for P7.1):
 *   Memory          — the facade interface
 *   MemoryConfig    — { kbPath, gitToken? } (from ../types)
 *   Adjudicate      — injected LLM callback type (from ./resolve-project)
 *   SyncResult      — return type of sync() (from kb-wiki-scripts/sync)
 */

import { recall as recallFn }           from "./recall.js";
import { capture as captureFn }         from "./capture.js";
import { maybeCompile as maybeCompileFn } from "./compile.js";
import { coreFacts as coreFactsFn }     from "./core.js";
import { sync as syncFn }               from "./kb.js";

import type { Message, LLMClient, MemoryConfig } from "../types.js";
import type { Adjudicate }              from "./resolve-project.js";
import type { SyncResult }              from "./kb.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { MemoryConfig }   from "../types.js";
export type { Adjudicate }     from "./resolve-project.js";
export type { SyncResult }     from "./kb.js";

// ---------------------------------------------------------------------------
// Memory interface
// ---------------------------------------------------------------------------

export interface Memory {
  /** Read-merge: surfaces wiki ∪ pending knowledge for the given query. */
  recall(query: string): string;

  /**
   * Write path: preclean → resolve → ingest.
   * `adjudicate` is called only when Layer 1 cannot produce a unique match.
   */
  capture(
    exchange: Message[],
    adjudicate: Adjudicate
  ): Promise<{ ingested: boolean; project?: string; path?: string }>;

  /**
   * Threshold-gated, best-effort compile. Swallows all errors.
   * Uses the threshold stored at construction time (default 10).
   */
  maybeCompile(llm: LLMClient): Promise<void>;

  /** Return core-tier facts from `core/_index.md`. */
  coreFacts(): string[];

  /**
   * Sync the KB repo to its remote (stage → commit → pull --rebase → push).
   * Uses the gitToken stored at construction time.
   */
  sync(): SyncResult;
}

// ---------------------------------------------------------------------------
// createMemory
// ---------------------------------------------------------------------------

/**
 * Construct a Memory facade.
 *
 * @param config.kbPath     Absolute path to the knowledge-base root (also the
 *                          git repo dir — sync operates on it directly).
 * @param config.gitToken   Optional GitHub/HTTPS token for sync().
 * @param config.threshold  Pending-count threshold for maybeCompile (default 10).
 */
export function createMemory(
  config: MemoryConfig & { threshold?: number }
): Memory {
  const { kbPath, gitToken } = config;
  const threshold = config.threshold ?? 10;

  return {
    recall(query: string): string {
      return recallFn(kbPath, query);
    },

    capture(
      exchange: Message[],
      adjudicate: Adjudicate
    ): Promise<{ ingested: boolean; project?: string; path?: string }> {
      return captureFn(kbPath, exchange, adjudicate);
    },

    maybeCompile(llm: LLMClient): Promise<void> {
      return maybeCompileFn(kbPath, llm, { threshold });
    },

    coreFacts(): string[] {
      return coreFactsFn(kbPath);
    },

    sync(): SyncResult {
      return syncFn(kbPath, { token: gitToken });
    },
  };
}
