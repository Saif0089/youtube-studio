import { readFile, mkdir, copyFile } from "node:fs/promises";
import { normalizeImage } from "../lib/normalize-image.js";

// Free, keyless image generation via Pollinations.ai (FLUX schnell). Keep the style string SHORT —
// a bloated style string fights the model and wrecks figure proportions. enhance=true does the heavy lifting.
const STYLE = ", simple clean colorful cartoon doodle illustration, expressive, soft flat background, no text";

const story = JSON.parse(await readFile("out/story.json", "utf8"));
const prompts: string[] = story.imagePrompts;
await mkdir("out", { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const portrait = process.env.ORIENT === "portrait";
const reqW = portrait ? 576 : 1024;
const reqH = portrait ? 1024 : 576;
async function gen(prompt: string, seed: number): Promise<Buffer | null> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + STYLE)}?width=${reqW}&height=${reqH}&model=flux&enhance=true&nologo=true&seed=${seed}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

let lastGood: string | null = null;
for (let i = 0; i < prompts.length; i++) {
  let buf: Buffer | null = null;
  for (let a = 0; a < 3 && !buf; a++) { buf = await gen(prompts[i], i + 1); if (!buf) await sleep(2500); }
  const out = `out/scene-${i + 1}.jpg`;
  if (buf) { await normalizeImage(buf, out); lastGood = out; }
  else if (lastGood) { await copyFile(lastGood, out); console.log(`scene-${i + 1}: reused previous (gen failed)`); }
  else { console.error(`scene-${i + 1} FAILED with no fallback`); process.exit(1); }
  if ((i + 1) % 20 === 0) console.log(`  …${i + 1}/${prompts.length} drawings`);
  await sleep(400);
}
console.log(`✅ all ${prompts.length} drawings generated (Pollinations)`);
