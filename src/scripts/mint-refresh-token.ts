import "dotenv/config";
import { google } from "googleapis";
import http from "node:http";
import { exec } from "node:child_process";
import type { AddressInfo } from "node:net";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];

const clientId = process.env.YT_CLIENT_ID;
const clientSecret = process.env.YT_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set YT_CLIENT_ID and YT_CLIENT_SECRET in .env first (copy from .env.example).");
  process.exit(1);
}

// Loopback flow: Google "Desktop app" clients accept any http://localhost:<port> redirect.
// This replaces the deprecated out-of-band (copy/paste) flow that Google has blocked.
const server = http.createServer();
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://localhost:${port}`;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

  console.log("\nOpening your browser to approve YouTube access…");
  console.log("If it does not open, paste this URL into your browser manually:\n\n" + authUrl + "\n");
  console.log("(If you see an 'unverified app' warning, click Advanced -> Go to <app> — it is your own app.)\n");
  exec(`open "${authUrl}"`); // macOS auto-open; harmless if it fails since the URL is printed above.

  server.on("request", async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", redirectUri);
      const error = reqUrl.searchParams.get("error");
      const code = reqUrl.searchParams.get("code");

      if (error) {
        res.end(`Authorization failed: ${error}. You can close this tab.`);
        console.error("\nAuthorization error:", error);
        server.close();
        process.exit(1);
      }
      if (!code) {
        res.end("Waiting for authorization… you can close this tab.");
        return;
      }

      const { tokens } = await oauth2.getToken(code);
      res.setHeader("Content-Type", "text/html");
      res.end("<h2>✅ Done — close this tab and return to the terminal.</h2>");
      server.close();

      if (!tokens.refresh_token) {
        console.error(
          "\nNo refresh_token returned. Re-run the command and approve a FRESH consent " +
            "(the script already forces prompt=consent)."
        );
        process.exit(1);
      }
      console.log("\n✅ Success! Add this line to your .env (and later to GitHub Actions secrets):\n");
      console.log("YT_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
      process.exit(0);
    } catch (e) {
      res.end("Something went wrong; check the terminal.");
      console.error(e);
      server.close();
      process.exit(1);
    }
  });
});
