import { readFile, writeFile, mkdir } from "node:fs/promises";

const STYLE =
  ", cinematic widescreen, photorealistic, highly detailed, atmospheric, muted desaturated teal-grey palette, soft dramatic lighting, volumetric fog, film grain, eerie and haunting, no people, no text, no watermark";

const story = JSON.parse(await readFile("out/story.json", "utf8"));
const prompts: string[] = story.imagePrompts;
await mkdir("out", { recursive: true });

for (let i = 0; i < prompts.length; i++) {
  const enc = encodeURIComponent(prompts[i] + STYLE);
  const url = `https://image.pollinations.ai/prompt/${enc}?width=1280&height=720&model=flux&nologo=true&seed=${101 + i}`;
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 5000) {
          await writeFile(`out/scene-${i + 1}.jpg`, buf);
          console.log(`scene-${i + 1}: ${buf.length} bytes`);
          ok = true;
          break;
        }
      }
      console.log(`scene-${i + 1} retry ${attempt + 1} (status ${res.status})`);
    } catch (e) {
      console.log(`scene-${i + 1} retry ${attempt + 1} (error)`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  if (!ok) { console.error(`scene-${i + 1} FAILED`); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1500)); // gentle throttle
}
console.log("✅ all scenes generated");
