/**
 * preclean.ts — deterministic, no-LLM transcript pre-clean.
 *
 * Converts a Message[] into a compact prose string by:
 *   - Keeping user and assistant text turns (structural keep/drop only).
 *   - Dropping system messages, tool messages, and assistant tool-call turns.
 *   - Stripping injected blocks from user content (see INJECTED BLOCK CONVENTIONS).
 *   - Extracting text from content-parts arrays; treating null as empty.
 *
 * INJECTED BLOCK CONVENTIONS (P5.5 must emit matching fences):
 *   1. <system-reminder>…</system-reminder>  (multiline, non-greedy)
 *   2. <!-- recall -->…<!-- end recall -->    (multiline, non-greedy)
 *
 * Output: survivors joined as "role: text" lines (newline-separated).
 * Pure function — no side effects, no LLM.
 */

import type { Message } from "../types.js";

// ── Content extraction ────────────────────────────────────────────────────────

/**
 * Extract a plain string from a message's `content` field.
 * Handles: string | ContentPart[] | null.
 */
function extractText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .join("");
  }
  return "";
}

// ── Injected-block stripping ──────────────────────────────────────────────────

/** Strip injected fenced regions from user-turn prose. */
function stripInjectedBlocks(text: string): string {
  // 1. <system-reminder>…</system-reminder>
  let out = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  // 2. <!-- recall -->…<!-- end recall -->
  out = out.replace(/<!--\s*recall\s*-->[\s\S]*?<!--\s*end recall\s*-->/g, "");
  return out.trim();
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Pre-clean a conversation transcript into a compact prose string.
 * No LLM. Pure, deterministic.
 */
export function preclean(messages: Message[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role;

    // DROP: system
    if (role === "system") continue;

    // DROP: tool result dumps
    if (role === "tool") continue;

    if (role === "assistant") {
      // DROP: tool-call turns (even if they carry some text)
      if ("tool_calls" in msg && msg.tool_calls && msg.tool_calls.length > 0) {
        continue;
      }
      const text = extractText(msg.content).trim();
      if (!text) continue;
      lines.push(`assistant: ${text}`);
      continue;
    }

    if (role === "user") {
      const raw = extractText(msg.content);
      const text = stripInjectedBlocks(raw).trim();
      if (!text) continue;
      lines.push(`user: ${text}`);
      continue;
    }

    // Any future/unknown role → drop (conservative)
  }

  return lines.join("\n");
}
