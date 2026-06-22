import "dotenv/config";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";

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

const done = new Array(prompts.length).fill(false);
let next = 0, completed = 0;
async function worker() {
  while (true) {
    const i = next++;
    if (i >= prompts.length) break;
    let buf: Buffer | null = null;
    for (let a = 0; a < 3 && !buf; a++) { buf = await genOne(prompts[i]); if (!buf) await sleep(2000); }
    if (buf) { await writeFile(`out/scene-${i + 1}.jpg`, buf); done[i] = true; }
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
