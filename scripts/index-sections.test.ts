import { describe, it, expect, test } from "vitest";
import {
  getSection,
  replaceSection,
  listPending,
  addPending,
  moveToCompiled,
  moveToArchived,
  listArticles,
  upsertArticleEntries,
  setArticles,
  ArticleEntry,
} from "./index-sections.js";

const BODY = [
  "## Articles",
  "",
  "- [[agent-loop]] — the planner/executor cycle",
  "",
  "## Raw Sources (pending)",
  "",
  "- raw/notes/a.md — added 2026-06-01, not yet compiled",
  "- raw/documents/b.md — added 2026-06-01, not yet compiled",
  "",
  "## Raw Sources (compiled)",
  "",
  "_None._",
  "",
  "## Raw Sources (archived)",
  "",
  "_None._",
].join("\n");

describe("getSection / replaceSection", () => {
  it("extracts a section's inner content", () => {
    expect(getSection(BODY, "Articles").trim()).toBe(
      "- [[agent-loop]] — the planner/executor cycle"
    );
  });
  it("replaces a section's inner content, leaving others intact", () => {
    const out = replaceSection(BODY, "Raw Sources (compiled)", "- raw/notes/a.md — compiled 2026-06-02");
    expect(getSection(out, "Raw Sources (compiled)").trim()).toBe("- raw/notes/a.md — compiled 2026-06-02");
    expect(getSection(out, "Articles").trim()).toBe("- [[agent-loop]] — the planner/executor cycle");
  });
});

describe("listPending", () => {
  it("returns the raw paths under pending", () => {
    expect(listPending(BODY)).toEqual(["raw/notes/a.md", "raw/documents/b.md"]);
  });
  it("returns [] when pending is _None._", () => {
    const empty = replaceSection(BODY, "Raw Sources (pending)", "_None._");
    expect(listPending(empty)).toEqual([]);
  });
});

describe("addPending", () => {
  it("adds a bullet and removes the _None._ placeholder", () => {
    const empty = replaceSection(BODY, "Raw Sources (pending)", "_None._");
    const out = addPending(empty, "raw/links/c.md", "2026-06-02");
    expect(listPending(out)).toEqual(["raw/links/c.md"]);
    expect(getSection(out, "Raw Sources (pending)")).not.toContain("_None._");
  });
  it("preserves the original added-date of existing pending entries", () => {
    // BODY already has a.md and b.md added 2026-06-01
    const out = addPending(BODY, "raw/links/c.md", "2026-06-10");
    const pending = getSection(out, "Raw Sources (pending)");
    expect(pending).toContain("- raw/notes/a.md — added 2026-06-01, not yet compiled");
    expect(pending).toContain("- raw/links/c.md — added 2026-06-10, not yet compiled");
    expect(listPending(out)).toEqual(["raw/notes/a.md", "raw/documents/b.md", "raw/links/c.md"]);
  });
});

describe("moveToCompiled", () => {
  it("moves named paths from pending to compiled with a date", () => {
    const out = moveToCompiled(BODY, ["raw/notes/a.md"], "2026-06-02");
    expect(listPending(out)).toEqual(["raw/documents/b.md"]);
    expect(getSection(out, "Raw Sources (compiled)")).toContain(
      "- raw/notes/a.md — compiled 2026-06-02"
    );
  });
  it("restores _None._ when pending becomes empty", () => {
    const out = moveToCompiled(BODY, ["raw/notes/a.md", "raw/documents/b.md"], "2026-06-02");
    expect(listPending(out)).toEqual([]);
    expect(getSection(out, "Raw Sources (pending)").trim()).toBe("_None._");
  });
  it("preserves the original added-date of the remaining pending entry", () => {
    // a.md and b.md both added 2026-06-01; move only a.md
    const out = moveToCompiled(BODY, ["raw/notes/a.md"], "2026-06-02");
    const pending = getSection(out, "Raw Sources (pending)");
    expect(pending).toContain("- raw/documents/b.md — added 2026-06-01, not yet compiled");
  });
});

test("moveToArchived moves a pending path into the archived section", () => {
  let body = "## Articles\n\n_No articles yet._\n\n## Raw Sources (pending)\n\n_None._\n\n## Raw Sources (compiled)\n\n_None._\n\n## Raw Sources (archived)\n\n_None._";
  body = addPending(body, "raw/notes/a.md", "2026-06-05");
  body = moveToArchived(body, ["raw/notes/a.md"], "2026-06-05");
  expect(listPending(body)).toEqual([]);
  expect(getSection(body, "Raw Sources (archived)")).toContain("raw/notes/a.md");
  expect(getSection(body, "Raw Sources (archived)")).toContain("no durable content");
});

describe("articles", () => {
  it("lists existing article entries", () => {
    expect(listArticles(BODY)).toEqual([
      { slug: "agent-loop", summary: "the planner/executor cycle" },
    ]);
  });
  it("upserts entries by slug", () => {
    const existing: ArticleEntry[] = [{ slug: "agent-loop", summary: "old" }];
    const merged = upsertArticleEntries(existing, [
      { slug: "agent-loop", summary: "new" },
      { slug: "memory-tiers", summary: "core vs archival" },
    ]);
    expect(merged).toEqual([
      { slug: "agent-loop", summary: "new" },
      { slug: "memory-tiers", summary: "core vs archival" },
    ]);
  });
  it("renders the Articles section from entries", () => {
    const out = setArticles(BODY, [{ slug: "x", summary: "y" }]);
    expect(getSection(out, "Articles").trim()).toBe("- [[x]] — y");
  });
});
