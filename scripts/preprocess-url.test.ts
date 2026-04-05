import { describe, it, expect } from "vitest";
import { htmlToMarkdown, slugifyTitle, buildFrontmatter } from "./preprocess-url.js";

describe("htmlToMarkdown", () => {
  it("converts simple HTML to markdown", () => {
    const html = "<h1>Test Title</h1><p>Hello <strong>world</strong></p>";
    const result = htmlToMarkdown(html);
    expect(result).toContain("# Test Title");
    expect(result).toContain("**world**");
  });

  it("converts links to markdown format", () => {
    const html = '<p>Visit <a href="https://example.com">Example</a></p>';
    const result = htmlToMarkdown(html);
    expect(result).toContain("[Example](https://example.com)");
  });

  it("converts images to markdown format", () => {
    const html = '<img src="image.png" alt="test image">';
    const result = htmlToMarkdown(html);
    expect(result).toContain("![test image](image.png)");
  });
});

describe("slugifyTitle", () => {
  it("converts title to kebab-case filename", () => {
    expect(slugifyTitle("Hello World: A Test")).toBe("hello-world-a-test");
  });

  it("removes special characters", () => {
    expect(slugifyTitle("What's New? (2024)")).toBe("whats-new-2024");
  });

  it("collapses multiple dashes", () => {
    expect(slugifyTitle("foo   bar---baz")).toBe("foo-bar-baz");
  });
});

describe("buildFrontmatter", () => {
  it("builds YAML frontmatter with source URL and date", () => {
    const result = buildFrontmatter("https://example.com/article", "Test Article");
    expect(result).toContain("source_url: https://example.com/article");
    expect(result).toContain("title: Test Article");
    expect(result).toMatch(/fetched: \d{4}-\d{2}-\d{2}/);
  });
});
