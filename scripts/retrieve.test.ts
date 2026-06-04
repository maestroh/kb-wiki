import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gather } from "./retrieve.js";

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-retrieve-"));
  const wiki = join(kb, "projects", "p", "wiki");
  const notes = join(kb, "projects", "p", "raw", "notes");
  mkdirSync(wiki, { recursive: true });
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, "fresh.md"), "the newest uncompiled idea");
  writeFileSync(
    join(wiki, "_index.md"),
    [
      "---", "kind: kb-project", "name: p", "description: test", "keywords: []", "created: 2026-06-01", "---",
      "", "## Articles", "", "- [[agent-loop]] — the planner/executor cycle",
      "", "## Raw Sources (pending)", "", "- raw/notes/fresh.md — added 2026-06-02, not yet compiled",
      "", "## Raw Sources (compiled)", "", "_None._",
      "", "## Raw Sources (archived)", "", "_None._",
    ].join("\n")
  );
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

describe("gather", () => {
  it("returns wiki articles and pending raw with content", () => {
    const r = gather(kb, "p");
    expect(r.project).toBe("p");
    expect(r.articles).toEqual([{ slug: "agent-loop", summary: "the planner/executor cycle" }]);
    expect(r.pending).toEqual([{ path: "raw/notes/fresh.md", content: "the newest uncompiled idea" }]);
  });
});
