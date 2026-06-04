import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { parseDoc, stringifyDoc, today } from "./contract.js";
import { addPending, listPending } from "./index-sections.js";

const EXT_MAP: Record<string, string> = {
  ".md": "notes", ".txt": "notes",
  ".pdf": "documents", ".docx": "documents", ".pptx": "documents",
  ".png": "images", ".jpg": "images", ".jpeg": "images", ".gif": "images", ".svg": "images", ".webp": "images",
  ".mp4": "videos", ".mov": "videos", ".webm": "videos", ".mkv": "videos",
};

export function classifyDestination(filename: string): string {
  return EXT_MAP[extname(filename).toLowerCase()] ?? ".";
}

export type IngestSource =
  | { kind: "note"; text: string }
  | { kind: "file"; filePath: string };

export interface IngestResult {
  path: string; // relative to project dir, e.g. "raw/notes/x.md"
  pendingCount: number;
}

function timestamp(): string {
  // YYYY-MM-DD-HH-MM from ISO string (UTC); deterministic format, not value.
  return new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "-");
}

export function ingest(kbRoot: string, project: string, source: IngestSource): IngestResult {
  const projectDir = join(kbRoot, "projects", project);
  const wikiIndexPath = join(projectDir, "wiki", "_index.md");
  if (!existsSync(wikiIndexPath)) {
    throw new Error(`project "${project}" has no wiki/_index.md — create it first`);
  }

  let rel: string;
  if (source.kind === "note") {
    const subdir = "notes";
    const filename = `${timestamp()}-note.md`;
    rel = `raw/${subdir}/${filename}`;
    mkdirSync(join(projectDir, "raw", subdir), { recursive: true });
    const content = stringifyDoc({ created: new Date().toISOString() }, source.text.trim());
    writeFileSync(join(projectDir, rel), content);
  } else {
    const filename = basename(source.filePath);
    const subdir = classifyDestination(filename);
    rel = subdir === "." ? `raw/${filename}` : `raw/${subdir}/${filename}`;
    mkdirSync(join(projectDir, "raw", subdir === "." ? "" : subdir), { recursive: true });
    copyFileSync(source.filePath, join(projectDir, rel));
  }

  const idx = parseDoc(readFileSync(wikiIndexPath, "utf-8"));
  const body = addPending(idx.body, rel, today());
  writeFileSync(wikiIndexPath, stringifyDoc(idx.data, body));

  return { path: rel, pendingCount: listPending(body).length };
}

// CLI: ingest.ts <kbRoot> <project> note "<text>"   |   ingest.ts <kbRoot> <project> file <path>
const [, , kbRootArg, projectArg, kindArg, payloadArg] = process.argv;
if (kbRootArg && projectArg && kindArg) {
  try {
    const source: IngestSource =
      kindArg === "file"
        ? { kind: "file", filePath: payloadArg }
        : { kind: "note", text: payloadArg ?? "" };
    console.log(JSON.stringify(ingest(kbRootArg, projectArg, source)));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
