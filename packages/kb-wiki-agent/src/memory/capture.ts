/**
 * capture.ts — deterministic write path: exchange → pending raw note.
 *
 * Pipeline:
 *   preclean(exchange)             → compact prose (empty if all-plumbing)
 *   resolveProject(kbRoot, ...)    → project name (LLM only via injected adjudicate)
 *   ensureProject(kbRoot, project) → scaffold dirs/index if new (idempotent)
 *   ingest(kbRoot, project, note)  → write pending raw note
 *
 * No LLM inside capture itself; the only LLM call is behind the injected
 * `adjudicate` callback used by resolveProject for ambiguous/none cases.
 */

import type { Message } from "../types.js";
import { preclean } from "./preclean.js";
import { resolveProject } from "./resolve-project.js";
import type { Adjudicate } from "./resolve-project.js";
import { ensureProject } from "./ensure-project.js";
import { ingest } from "./kb.js";
import type { ResolveSignals } from "./kb.js";

// ---------------------------------------------------------------------------
// Tokenizer — MUST match recall.ts's tokenizer for consistent resolution.
// Split on non-word characters, lowercase, drop tokens shorter than 3 chars
// (stopword guard: keeps "the", "a", "of", "are" out of keyword sets).
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .split(/\W+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2);
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

export interface CaptureResult {
  ingested: boolean;
  project?: string;
  path?: string;
}

/**
 * Turn one exchange into a pending raw note in the knowledge base.
 *
 * @param kbRoot     Absolute path to the knowledge-base root.
 * @param exchange   The conversation messages for this turn.
 * @param adjudicate Callback invoked by resolveProject when Layer 1 cannot
 *                   produce a unique match (ambiguous or none). The real
 *                   implementation (P7.1) wraps an LLM; tests pass stubs.
 * @returns          `{ ingested: false }` when the exchange has no substantive
 *                   content; `{ ingested: true, project, path }` otherwise.
 */
export async function capture(
  kbRoot: string,
  exchange: Message[],
  adjudicate: Adjudicate
): Promise<CaptureResult> {
  // ── 1. Pre-clean ──────────────────────────────────────────────────────────
  const text = preclean(exchange);
  if (!text.trim()) {
    return { ingested: false };
  }

  // ── 2. Build ResolveSignals from cleaned text ─────────────────────────────
  // Tokenizer mirrors recall.ts so keyword resolution behaves consistently.
  const keywords = tokenize(text);
  const signals: ResolveSignals = { keywords };

  // ── 3. Resolve project (may call adjudicate for ambiguous/none) ───────────
  const { project } = await resolveProject(kbRoot, signals, adjudicate);

  // ── 4. Ensure project dirs exist (idempotent scaffold) ────────────────────
  ensureProject(kbRoot, project);

  // ── 5. Ingest the cleaned text as a pending note ──────────────────────────
  const result = ingest(kbRoot, project, { kind: "note", text });

  return { ingested: true, project, path: result.path };
}
