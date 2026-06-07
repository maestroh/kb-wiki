/**
 * tools.test.ts — TDD suite for the tool registry (skills ∪ recall).
 *
 * Contract under test:
 *
 *   buildTools(skills, memory) → { defs, dispatch }
 *
 *   defs:
 *     - Always contains a "recall" ToolDefinition.
 *     - Contains one ToolDefinition per skill returned by skills.getAvailableSkills().
 *     - When skills is undefined/null → defs = [recall only].
 *
 *   dispatch(name, args) → Promise<{ ok: boolean; output: string }>
 *     - dispatch("recall", { query }) → memory.recall called, ok: true.
 *     - dispatch(skillName, { script, args }) → skills.executeScript called, ok from success.
 *     - dispatch of unknown tool (null skills path) → ok: false, never throws.
 *     - dispatch NEVER throws on bad input.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTools } from "./tools";
import type { SkillProvider, MemoryProvider } from "./tools";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeSkills(): SkillProvider & {
  executeScript: ReturnType<typeof vi.fn>;
} {
  const executeScript = vi.fn(async () => ({
    success: true,
    stdout: "hello",
    stderr: "",
  }));
  return {
    getAvailableSkills: () => [{ name: "echo", description: "Echoes input" }],
    loadSkill: (_n: string) => ({ scripts: ["run.sh"] }),
    executeScript,
  };
}

function makeMemory(): MemoryProvider & {
  recall: ReturnType<typeof vi.fn>;
  addCoreFact: ReturnType<typeof vi.fn>;
} {
  return {
    recall: vi.fn((q: string) => `recalled: ${q}`),
    addCoreFact: vi.fn((_f: string) => ({ added: true })),
  };
}

// ---------------------------------------------------------------------------
// defs shape
// ---------------------------------------------------------------------------
describe("buildTools — defs", () => {
  it('always includes a "recall" def', () => {
    const { defs } = buildTools(makeSkills(), makeMemory());
    const recallDef = defs.find((d) => d.name === "recall");
    expect(recallDef).toBeDefined();
    expect(recallDef!.parameters).toMatchObject({
      type: "object",
      properties: { query: { type: "string" } },
      required: expect.arrayContaining(["query"]),
    });
  });

  it("includes a def for each available skill", () => {
    const { defs } = buildTools(makeSkills(), makeMemory());
    const echoDef = defs.find((d) => d.name === "echo");
    expect(echoDef).toBeDefined();
    expect(echoDef!.description).toContain("Echoes input");
  });

  it("skill def parameters include script and args", () => {
    const { defs } = buildTools(makeSkills(), makeMemory());
    const echoDef = defs.find((d) => d.name === "echo")!;
    expect(echoDef.parameters).toMatchObject({
      type: "object",
      properties: {
        script: { type: "string" },
        args: { type: "array" },
      },
      required: expect.arrayContaining(["script"]),
    });
  });

  it("enriches skill description with available scripts from loadSkill", () => {
    const { defs } = buildTools(makeSkills(), makeMemory());
    const echoDef = defs.find((d) => d.name === "echo")!;
    expect(echoDef.description).toContain("run.sh");
  });

  it('always includes a "remember_core" def', () => {
    const { defs } = buildTools(makeSkills(), makeMemory());
    const def = defs.find((d) => d.name === "remember_core");
    expect(def).toBeDefined();
    expect(def!.parameters).toMatchObject({
      type: "object",
      properties: { fact: { type: "string" } },
      required: expect.arrayContaining(["fact"]),
    });
  });

  it("returns recall + remember_core defs when skills is undefined", () => {
    const { defs } = buildTools(undefined, makeMemory());
    expect(defs.map((d) => d.name).sort()).toEqual(["recall", "remember_core"]);
  });

  it("returns recall + remember_core defs when skills is null", () => {
    const { defs } = buildTools(null, makeMemory());
    expect(defs.map((d) => d.name).sort()).toEqual(["recall", "remember_core"]);
  });
});

// ---------------------------------------------------------------------------
// dispatch — remember_core
// ---------------------------------------------------------------------------
describe("dispatch — remember_core", () => {
  it("calls memory.addCoreFact with the fact and returns ok:true when added", async () => {
    const memory = makeMemory();
    const { dispatch } = buildTools(makeSkills(), memory);

    const result = await dispatch("remember_core", { fact: "User is based in Dubai" });

    expect(memory.addCoreFact).toHaveBeenCalledWith("User is based in Dubai");
    expect(result.ok).toBe(true);
    expect(result.output.toLowerCase()).toContain("core memory");
  });

  it("reports a no-op (still ok:true) when the fact is a duplicate", async () => {
    const memory = makeMemory();
    memory.addCoreFact.mockReturnValueOnce({ added: false });
    const { dispatch } = buildTools(makeSkills(), memory);

    const result = await dispatch("remember_core", { fact: "dup" });

    expect(result.ok).toBe(true);
    expect(result.output.toLowerCase()).toContain("already");
  });

  it("returns ok:false for a missing/blank fact and does not call addCoreFact", async () => {
    const memory = makeMemory();
    const { dispatch } = buildTools(makeSkills(), memory);

    const result = await dispatch("remember_core", {});

    expect(result.ok).toBe(false);
    expect(memory.addCoreFact).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// dispatch — recall
// ---------------------------------------------------------------------------
describe("dispatch — recall", () => {
  it("calls memory.recall with the query and returns ok:true", async () => {
    const memory = makeMemory();
    const { dispatch } = buildTools(makeSkills(), memory);

    const result = await dispatch("recall", { query: "x" });

    expect(memory.recall).toHaveBeenCalledWith("x");
    expect(result).toEqual({ ok: true, output: "recalled: x" });
  });

  it("handles missing query gracefully (coerces to empty string)", async () => {
    const memory = makeMemory();
    const { dispatch } = buildTools(makeSkills(), memory);

    const result = await dispatch("recall", {});
    expect(result.ok).toBe(true);
    expect(memory.recall).toHaveBeenCalledWith("");
  });
});

// ---------------------------------------------------------------------------
// dispatch — skill
// ---------------------------------------------------------------------------
describe("dispatch — skill execution", () => {
  it("calls executeScript with (skillName, script, args) and returns ok:true + stdout", async () => {
    const skills = makeSkills();
    const { dispatch } = buildTools(skills, makeMemory());

    const result = await dispatch("echo", { script: "run.sh", args: ["a"] });

    expect(skills.executeScript).toHaveBeenCalledWith("echo", "run.sh", ["a"]);
    expect(result).toEqual({ ok: true, output: "hello" });
  });

  it("defaults args to [] when not provided", async () => {
    const skills = makeSkills();
    const { dispatch } = buildTools(skills, makeMemory());

    await dispatch("echo", { script: "run.sh" });

    expect(skills.executeScript).toHaveBeenCalledWith("echo", "run.sh", []);
  });

  it("returns ok:false and stderr when executeScript reports failure", async () => {
    const skills = makeSkills();
    skills.executeScript.mockResolvedValueOnce({
      success: false,
      stdout: "",
      stderr: "oops",
    });
    const { dispatch } = buildTools(skills, makeMemory());

    const result = await dispatch("echo", { script: "run.sh", args: [] });

    expect(result).toEqual({ ok: false, output: "oops" });
  });

  it("returns ok:false and stdout when executeScript fails with no stderr", async () => {
    const skills = makeSkills();
    skills.executeScript.mockResolvedValueOnce({
      success: false,
      stdout: "some stdout",
      stderr: "",
    });
    const { dispatch } = buildTools(skills, makeMemory());

    const result = await dispatch("echo", { script: "run.sh", args: [] });
    expect(result).toEqual({ ok: false, output: "some stdout" });
  });
});

// ---------------------------------------------------------------------------
// dispatch — unknown / null-skills error paths (never throws)
// ---------------------------------------------------------------------------
describe("dispatch — non-throwing error paths", () => {
  it("returns ok:false for unknown tool when skills is null", async () => {
    const { dispatch } = buildTools(null, makeMemory());

    const result = await dispatch("nonexistent", { script: "x" });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("nonexistent");
  });

  it("does NOT throw when skills is null and dispatch is called with a skill name", async () => {
    const { dispatch } = buildTools(null, makeMemory());

    await expect(dispatch("nonexistent", { script: "x" })).resolves.not.toThrow();
  });

  it("does NOT throw when executeScript itself throws", async () => {
    const skills = makeSkills();
    skills.executeScript.mockRejectedValueOnce(new Error("boom"));
    const { dispatch } = buildTools(skills, makeMemory());

    const result = await dispatch("echo", { script: "run.sh", args: [] });

    expect(result.ok).toBe(false);
    expect(result.output).toContain("boom");
  });
});
