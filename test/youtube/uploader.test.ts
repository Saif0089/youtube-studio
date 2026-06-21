import { describe, it, expect, vi, beforeEach } from "vitest";

const insert = vi.fn().mockResolvedValue({ data: { id: "VID123" } });
const setThumb = vi.fn().mockResolvedValue({});
vi.mock("googleapis", () => ({
  google: { youtube: vi.fn(() => ({ videos: { insert }, thumbnails: { set: setThumb } })) },
}));
vi.mock("node:fs", () => ({ createReadStream: vi.fn(() => "STREAM"), existsSync: vi.fn(() => true) }));

import { uploadVideo } from "../../src/youtube/uploader.js";

beforeEach(() => { insert.mockClear(); setThumb.mockClear(); });

const baseOpts = {
  videoPath: "/x/video.mp4", title: "T", description: "D", tags: ["a"],
  publishAt: "2026-07-01T15:00:00Z",
};

describe("uploadVideo", () => {
  it("inserts as private with publishAt, madeForKids=false, and returns videoId", async () => {
    const id = await uploadVideo({} as any, baseOpts as any);
    expect(id).toBe("VID123");
    const arg = insert.mock.calls[0][0];
    expect(arg.part).toContain("snippet");
    expect(arg.part).toContain("status");
    expect(arg.requestBody.status.privacyStatus).toBe("private");
    expect(arg.requestBody.status.publishAt).toBe("2026-07-01T15:00:00Z");
    expect(arg.requestBody.status.selfDeclaredMadeForKids).toBe(false);
    expect(arg.requestBody.snippet.title).toBe("T");
  });
  it("sets a custom thumbnail when provided", async () => {
    await uploadVideo({} as any, { ...baseOpts, thumbnailPath: "/x/thumb.png" } as any);
    expect(setThumb).toHaveBeenCalledWith(expect.objectContaining({ videoId: "VID123" }));
  });
  it("does not set a thumbnail when not provided", async () => {
    await uploadVideo({} as any, baseOpts as any);
    expect(setThumb).not.toHaveBeenCalled();
  });
  it("rejects when publishAt is an invalid date string", async () => {
    await expect(
      uploadVideo({} as any, { ...baseOpts, publishAt: "not-a-date" } as any),
    ).rejects.toThrow(/Invalid publishAt/);
  });
});
