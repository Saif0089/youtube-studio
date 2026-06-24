import "dotenv/config";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { getAuthorizedClient } from "../youtube/auth.js";
import { uploadVideo, type UploadOptions } from "../youtube/uploader.js";

const story = JSON.parse(await readFile("out/story.json", "utf8"));
const mode = (process.env.PUBLISH_MODE || "approval").toLowerCase();
const title = (/#short/i.test(story.title) ? story.title : `${story.title} #shorts`).slice(0, 100);

const opts: UploadOptions = { videoPath: "out/short.mp4", title, description: story.description, tags: story.tags };
if (mode === "auto") opts.publishAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

const id = await uploadVideo(getAuthorizedClient(loadConfig()), opts);
const reviewUrl = `https://studio.youtube.com/video/${id}/edit`;
console.log(`✅ Short uploaded videoId=${id} — ${mode === "auto" ? "scheduled PUBLIC" : "PRIVATE, awaiting review"}`);
console.log(`   Review & publish: ${reviewUrl}`);

const hook = process.env.DISCORD_WEBHOOK;
if (hook && mode !== "auto") {
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `📱 **New Short ready for review**\n**${story.title}**\n▶️ Review & publish: <${reviewUrl}>` }),
    });
  } catch {
    /* non-fatal */
  }
}
