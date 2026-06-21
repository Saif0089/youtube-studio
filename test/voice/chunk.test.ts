import { describe, it, expect } from "vitest";
import { chunkText } from "../../src/voice/chunk.js";

describe("chunkText", () => {
  it("returns one chunk when text is short", () => {
    expect(chunkText("Hello world.", 100)).toEqual(["Hello world."]);
  });
  it("splits on sentence boundaries within the limit", () => {
    const out = chunkText("Aaaa. Bbbb. Cccc.", 11);
    expect(out.every((c) => c.length <= 11)).toBe(true);
    expect(out.join(" ")).toContain("Aaaa.");
    expect(out.length).toBeGreaterThan(1);
  });
  it("never emits empty chunks", () => {
    expect(chunkText("\n\n  \n", 50)).toEqual([]);
  });
  it("hard-wraps a single over-long sentence at word boundaries", () => {
    const out = chunkText("one two three four five", 9);
    expect(out.every((c) => c.length <= 9)).toBe(true);
    expect(out.join(" ").split(/\s+/)).toEqual(["one", "two", "three", "four", "five"]);
  });
});
