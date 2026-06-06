import { describe, test, expect } from "vitest";
import { preclean } from "./preclean.js";
import type { Message } from "../types.js";

// ── Table-driven: Capture table rows ─────────────────────────────────────────

test.each([
  [{ role: "system", content: "goal" },                                          false],
  [{ role: "user", content: "we deploy via Fly" },                               true],
  [{ role: "assistant", content: "Done — CI added." },                           true],
  [{ role: "assistant", content: "calling tool", tool_calls: [{}] },             false],
  [{ role: "tool", content: "<huge dump>" },                                     false],
] as [Message, boolean][])(
  "keeps only substantive prose",
  (msg, kept) => {
    const out = preclean([msg as Message]);
    expect(out.includes(String((msg as any).content))).toBe(
      kept && !!((msg as any).content)
    );
  }
);

// ── Extra coverage rows ───────────────────────────────────────────────────────

describe("injected block stripping", () => {
  test("strips <system-reminder> block from user content but keeps human prose", () => {
    const msg: Message = {
      role: "user",
      content:
        "please help me\n" +
        "<system-reminder>\nsome injected reminder\nwith multiple lines\n</system-reminder>\n" +
        "and also fix the bug",
    };
    const out = preclean([msg]);
    expect(out).toContain("please help me");
    expect(out).toContain("and also fix the bug");
    expect(out).not.toContain("some injected reminder");
    expect(out).not.toContain("<system-reminder>");
  });

  test("strips <!-- recall --> fenced block from user content", () => {
    const msg: Message = {
      role: "user",
      content:
        "<!-- recall -->\nOld wiki content\n<!-- end recall -->\n" +
        "what should I do next?",
    };
    const out = preclean([msg]);
    expect(out).toContain("what should I do next?");
    expect(out).not.toContain("Old wiki content");
    expect(out).not.toContain("<!-- recall -->");
  });

  test("user message that becomes empty after stripping contributes nothing", () => {
    const msg: Message = {
      role: "user",
      content:
        "<system-reminder>\nonly injected content here\n</system-reminder>",
    };
    const out = preclean([msg]);
    expect(out.trim()).toBe("");
  });
});

describe("assistant with tool_calls", () => {
  test("drops assistant message that has tool_calls even if it has text", () => {
    const msg: Message = {
      role: "assistant",
      content: "I will now call the tool",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "do_thing", arguments: "{}" },
        },
      ],
    } as Message;
    const out = preclean([msg]);
    expect(out).not.toContain("I will now call the tool");
  });
});

describe("array content", () => {
  test("extracts text from content-parts array for user message", () => {
    const msg = {
      role: "user" as const,
      content: [
        { type: "text", text: "first part" },
        { type: "text", text: "second part" },
      ],
    } as unknown as Message;
    const out = preclean([msg]);
    expect(out).toContain("first part");
    expect(out).toContain("second part");
  });
});

describe("output format", () => {
  test("joins survivors as role: text lines", () => {
    const msgs: Message[] = [
      { role: "system", content: "scaffolding" },
      { role: "user", content: "deploy to Fly" },
      { role: "assistant", content: "Done, deployed." },
      { role: "tool", tool_call_id: "c1", content: "tool result dump" },
    ];
    const out = preclean(msgs);
    expect(out).toBe("user: deploy to Fly\nassistant: Done, deployed.");
  });

  test("empty input returns empty string", () => {
    expect(preclean([])).toBe("");
  });

  test("all-dropped messages returns empty string", () => {
    const msgs: Message[] = [
      { role: "system", content: "goal" },
      { role: "tool", tool_call_id: "c2", content: "dump" },
    ];
    expect(preclean(msgs)).toBe("");
  });
});
