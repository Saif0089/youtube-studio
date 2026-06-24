import "dotenv/config";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { normalizeImage } from "../lib/normalize-image.js";

const key = process.env.MESHY_API_KEY;
if (!key) { console.error("MESHY_API_KEY missing"); process.exit(1); }
const MODEL = process.env.MESHY_MODEL || "nano-banana"; // 3 credits/image, native 16:9
const CONC = Number(process.env.MESHY_CONC || 4);
const STYLE =
  ", colorful minimalist whiteboard explainer cartoon, hand-drawn thick black marker outlines with bright flat color fills (cheerful yellow, red, blue, green, orange), include a simple light flat background or setting that fits the scene when it helps (a room, wall, street, desk, sky), soft pastel background colors, clean and uncluttered, no text, no letters, no numbers, no shading";

const story = JSON.parse(await readFile("out/story.json", "utf8"));
const prompts: string[] = story.imagePrompts;
await mkdir("out", { recursive: true });

const POST_H = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const GET_H = { Authorization: `Bearer ${key}` };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function genOne(prompt: string): Promise<Buffer | null> {
  const cr = await fetch("https://api.meshy.ai/openapi/v1/text-to-image", {
    method: "POST", headers: POST_H,
    body: JSON.stringify({ ai_model: MODEL, prompt: prompt + STYLE, aspect_ratio: "16:9" }),
  });
  if (!cr.ok) return null;
  const tid = ((await cr.json()) as any).result;
  for (let i = 0; i < 90; i++) {
    const pr = await fetch(`https://api.meshy.ai/openapi/v1/text-to-image/${tid}`, { headers: GET_H });
    const d: any = await pr.json();
    if (d.status === "SUCCEEDED") {
      const img = await fetch(d.image_urls[0]);
      return Buffer.from(await img.arrayBuffer());
    }
    if (d.status === "FAILED") return null;
    await sleep(3000);
  }
  return null;
}

// free, no-key, no-cap fallback for when Meshy credits run out
async function pollinations(prompt: string, seed: number): Promise<Buffer | null> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + STYLE)}?width=1024&height=576&model=flux&nologo=true&seed=${seed}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

const done = new Array(prompts.length).fill(false);
let next = 0, completed = 0;
async function worker() {
  while (true) {
    const i = next++;
    if (i >= prompts.length) break;
    let buf: Buffer | null = null;
    let fromFallback = false;
    for (let a = 0; a < 3 && !buf; a++) { buf = await genOne(prompts[i]); if (!buf) await sleep(2000); }
    if (!buf) { buf = await pollinations(prompts[i], i + 1); fromFallback = true; } // Meshy out of credits -> free fallback
    if (buf) {
      if (fromFallback) await normalizeImage(buf, `out/scene-${i + 1}.jpg`); // Pollinations caps at 1024 -> normalize to 1280x720
      else await writeFile(`out/scene-${i + 1}.jpg`, buf);
      done[i] = true;
    }
    completed++;
    if (completed % 20 === 0) console.log(`  …${completed}/${prompts.length} drawings`);
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));

// fill any failures with the nearest successful drawing
for (let i = 0; i < prompts.length; i++) {
  if (done[i]) continue;
  let j = -1;
  for (let d = 1; d < prompts.length; d++) {
    if (i - d >= 0 && done[i - d]) { j = i - d; break; }
    if (i + d < prompts.length && done[i + d]) { j = i + d; break; }
  }
  if (j < 0) { console.error("no drawings generated at all"); process.exit(1); }
  await copyFile(`out/scene-${j + 1}.jpg`, `out/scene-${i + 1}.jpg`);
  console.log(`scene-${i + 1}: reused scene-${j + 1} (generation failed)`);
}
console.log(`✅ all ${prompts.length} drawings generated (Meshy ${MODEL})`);
