import "dotenv/config";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";

const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!acct || !token) { console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env"); process.exit(1); }

const MODEL = process.env.CF_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";
const STEPS = Number(process.env.CF_STEPS || 4);
const STYLE =
  ", simple black stick figure doodle, hand-drawn thick black marker lines on a plain solid white background, minimalist whiteboard explainer cartoon, lots of empty white space, centered, no text, no letters, no words, no numbers, no color, clean line art";

const story = JSON.parse(await readFile("out/story.json", "utf8"));
const prompts: string[] = story.imagePrompts;
await mkdir("out", { recursive: true });

let lastGood: string | null = null;
for (let i = 0; i < prompts.length; i++) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${MODEL}`;
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompts[i] + STYLE, steps: STEPS, width: 1280, height: 720 }),
      });
      if (res.ok) {
        const data: any = await res.json();
        const b64 = data?.result?.image;
        if (b64) {
          await writeFile(`out/scene-${i + 1}.jpg`, Buffer.from(b64, "base64"));
          console.log(`scene-${i + 1}: ok`);
          ok = true;
          break;
        }
        console.log(`scene-${i + 1} no image in response: ${JSON.stringify(data).slice(0, 200)}`);
      } else {
        console.log(`scene-${i + 1} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`scene-${i + 1} error (attempt ${attempt + 1})`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (ok) {
    lastGood = `out/scene-${i + 1}.jpg`;
  } else if (lastGood) {
    await copyFile(lastGood, `out/scene-${i + 1}.jpg`); // keep the video whole if one image fails (e.g. daily cap)
    console.log(`scene-${i + 1}: reused previous (generation failed)`);
  } else {
    console.error(`scene-${i + 1} FAILED with no fallback`);
    process.exit(1);
  }
  if ((i + 1) % 20 === 0) console.log(`  …${i + 1}/${prompts.length} drawings`);
  await new Promise((r) => setTimeout(r, 250)); // gentle pacing for large batches
}
console.log(`✅ all ${prompts.length} drawings generated (Cloudflare FLUX)`);
