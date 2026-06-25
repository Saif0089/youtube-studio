import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { normalizeImage } from "../lib/normalize-image.js";

// One-off: build a 1280x720 thumbnail hero + props for a given title.
// THUMB_TITLE = big punchy thumbnail text; THUMB_PROMPT = hero doodle description.
const title = process.env.THUMB_TITLE || "Why You Feel Broke";
const heroPrompt =
  process.env.THUMB_PROMPT ||
  "a stressed stick figure holding an empty wallet turned upside down, coins and dollar bills flying away into the air, worried face";
const STYLE = ", simple clean colorful cartoon doodle illustration, expressive, soft flat background, no text";
const seed = Number(process.env.THUMB_SEED || 7);

await mkdir("public", { recursive: true });
await mkdir("out", { recursive: true });

const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(heroPrompt + STYLE)}?width=1024&height=576&model=flux&nologo=true&seed=${seed}`;
let buf: Buffer | null = null;
for (let a = 0; a < 5 && !buf; a++) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (r.ok) buf = Buffer.from(await r.arrayBuffer());
  } catch {
    /* retry */
  }
  if (!buf) await new Promise((s) => setTimeout(s, 2500));
}
if (!buf) { console.error("hero image generation failed"); process.exit(1); }

await normalizeImage(buf, "public/scene-1.jpg"); // landscape -> 1280x720
await writeFile("out/props.json", JSON.stringify({ images: ["scene-1.jpg"], title }, null, 1));
console.log(`✅ hero + props ready (title: "${title}")`);
