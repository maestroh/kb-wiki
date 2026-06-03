import { describe, it, expect } from "vitest";
import {
  getSection,
  replaceSection,
  listPending,
  addPending,
  moveToCompiled,
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
