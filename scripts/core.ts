import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseDoc, stringifyDoc, today, KB_VERSION } from "./contract.js";

function coreIndexPath(kbRoot: string): string {
  return join(kbRoot, "core", "_index.md");
}

function normalize(fact: string): string {
  return fact.trim().replace(/\s+/g, " ").toLowerCase();
}

function readBody(kbRoot: string): { data: Record<string, any>; body: string } {
  const path = coreIndexPath(kbRoot);
  if (!existsSync(path)) {
    return { data: { kind: "kb-core", version: KB_VERSION }, body: "# Core Memory" };
  }
  return parseDoc(readFileSync(path, "utf-8"));
}

export function listFacts(kbRoot: string): string[] {
  const { body } = readBody(kbRoot);
  return body
    .split("\n")
    .map((l) => l.match(/^- (.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "").trim());
}

export function addFact(kbRoot: string, fact: string): { added: boolean } {
  if (!fact.trim()) return { added: false };
  const { data, body } = readBody(kbRoot);
  const existing = listFacts(kbRoot).map(normalize);
  if (existing.includes(normalize(fact))) return { added: false };

  const newBody = `${body.trim()}\n- ${fact.trim()} (${today()})`;
  mkdirSync(join(kbRoot, "core"), { recursive: true });
  writeFileSync(coreIndexPath(kbRoot), stringifyDoc(data, newBody));
  return { added: true };
}

// CLI: core.ts add "<fact>"  |  core.ts list   (KNOWLEDGE_BASE env = kbRoot)
const [, , cmd, factArg] = process.argv;
if (cmd) {
  try {
    const kbRoot = process.env.KNOWLEDGE_BASE;
    if (!kbRoot) throw new Error("KNOWLEDGE_BASE is not set");
    if (cmd === "add") console.log(JSON.stringify(addFact(kbRoot, factArg ?? "")));
    else if (cmd === "list") console.log(JSON.stringify({ facts: listFacts(kbRoot) }));
    else throw new Error(`unknown command: ${cmd}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
