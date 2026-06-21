import "dotenv/config";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { getAuthorizedClient } from "../youtube/auth.js";
import { uploadVideo } from "../youtube/uploader.js";

const story = JSON.parse(await readFile("out/story.json", "utf8"));
const publishAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // +2h, stays private until then
const id = await uploadVideo(getAuthorizedClient(loadConfig()), {
  videoPath: "out/story.mp4",
  title: story.title,
  description: story.description,
  tags: story.tags,
  publishAt,
});
console.log(`✅ Uploaded videoId=${id}`);
console.log(`   scheduled ${publishAt}`);
console.log(`   https://studio.youtube.com/video/${id}/edit`);
