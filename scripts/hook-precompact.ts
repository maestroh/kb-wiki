import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ingest } from "./ingest.js";

export function extractRecentText(jsonl: string, maxLines: number): string {
  const lines = jsonl.split("\n").filter(Boolean).slice(-maxLines);
  const parts: string[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const content = obj?.message?.content;
      if (typeof content === "string") parts.push(content);
      else if (Array.isArray(content)) {
        for (const c of content) if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
      }
    } catch {
      // skip non-JSON lines
    }
  }
  return parts.join("\n\n").trim();
}

export function persistRecency(kbRoot: string, text: string): void {
  const pointer = join(kbRoot, ".kb-active");
  if (!existsSync(pointer) || !text.trim()) return;
  const project = readFileSync(pointer, "utf-8").trim();
  if (!project) return;
  const wikiIndex = join(kbRoot, "projects", project, "wiki", "_index.md");
  if (!existsSync(wikiIndex)) return;
  ingest(kbRoot, project, { kind: "note", text: `# Pre-compaction snapshot\n\n${text}` });
}

// CLI: hook-precompact.ts <kbRoot>   (hook JSON on stdin, with transcript_path)
const [, , kbRootArg] = process.argv;
if (kbRootArg) {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(raw || "{}");
      const tpath = input.transcript_path;
      const jsonl = tpath && existsSync(tpath) ? readFileSync(tpath, "utf-8") : "";
      persistRecency(kbRootArg, extractRecentText(jsonl, 40));
    } catch {
      // hooks must never fail the session
    }
  });
}
