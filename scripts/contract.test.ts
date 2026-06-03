import { describe, it, expect } from "vitest";
import {
  parseDoc,
  stringifyDoc,
  slugify,
  isValidProjectName,
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
});

describe("slugify", () => {
  it("kebab-cases a title", () => {
    expect(slugify("The Agent Loop!")).toBe("the-agent-loop");
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
