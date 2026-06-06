/**
 * recall.ts — read-merge: surfaces wiki ∪ pending knowledge as a single
 * context block for the agent.
 *
 * Design decisions:
 *
 * FENCE DECISION — returns RAW content (no <!-- recall --> wrapping).
 * recall() is also surfaced as a tool result to the model (where HTML fences
 * are noise). The P7.1/loop is responsible for wrapping the output in
 * <!-- recall -->…<!-- end recall --> when injecting into user/system turns,
 * so that P5.2 preclean can strip it back out on the next turn.
 *
 * NONE CASE — when no project matches, returns a brief labeled note rather
 * than dumping all projects. The agent (P6/P7) can decide whether to ask the
 * user to clarify or proceed without KB context.
 *
 * TOKENIZATION — splits the free-text query on any run of non-word characters
 * (\W+), lowercases each token, and drops empty strings. Deterministic and
 * locale-independent. Short common words are left in; matchProject's
 * substring scoring naturally de-weights them.
 */

import { resolve, gather } from "./kb.js";
import type { RetrieveResult } from "./kb.js";

// ---------------------------------------------------------------------------
// Tokenize
// ---------------------------------------------------------------------------

/**
 * Derive ResolveSignals keywords from a free-text query.
 * Split on non-word characters, lowercase, drop empties.
 */
function tokenize(query: string): string[] {
  return query
    .split(/\W+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// Format a single project's RetrieveResult into a context block
// ---------------------------------------------------------------------------

function formatProjectBlock(result: RetrieveResult): string {
  const lines: string[] = [];

  // ── Wiki (compiled articles) section ─────────────────────────────────────
  lines.push(`## ${result.project}`);
  lines.push("");

  if (result.articles.length === 0) {
    lines.push("(no compiled articles yet)");
  } else {
    for (const article of result.articles) {
      lines.push(`- ${article.slug}: ${article.summary}`);
    }
  }

  lines.push("");

  // ── Pending section ───────────────────────────────────────────────────────
  lines.push("### recent (not yet compiled)");
  lines.push("");

  if (result.pending.length === 0) {
    lines.push("(no pending sources)");
  } else {
    for (const src of result.pending) {
      lines.push(`[${src.path}]`);
      lines.push(src.content);
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// recall
// ---------------------------------------------------------------------------

/**
 * Resolve the project(s) relevant to `query`, gather their wiki articles and
 * pending raw sources, and return a single read-merged context string.
 *
 * Pure gather + format — no writes, no LLM, no side effects beyond what
 * `resolve`/`gather` already do.
 *
 * @param kbRoot  Absolute path to the knowledge-base root directory.
 * @param query   Free-text query (e.g. a user message or topic phrase).
 * @returns       A formatted context string, or a short "no knowledge" note.
 */
export function recall(kbRoot: string, query: string): string {
  const keywords = tokenize(query);
  const result = resolve(kbRoot, { keywords });

  let projectNames: string[];

  switch (result.status) {
    case "match":
      projectNames = [result.project!.name];
      break;

    case "ambiguous":
      // Surface all tied candidates so the agent has broader context.
      // P6/P7 may choose to narrow further via adjudication.
      projectNames = result.candidates!.map((c) => c.name);
      break;

    case "none":
      // No relevant project found. Return a short labeled note — do NOT dump
      // all projects (that would pollute the model's context with irrelevant
      // content and violate the "pure gather" contract).
      return "(no matching project knowledge — the query did not match any registered project)";
  }

  // Gather each project and format its block
  const blocks = projectNames.map((name) => {
    const retrieved = gather(kbRoot, name);
    return formatProjectBlock(retrieved);
  });

  // Concatenate multiple blocks with a clear separator (ambiguous case)
  return blocks.join("\n\n---\n\n");
}
