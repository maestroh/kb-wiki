import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyDestination, ingest } from "./ingest.js";
import { parseDoc } from "./contract.js";
import { listPending } from "./index-sections.js";
import { readFileSync } from "node:fs";

describe("classifyDestination", () => {
  it("maps extensions to raw subdirs", () => {
    expect(classifyDestination("a.md")).toBe("notes");
    expect(classifyDestination("a.txt")).toBe("notes");
    expect(classifyDestination("a.pdf")).toBe("documents");
    expect(classifyDestination("a.docx")).toBe("documents");
    expect(classifyDestination("a.pptx")).toBe("documents");
    expect(classifyDestination("a.png")).toBe("images");
    expect(classifyDestination("a.mp4")).toBe("videos");
    expect(classifyDestination("a.zip")).toBe(".");
  });
});

let kb: string;
beforeEach(() => {
  kb = mkdtempSync(join(tmpdir(), "kb-ingest-"));
  const wiki = join(kb, "projects", "p", "wiki");
  mkdirSync(wiki, { recursive: true });
  writeFileSync(
    join(wiki, "_index.md"),
    [
      "---", "kind: kb-project", "name: p", "description: test", "keywords: []", "created: 2026-06-01", "---",
      "", "## Articles", "", "_No articles yet._",
      "", "## Raw Sources (pending)", "", "_None._",
      "", "## Raw Sources (compiled)", "", "_None._",
      "", "## Raw Sources (archived)", "", "_None._",
    ].join("\n")
  );
});
afterEach(() => rmSync(kb, { recursive: true, force: true }));

describe("ingest", () => {
  it("stages inline text as a timestamped note and records pending", () => {
    const res = ingest(kb, "p", { kind: "note", text: "a thought worth keeping" });
    expect(res.path).toMatch(/^raw\/notes\/.*-note\.md$/);
    expect(res.pendingCount).toBe(1);
    expect(existsSync(join(kb, "projects", "p", res.path))).toBe(true);
    const { data } = parseDoc(readFileSync(join(kb, "projects", "p", res.path), "utf-8"));
    expect(data.created).toBeDefined();
  });

  it("copies an existing file into the right subdir and records pending", () => {
    const src = join(kb, "source.pdf");
    writeFileSync(src, "%PDF-1.4 fake");
    const res = ingest(kb, "p", { kind: "file", filePath: src });
    expect(res.path).toBe("raw/documents/source.pdf");
    expect(existsSync(join(kb, "projects", "p", "raw", "documents", "source.pdf"))).toBe(true);
    expect(res.pendingCount).toBe(1);
  });

  it("records each ingested source in pending", () => {
    ingest(kb, "p", { kind: "note", text: "one" });
    const res2 = ingest(kb, "p", { kind: "note", text: "two" });
    expect(res2.pendingCount).toBe(2);
    const { body } = parseDoc(readFileSync(join(kb, "projects", "p", "wiki", "_index.md"), "utf-8"));
    expect(listPending(body)).toHaveLength(2);
  });

  it("throws when the project wiki index is missing", () => {
    expect(() => ingest(kb, "nope", { kind: "note", text: "x" })).toThrow(/wiki\/_index\.md/);
  });
});
