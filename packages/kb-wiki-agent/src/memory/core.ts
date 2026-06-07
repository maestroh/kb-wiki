/**
 * core.ts — thin wrapper for the core-facts accessor.
 *
 * Exists as its own unit so both the Memory facade (index.ts) and any future
 * callers can import a stable `coreFacts` name without reaching into kb.ts.
 */

import { listFacts, addFact } from "./kb.js";

/**
 * Return the core-tier facts for the given KB root.
 *
 * Reads `core/_index.md` via Layer 1 `listFacts`. Returns an empty array
 * when the file does not exist (listFacts handles missing file gracefully).
 *
 * @param kbRoot  Absolute path to the knowledge-base root directory.
 */
export function coreFacts(kbRoot: string): string[] {
  return listFacts(kbRoot);
}

/**
 * Append a durable, cross-project fact to `core/_index.md`.
 *
 * Delegates to Layer 1 `addFact`, which is idempotent (normalizes and dedupes)
 * and creates the file/dir on first write. Returns `{ added: false }` for a
 * blank fact or a normalized duplicate, `{ added: true }` when newly written.
 *
 * @param kbRoot  Absolute path to the knowledge-base root directory.
 * @param fact    The fact text to persist (no date stamp — addFact stamps it).
 */
export function addCoreFact(kbRoot: string, fact: string): { added: boolean } {
  return addFact(kbRoot, fact);
}
