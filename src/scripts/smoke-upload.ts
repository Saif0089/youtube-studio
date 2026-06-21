import "dotenv/config";
import { loadConfig } from "../config.js";
import { getAuthorizedClient } from "../youtube/auth.js";
import { uploadVideo } from "../youtube/uploader.js";

const videoPath = process.argv[2];
if (!videoPath) { console.error("Usage: npm run smoke-upload -- <path-to-test.mp4> [path-to-thumb.png]"); process.exit(1); }
const thumbnailPath = process.argv[3];

const publishAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +24h
const auth = getAuthorizedClient(loadConfig());
const id = await uploadVideo(auth, {
  videoPath, thumbnailPath,
  title: `Smoke test ${new Date().toISOString()}`,
  description: "Automated smoke test upload. Safe to delete.",
  tags: ["test"], publishAt,
});
console.log(`✅ Uploaded videoId=${id}\n   scheduled for ${publishAt}\n   https://studio.youtube.com/video/${id}/edit`);
