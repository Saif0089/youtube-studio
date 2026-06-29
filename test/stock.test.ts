import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parsePexels, parsePixabay, pickCandidate, searchPhoto, type Candidate } from "../src/lib/stock.js";

describe("parsePexels", () => {
  it("maps photos to candidates and drops urlless entries", () => {
    const j = { photos: [{ id: 1, src: { large2x: "u1" } }, { id: 2, src: {} }] };
    expect(parsePexels(j)).toEqual([{ id: "px-1", url: "u1", src: "pexels" }]);
  });
});

describe("parsePixabay", () => {
  it("maps hits to candidates", () => {
    const j = { hits: [{ id: 9, largeImageURL: "u9" }] };
    expect(parsePixabay(j)).toEqual([{ id: "pb-9", url: "u9", src: "pixabay" }]);
  });
});

describe("pickCandidate", () => {
  const c = (id: string): Candidate => ({ id, url: id, src: "pexels" });
  it("skips excluded ids", () => {
    const got = pickCandidate([c("a"), c("b")], new Set(["a"]), 0);
    expect(got?.id).toBe("b");
  });
  it("rotates the start index by seed", () => {
    expect(pickCandidate([c("a"), c("b"), c("c")], new Set(), 1)?.id).toBe("b");
  });
  it("returns null when all excluded", () => {
    expect(pickCandidate([c("a")], new Set(["a"]), 0)).toBeNull();
  });
});

describe("searchPhoto fallback", () => {
  beforeEach(() => { process.env.PEXELS_API_KEY = "PX"; process.env.PIXABAY_API_KEY = "PB"; });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("falls back to Pixabay when Pexels returns nothing, and excludes the pick", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.includes("pexels.com") ? { photos: [] } : { hits: [{ id: 7, largeImageURL: "u7" }] };
      return { ok: true, json: async () => body } as any;
    }));
    const exclude = new Set<string>();
    const got = await searchPhoto("money", exclude, 0);
    expect(got).toEqual({ id: "pb-7", url: "u7", src: "pixabay" });
    expect(exclude.has("pb-7")).toBe(true);
  });
});
