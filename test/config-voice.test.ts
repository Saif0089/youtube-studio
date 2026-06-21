import { describe, it, expect } from "vitest";
import { loadVoiceConfig } from "../src/config.js";

describe("loadVoiceConfig", () => {
  it("returns voice keys when present", () => {
    expect(loadVoiceConfig({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v" }))
      .toEqual({ apiKey: "k", voiceId: "v" });
  });
  it("throws listing missing voice keys", () => {
    expect(() => loadVoiceConfig({})).toThrow(/ELEVENLABS_API_KEY.*ELEVENLABS_VOICE_ID/s);
  });
});
