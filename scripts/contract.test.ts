import { describe, it, expect } from "vitest";
import {
  parseDoc,
  stringifyDoc,
  slugify,
  isValidProjectName,
  today,
  KB_VERSION,
} from "./contract.js";

describe("parseDoc / stringifyDoc", () => {
  it("round-trips frontmatter and body", () => {
    const md = "---\nkind: kb-article\nsources:\n  - raw/notes/a.md\n---\n\n# Title\n\nBody text.";
    const { data, body } = parseDoc(md);
    expect(data.kind).toBe("kb-article");
    expect(data.sources).toEqual(["raw/notes/a.md"]);
    expect(body).toBe("# Title\n\nBody text.");

    const out = stringifyDoc(data, body);
    const reparsed = parseDoc(out);
    expect(reparsed.data).toEqual(data);
    expect(reparsed.body).toBe(body);
  });

  it("treats a doc with no frontmatter as empty data", () => {
    const { data, body } = parseDoc("# Just a heading");
    expect(data).toEqual({});
    expect(body).toBe("# Just a heading");
  });

  it("keeps a YYYY-MM-DD frontmatter date byte-stable across a round-trip", () => {
    const md = "---\nkind: kb-project\ncreated: 2026-06-01\n---\n\n# Title\n\nBody.";
    const { data, body } = parseDoc(md);
    const out = stringifyDoc(data, body);
    expect(out).toContain("created: 2026-06-01");
    expect(out).not.toMatch(/created: 2026-06-01T/); // not an ISO timestamp
    // and a second round-trip is stable too
    const reparsed = parseDoc(out);
    expect(stringifyDoc(reparsed.data, reparsed.body)).toBe(out);
  });
});

describe("slugify", () => {
  it("kebab-cases a title", () => {
    expect(slugify("The Agent Loop!")).toBe("the-agent-loop");
  });
  it("strips curly apostrophes", () => {
    expect(slugify("The Agent’s Memory")).toBe("the-agents-memory");
  });
  it("strips straight apostrophes", () => {
    expect(slugify("don't")).toBe("dont");
  });
});

describe("isValidProjectName", () => {
  it("accepts kebab-case", () => {
    expect(isValidProjectName("acme-redesign")).toBe(true);
    expect(isValidProjectName("proj1")).toBe(true);
  });
  it("rejects spaces, caps, and edge dashes", () => {
    expect(isValidProjectName("Acme Redesign")).toBe(false);
    expect(isValidProjectName("-bad")).toBe(false);
    expect(isValidProjectName("bad-")).toBe(false);
    expect(isValidProjectName("")).toBe(false);
  });
});

describe("KB_VERSION", () => {
  it("is 1", () => {
    expect(KB_VERSION).toBe(1);
  });
});

describe("today", () => {
  it("returns an ISO-style YYYY-MM-DD date", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
