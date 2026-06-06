/**
 * core.ts — thin wrapper for the core-facts accessor.
 *
 * Exists as its own unit so both the Memory facade (index.ts) and any future
 * callers can import a stable `coreFacts` name without reaching into kb.ts.
 */

import { listFacts } from "./kb.js";

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
