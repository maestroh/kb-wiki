import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractRecentText, persistRecency } from "./hook-precompact.js";
import { parseDoc } from "./contract.js";
import { listPending } from "./index-sections.js";

describe("extractRecentText", () => {
  it("pulls text from transcript JSONL user/assistant lines", () => {
    const jsonl = [
      JSON.stringify({ type: "user", message: { content: "hello" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi there" }] } }),
      "not json",
    ].join("\n");
    const text = extractRecentText(jsonl, 10);
    expect(text).toContain("hello");
    expect(text).toContain("hi there");
  });
});

describe("persistRecency", () => {
  let kb: string;
  beforeEach(() => {
    kb = mkdtempSync(join(tmpdir(), "kb-precompact-"));
    const wiki = join(kb, "projects", "active", "wiki");
    mkdirSync(wiki, { recursive: true });
    writeFileSync(
      join(wiki, "_index.md"),
      ["---","kind: kb-project","name: active","description: d","keywords: []","created: 2026-06-01","---","","## Articles","","_No articles yet._","","## Raw Sources (pending)","","_None._","","## Raw Sources (compiled)","","_None._"].join("\n")
    );
    writeFileSync(join(kb, ".kb-active"), "active");
  });
  afterEach(() => rmSync(kb, { recursive: true, force: true }));

  it("ingests recent text as a note into the active project", () => {
    persistRecency(kb, "some recent conversation worth keeping");
    const { body } = parseDoc(readFileSync(join(kb, "projects", "active", "wiki", "_index.md"), "utf-8"));
    expect(listPending(body)).toHaveLength(1);
  });

  it("no-ops when there is no active project pointer", () => {
    rmSync(join(kb, ".kb-active"));
    expect(() => persistRecency(kb, "x")).not.toThrow();
  });
});
