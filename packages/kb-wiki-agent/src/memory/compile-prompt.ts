/**
 * compile-prompt.ts — LLM messages for the background compile step.
 *
 * Ports the synthesis rules from kb-compile/SKILL.md (§2 "Synthesize article
 * operations") into a system prompt. The user message is the CompilePlan brief
 * serialised as JSON.
 */

import type { Message } from "../types.js";
import type { CompilePlan } from "./kb.js";

// ---------------------------------------------------------------------------
// Synthesis rules (ported from kb-compile SKILL.md §2)
// ---------------------------------------------------------------------------

const SYSTEM_RULES = `\
You are compiling a project's pending raw sources into synthesized wiki articles.

## Input brief
You will receive a JSON object:
  { project, existingArticles: [{slug, summary}], pendingSources: [{path, content}] }

## Your task
Read every pending source's content and the list of existing articles. For each concept:
- If the concept matches an existing article → op: "update" (keep the same slug).
- If the concept is new → op: "create" (assign a new kebab-case slug).

Articles are SYNTHESIZED (not copied verbatim from the source). Write them in your own
words, linking generously with [[wikilinks]] for concepts within the same project, and
using cross-project links of the form [[projects/<other-project>/wiki/<article>]] where
appropriate.

Every article must list the pending paths it drew from in its "sources" array.

## Accounting for every source
You MUST account for EVERY pending source path — each path goes into exactly one of:
- consumedPending: you incorporated it into an article (it contributed substantive content).
- archivedPending: you reviewed it and it held nothing durable (e.g. duplicate, trivial,
  or noise). Include it here rather than silently dropping it.

After a full compile, the union of consumedPending and archivedPending must equal the full
set of pending source paths. Pending must be empty after your response is applied.

## Output format
Output ONLY a single JSON object with this exact shape — no prose, no markdown fences:
{
  "project": "<project name>",
  "articles": [
    {
      "op": "create" | "update",
      "slug": "<kebab-case-slug>",
      "title": "<Title Case title>",
      "summary": "<one-line summary>",
      "body": "<synthesized markdown body with [[wikilinks]]>",
      "sources": ["<relative pending path>", ...]
    }
  ],
  "consumedPending": ["<relative pending path>", ...],
  "archivedPending": ["<relative pending path>", ...]
}

Requirements that will be validated:
- slug must be valid kebab-case (lowercase letters, digits, hyphens only; slugify(slug) === slug).
- title must be non-empty.
- sources must contain at least one path.
- consumedPending ∪ archivedPending must equal the full set of pending source paths.

Do not include any explanation, preamble, or trailing text outside the JSON object.`;

// ---------------------------------------------------------------------------
// buildCompileMessages
// ---------------------------------------------------------------------------

/**
 * Build the LLM messages for one project compile.
 *
 * @param plan  The CompilePlan produced by buildPlan(kbRoot, project).
 * @returns     [systemMessage, userMessage] suitable for LLMRequest.messages.
 */
export function buildCompileMessages(plan: CompilePlan): Message[] {
  const brief = {
    project: plan.project,
    existingArticles: plan.existingArticles,
    pendingSources: plan.pendingSources,
  };

  return [
    { role: "system", content: SYSTEM_RULES },
    { role: "user", content: JSON.stringify(brief) },
  ];
}
