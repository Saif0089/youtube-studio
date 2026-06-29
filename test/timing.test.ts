import { describe, it, expect } from "vitest";
import { alignByWordCount, buildCaptionLines, type Word } from "../src/lib/timing.js";

const W = (w: string, start: number, end: number): Word => ({ w, start, end });

describe("alignByWordCount", () => {
  it("starts each unit at its first word and ends at the next unit's start", () => {
    const words = [W("a", 0, 1), W("b", 1, 2), W("c", 2, 3), W("d", 3, 4)];
    const segs = alignByWordCount([2, 2], words, 4);
    expect(segs).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });
  it("last unit ends at narrationDur", () => {
    const words = [W("a", 0, 1), W("b", 1, 2), W("c", 2, 3)];
    const segs = alignByWordCount([1, 2], words, 3.5);
    expect(segs[1]).toEqual({ start: 1, end: 3.5 });
  });
  it("clamps a unit start index past the end of the word list", () => {
    const words = [W("a", 0, 1), W("b", 1, 2)];
    const segs = alignByWordCount([1, 1, 5], words, 2); // 3rd unit's count overruns
    expect(segs.length).toBe(3);
    expect(segs[2].start).toBe(words[words.length - 1].start);
  });
});

describe("buildCaptionLines", () => {
  it("flushes at maxWords", () => {
    const words = [W("one", 0, 1), W("two", 1, 2), W("three", 2, 3), W("four", 3, 4), W("five", 4, 5)];
    const lines = buildCaptionLines(words, 2);
    expect(lines.map((l) => l.words.map((w) => w.text).join(" "))).toEqual(["one two", "three four", "five"]);
    expect(lines[0]).toMatchObject({ start: 0, end: 2 });
  });
  it("flushes at sentence-ending punctuation", () => {
    const words = [W("hello.", 0, 1), W("next", 1, 2), W("word", 2, 3)];
    const lines = buildCaptionLines(words, 9);
    expect(lines[0].words.map((w) => w.text)).toEqual(["hello."]);
  });
});
