import "dotenv/config";
import { google } from "googleapis";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube"];

const clientId = process.env.YT_CLIENT_ID, clientSecret = process.env.YT_CLIENT_SECRET;
if (!clientId || !clientSecret) { console.error("Set YT_CLIENT_ID and YT_CLIENT_SECRET in .env first."); process.exit(1); }

// "Desktop app" clients support the OOB/loopback flow; we use manual copy/paste of the code.
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");
const url = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

console.log("\n1) Open this URL, approve, and copy the code:\n\n" + url + "\n");
const rl = readline.createInterface({ input, output });
const code = (await rl.question("2) Paste the code here: ")).trim();
await rl.close();

const { tokens } = await oauth2.getToken(code);
if (!tokens.refresh_token) { console.error("No refresh_token returned. Re-run; ensure prompt=consent and a fresh grant."); process.exit(1); }
console.log("\n✅ YT_REFRESH_TOKEN=" + tokens.refresh_token + "\n\nPaste this into .env and (later) GitHub Actions secrets.");
