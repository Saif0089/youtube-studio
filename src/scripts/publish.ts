import "dotenv/config";
import { readFile, appendFile } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { getAuthorizedClient } from "../youtube/auth.js";
import { uploadVideo, type UploadOptions } from "../youtube/uploader.js";

const story = JSON.parse(await readFile("out/story.json", "utf8"));
// approval = upload PRIVATE for your review (default); auto = schedule public ~2h out
const mode = (process.env.PUBLISH_MODE || "approval").toLowerCase();

const opts: UploadOptions = {
  videoPath: "out/story.mp4",
  title: story.title,
  description: story.description,
  tags: story.tags,
};
if (mode === "auto") opts.publishAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

const id = await uploadVideo(getAuthorizedClient(loadConfig()), opts);
const reviewUrl = `https://studio.youtube.com/video/${id}/edit`;
const previewUrl = `https://youtu.be/${id}`;

if (mode === "auto") {
  console.log(`✅ Uploaded videoId=${id} — scheduled to go PUBLIC at ${opts.publishAt}`);
} else {
  console.log(`✅ Uploaded videoId=${id} — PRIVATE, awaiting your approval`);
}
console.log(`   Review & publish: ${reviewUrl}`);
console.log(`   Preview:          ${previewUrl}`);

// Discord push notification (if configured) — pings your phone with the review link
const hook = process.env.DISCORD_WEBHOOK;
if (hook && mode !== "auto") {
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `🎬 **New video ready for review**\n**${story.title}**\n▶️ Review & publish: <${reviewUrl}>\n👀 Preview: ${previewUrl}`,
      }),
    });
    console.log("   Discord notified");
  } catch {
    console.log("   (Discord notify failed — non-fatal)");
  }
}

// In GitHub Actions, surface the link on the run page (you get an email on run completion)
const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  await appendFile(
    summaryFile,
    `\n## 🎬 New video ready for review\n**${story.title}**\n\n- **Review & publish:** ${reviewUrl}\n- Preview: ${previewUrl}\n- Mode: \`${mode}\`\n`,
  );
}
