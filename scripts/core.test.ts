import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addFact, listFacts } from "./core.js";

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-core-"));
  mkdirSync(kb, { recursive: true });
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

describe("addFact / listFacts", () => {
  it("creates core/_index.md and adds a fact", () => {
    const r = addFact(kb, "Prefers TypeScript for tooling");
    expect(r.added).toBe(true);
    expect(existsSync(join(kb, "core", "_index.md"))).toBe(true);
    expect(listFacts(kb)).toEqual(["Prefers TypeScript for tooling"]);
  });

  it("dedups case- and whitespace-insensitively", () => {
    addFact(kb, "Works at ImagineX Consulting");
    const r = addFact(kb, "  works at   imaginex consulting ");
    expect(r.added).toBe(false);
    expect(listFacts(kb)).toHaveLength(1);
  });

  it("appends distinct facts", () => {
    addFact(kb, "fact one");
    addFact(kb, "fact two");
    expect(listFacts(kb)).toEqual(["fact one", "fact two"]);
  });

  it("ignores a blank or whitespace-only fact without writing", () => {
    expect(addFact(kb, "   ").added).toBe(false);
    expect(existsSync(join(kb, "core", "_index.md"))).toBe(false);
    expect(listFacts(kb)).toEqual([]);
  });
});
