import { describe, it, expect } from "vitest";
import {
  buildTranscriptMarkdown,
  buildVideoFrontmatter,
  formatTimestamp,
} from "./preprocess-video.js";

describe("formatTimestamp", () => {
  it("formats seconds into HH:MM:SS", () => {
    expect(formatTimestamp(0)).toBe("00:00:00");
    expect(formatTimestamp(65)).toBe("00:01:05");
    expect(formatTimestamp(3661)).toBe("01:01:01");
  });
});

describe("buildVideoFrontmatter", () => {
  it("builds frontmatter with source file", () => {
    const result = buildVideoFrontmatter("/path/to/video.mp4");
    expect(result).toContain("source_file: /path/to/video.mp4");
    expect(result).toContain("media_type: video");
    expect(result).toMatch(/converted: \d{4}-\d{2}-\d{2}/);
  });
});

describe("buildTranscriptMarkdown", () => {
  it("interlaces screenshots with transcript segments", () => {
    const segments = [
      { start: 0, end: 30, text: "Hello everyone" },
      { start: 30, end: 60, text: "Welcome to the talk" },
    ];
    const frames = ["frame_000.png", "frame_030.png"];
    const result = buildTranscriptMarkdown(segments, frames, "frames");

    expect(result).toContain("![00:00:00](frames/frame_000.png)");
    expect(result).toContain("Hello everyone");
    expect(result).toContain("![00:00:30](frames/frame_030.png)");
    expect(result).toContain("Welcome to the talk");
  });

  it("handles more segments than frames", () => {
    const segments = [
      { start: 0, end: 30, text: "Part one" },
      { start: 30, end: 60, text: "Part two" },
      { start: 60, end: 90, text: "Part three" },
    ];
    const frames = ["frame_000.png"];
    const result = buildTranscriptMarkdown(segments, frames, "frames");

    expect(result).toContain("![00:00:00](frames/frame_000.png)");
    expect(result).toContain("Part one");
    expect(result).toContain("Part two");
    expect(result).toContain("Part three");
  });
});
