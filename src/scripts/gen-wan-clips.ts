import "dotenv/config";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { splitForVisuals, words as countWords } from "../lib/sentences.js";
import { generate } from "../lib/llm.js";
import { generateClip } from "../lib/wan.js";

// Storyboards the script into ~one cinematic shot per sentence-beat, then GENERATES each shot
// as a Wan 2.2 clip on-device (sequential — one gen saturates 18GB). Writes the same artifacts
// gen-bg-video does (clip-N.mp4, shots.json, beats.json) so prepare-video/compose-video reuse.
await mkdir("out", { recursive: true });
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const BEAT_WORDS = Number(process.env.WAN_BEAT_WORDS || 7);   // ~one Wan clip (2.6s) per beat

const units = splitForVisuals(story.script);
const beats: { text: string; words: number }[] = [];
let cur: string[] = [], cw = 0;
for (const u of units) {
  cur.push(u); cw += countWords(u);
  if (cw >= BEAT_WORDS) { beats.push({ text: cur.join(" "), words: cw }); cur = []; cw = 0; }
}
if (cur.length) {
  if (beats.length) { beats[beats.length - 1].text += " " + cur.join(" "); beats[beats.length - 1].words += cw; }
  else beats.push({ text: cur.join(" "), words: cw });
}

// one cinematic scene prompt per beat
const schema = {
  type: "object",
  properties: { prompts: { type: "array", items: { type: "string" } } },
  required: ["prompts"],
};
const numbered = beats.map((b, j) => `${j + 1}. ${b.text}`).join("\n");
const sbPrompt = `Below are numbered narration beats from a cinematic nature video. For EACH beat, write ONE vivid text-to-video prompt describing the exact cinematic shot to show while it's heard.
- Name the concrete subject + action + setting + camera move ("a snow leopard leaping between rocky cliffs at dusk, slow-motion tracking shot, alpine mist").
- Real, filmable scenes only. No text/logos/charts. Modest and family-friendly.
- 15-30 words each, richly visual (lighting, motion, detail).
Return JSON {"prompts":[...]} with EXACTLY ${beats.length} entries, in beat order.

Beats:
${numbered}`;
const out = JSON.parse(await generate(sbPrompt, schema));
let prompts: string[] = Array.isArray(out.prompts) ? out.prompts.map((p: any) => String(p).trim()).filter(Boolean) : [];
while (prompts.length < beats.length) prompts.push(beats[prompts.length].text);
prompts = prompts.slice(0, beats.length);

console.log(`Generating ${beats.length} Wan clips (sequential, on-device)…`);
const shotMeta: { beat: number; type: "footage" | "graphic"; text: string }[] = [];
let lastGood: string | null = null;
const t0 = Date.now();
for (let i = 0; i < prompts.length; i++) {
  const outMp4 = `out/clip-${i + 1}.mp4`;
  const started = Date.now();
  let ok = await generateClip(prompts[i], outMp4);
  if (!ok) { console.log(`  clip-${i + 1} retry…`); ok = await generateClip(prompts[i], outMp4); }
  const secs = Math.round((Date.now() - started) / 1000);
  if (ok) {
    lastGood = outMp4;
    shotMeta.push({ beat: i, type: "footage", text: "" });
    const elapsed = Math.round((Date.now() - t0) / 60000);
    const eta = Math.round((secs * (prompts.length - i - 1)) / 60);
    console.log(`  clip-${i + 1}/${prompts.length} ✓ ${secs}s | elapsed ${elapsed}m, ~${eta}m left | "${prompts[i].slice(0, 55)}"`);
  } else if (lastGood) {
    await copyFile(lastGood, outMp4);
    shotMeta.push({ beat: i, type: "footage", text: "" });
    console.log(`  clip-${i + 1}/${prompts.length} ✗ gen failed — reused previous`);
  } else {
    console.error(`  clip-${i + 1} failed with no fallback`); process.exit(1);
  }
}

await writeFile("out/beats.json", JSON.stringify(beats.map((b) => ({ words: b.words })), null, 1));
await writeFile("out/shots.json", JSON.stringify(shotMeta, null, 1));
console.log(`✅ ${prompts.length} Wan clips in ${Math.round((Date.now() - t0) / 60000)}m`);
