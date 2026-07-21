import { readFile, mkdir, copyFile } from "node:fs/promises";
import { normalizeImage } from "../lib/normalize-image.js";
import { ensureServer, generateImage } from "../lib/comfy.js";

// Photoreal image provider: renders each scene prompt with local ComfyUI / RealVisXL.
// gen-script (in "photo" mode) writes a small set of cinematic scene descriptions to
// story.imagePrompts; here we wrap each in a photographic style + negative and render it.

const STYLE = process.env.PHOTO_STYLE
  || "RAW photo, {p}, cinematic lighting, 50mm, shallow depth of field, photorealistic, highly detailed, smooth natural skin, sharp focus";
const NEG = process.env.PHOTO_NEG
  || "cartoon, anime, 3d render, painting, illustration, plastic skin, waxy, deformed, blurry, low quality, watermark, text, signature, extra fingers, bad hands, mutated hands";

const story = JSON.parse(await readFile("out/story.json", "utf8"));
const prompts: string[] = story.imagePrompts;
await mkdir("out", { recursive: true });

const portrait = process.env.ORIENT === "portrait";
const W = portrait ? 768 : 1344; // SDXL-valid, ~9:16 / ~16:9 (normalizeImage finishes the exact crop)
const H = portrait ? 1344 : 768;

await ensureServer();

const t0 = Date.now();
let lastGood: string | null = null;
for (let i = 0; i < prompts.length; i++) {
  const full = STYLE.replace("{p}", prompts[i]);
  let buf: Buffer | null = null;
  for (let a = 0; a < 2 && !buf; a++) {
    try {
      buf = await generateImage({ prompt: full, negative: NEG, width: W, height: H, seed: i + 1 });
    } catch (e) {
      console.error(`scene-${i + 1} attempt ${a + 1} failed: ${e}`);
      buf = null;
    }
  }
  const out = `out/scene-${i + 1}.jpg`;
  if (buf) {
    await normalizeImage(buf, out);
    lastGood = out;
    console.log(`  scene-${i + 1}/${prompts.length} ✓ (${Math.round((Date.now() - t0) / 1000)}s elapsed)`);
  } else if (lastGood) {
    await copyFile(lastGood, out);
    console.log(`  scene-${i + 1}: reused previous (gen failed)`);
  } else {
    console.error(`scene-${i + 1} FAILED with no fallback`);
    process.exit(1);
  }
}
console.log(`✅ all ${prompts.length} photoreal images (RealVisXL) in ${Math.round((Date.now() - t0) / 1000)}s`);
