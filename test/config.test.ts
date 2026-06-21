import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("returns the three secrets when all present", () => {
    const cfg = loadConfig({ YT_CLIENT_ID: "a", YT_CLIENT_SECRET: "b", YT_REFRESH_TOKEN: "c" });
    expect(cfg).toEqual({ clientId: "a", clientSecret: "b", refreshToken: "c" });
  });
  it("throws listing all missing keys", () => {
    expect(() => loadConfig({})).toThrow(/YT_CLIENT_ID.*YT_CLIENT_SECRET.*YT_REFRESH_TOKEN/s);
  });
});
