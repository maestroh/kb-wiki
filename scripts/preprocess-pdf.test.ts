import { describe, it, expect } from "vitest";
import { detectDocType, buildDocFrontmatter } from "./preprocess-pdf.js";

describe("detectDocType", () => {
  it("detects PDF files", () => {
    expect(detectDocType("report.pdf")).toBe("pdf");
  });

  it("detects DOCX files", () => {
    expect(detectDocType("notes.docx")).toBe("docx");
  });

  it("detects PPTX files", () => {
    expect(detectDocType("slides.pptx")).toBe("pptx");
  });

  it("returns unknown for unsupported types", () => {
    expect(detectDocType("data.csv")).toBe("unknown");
  });
});

describe("buildDocFrontmatter", () => {
  it("builds frontmatter with source file and type", () => {
    const result = buildDocFrontmatter("/path/to/report.pdf", "pdf");
    expect(result).toContain("source_file: /path/to/report.pdf");
    expect(result).toContain("doc_type: pdf");
    expect(result).toMatch(/converted: \d{4}-\d{2}-\d{2}/);
  });
});
