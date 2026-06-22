import "dotenv/config";
import { google } from "googleapis";
import { loadConfig } from "../config.js";
import { getAuthorizedClient } from "../youtube/auth.js";

const id = process.argv[2];
if (!id) { console.error("usage: tsx delete-video.ts <videoId>"); process.exit(1); }

const youtube = google.youtube({ version: "v3", auth: getAuthorizedClient(loadConfig()) });
await youtube.videos.delete({ id });
console.log(`🗑️  deleted ${id}`);
