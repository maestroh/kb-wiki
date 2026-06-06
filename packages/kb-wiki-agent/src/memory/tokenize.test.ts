/**
 * tokenize.test.ts — unit tests for the shared keyword tokenizer.
 */

import { describe, it, expect } from "vitest";
import { tokenize } from "./tokenize.js";

describe("tokenize", () => {
  it("splits on punctuation and spaces", () => {
    expect(tokenize("hello, world! foo")).toEqual(["hello", "world", "foo"]);
  });

  it("lowercases all tokens", () => {
    expect(tokenize("TypeScript Compiler")).toEqual(["typescript", "compiler"]);
  });

  it("drops tokens with length <= 2 (sub-3-char stopword guard)", () => {
    // "a" (1), "of" (2), "is" (2), "to" (2) — all dropped; filter is t.length > 2
    expect(tokenize("a of is to")).toEqual([]);
    // "the" (3), "big" (3), "cat" (3) — all kept
    expect(tokenize("the big cat")).toEqual(["the", "big", "cat"]);
  });

  it("drops empty strings produced by leading/trailing/multiple separators", () => {
    expect(tokenize("...foo---bar...")).toEqual(["foo", "bar"]);
  });
});
