import { describe, it, expect, vi } from "vitest";

const setCredentials = vi.fn();
vi.mock("googleapis", () => ({
  google: { auth: { OAuth2: vi.fn().mockImplementation(() => ({ setCredentials })) } },
}));

import { getAuthorizedClient } from "../../src/youtube/auth.js";
import { google } from "googleapis";

describe("getAuthorizedClient", () => {
  it("constructs OAuth2 with client id/secret and sets the refresh token", () => {
    getAuthorizedClient({ clientId: "id", clientSecret: "secret", refreshToken: "rt" });
    expect((google.auth.OAuth2 as any)).toHaveBeenCalledWith("id", "secret");
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: "rt" });
  });
});
