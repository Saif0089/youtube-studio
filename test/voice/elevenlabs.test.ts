import { describe, it, expect, vi, beforeEach } from "vitest";
import { synthesizeChunk } from "../../src/voice/elevenlabs.js";

const cfg = { apiKey: "KEY", voiceId: "VOICE" };

beforeEach(() => vi.unstubAllGlobals());

describe("synthesizeChunk", () => {
  it("POSTs to the voice endpoint with the api key and returns mp3 bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const buf = await synthesizeChunk(cfg, "hello");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf).toEqual(Buffer.from([1, 2, 3]));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/VOICE");
    expect(init.method).toBe("POST");
    expect(init.headers["xi-api-key"]).toBe("KEY");
    expect(JSON.parse(init.body).text).toBe("hello");
  });

  it("throws with the status on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad" }));
    await expect(synthesizeChunk(cfg, "x")).rejects.toThrow(/422/);
  });
});
