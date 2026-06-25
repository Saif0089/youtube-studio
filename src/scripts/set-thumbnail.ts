import "dotenv/config";
import { google } from "googleapis";
import { createReadStream } from "node:fs";
import { loadConfig } from "../config.js";
import { getAuthorizedClient } from "../youtube/auth.js";

// Set a custom thumbnail on an existing video: VIDEO_ID=<id> THUMB_PATH=out/thumbnail.jpg
const videoId = process.env.VIDEO_ID;
const path = process.env.THUMB_PATH || "out/thumbnail.jpg";
if (!videoId) { console.error("VIDEO_ID env required"); process.exit(1); }

const yt = google.youtube({ version: "v3", auth: getAuthorizedClient(loadConfig()) });
await yt.thumbnails.set({ videoId, media: { body: createReadStream(path) } });
console.log(`✅ custom thumbnail set on https://youtu.be/${videoId}`);
