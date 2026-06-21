import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { Config } from "../config.js";

export function getAuthorizedClient(cfg: Config): OAuth2Client {
  const client = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
  client.setCredentials({ refresh_token: cfg.refreshToken });
  return client as OAuth2Client;
}
