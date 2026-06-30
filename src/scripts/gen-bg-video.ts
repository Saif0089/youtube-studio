import "dotenv/config";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { splitForVisuals, words as countWords } from "../lib/sentences.js";
import { generate } from "../lib/llm.js";
import { searchVideo, downloadVideo } from "../lib/stock.js";

// Groups the script into ~8s beats, asks for ONE stock-VIDEO search query per beat, then
// downloads a clip per beat (Pexels -> Pixabay). Writes out/clip-N.mp4 + out/beats.json.
await mkdir("out", { recursive: true });
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const TARGET_BEAT_WORDS = Number(process.env.BEAT_WORDS || 20); // ~8s of speech per clip

// group visual units into beats of ~TARGET_BEAT_WORDS words
const units = splitForVisuals(story.script);
const beats: { text: string; words: number }[] = [];
let cur: string[] = [], cw = 0;
for (const u of units) {
  cur.push(u); cw += countWords(u);
  if (cw >= TARGET_BEAT_WORDS) { beats.push({ text: cur.join(" "), words: cw }); cur = []; cw = 0; }
}
if (cur.length) {
  if (beats.length) { beats[beats.length - 1].text += " " + cur.join(" "); beats[beats.length - 1].words += cw; }
  else beats.push({ text: cur.join(" "), words: cw });
}

// one concrete stock-VIDEO search query per beat (batched)
const schema = { type: "object", properties: { queries: { type: "array", items: { type: "string" } } }, required: ["queries"] };
const queries: string[] = [];
const BATCH = 30;
for (let i = 0; i < beats.length; i += BATCH) {
  const batch = beats.slice(i, i + BATCH);
  const numbered = batch.map((b, j) => `${j + 1}. ${b.text}`).join("\n");
  const bp = `Below are numbered beats (in order) from a money & behavior psychology video. For EACH beat write ONE concrete 2-4 word STOCK-VIDEO search query for real B-ROLL FOOTAGE that visually matches it — people, places, hands, objects, city life, nature, work, shopping (e.g. "person counting cash", "busy city commute", "hands typing laptop", "ocean waves aerial", "shopping mall crowd", "coffee shop morning"). Prefer footage with natural motion. Avoid abstract words (psychology, behavior), text, charts, logos, brands.
Return JSON {"queries":[...]} with EXACTLY ${batch.length} queries, in order.

Beats:
${numbered}`;
  const out = JSON.parse(await generate(bp, schema));
  let arr: string[] = Array.isArray(out.queries) ? out.queries.map((x: any) => String(x).trim()).filter(Boolean) : [];
  while (arr.length < batch.length) arr.push(batch[arr.length].text.split(/\s+/).slice(0, 3).join(" "));
  if (arr.length > batch.length) arr = arr.slice(0, batch.length);
  queries.push(...arr);
  console.log(`  queries ${Math.min(i + BATCH, beats.length)}/${beats.length}`);
}

// download one clip per beat; reuse previous on a miss so a run never fails
const used = new Set<string>();
let lastGood: string | null = null;
for (let i = 0; i < queries.length; i++) {
  const out = `out/clip-${i + 1}.mp4`;
  const c = await searchVideo(queries[i], used, i);
  if (c) {
    try {
      await writeFile(out, await downloadVideo(c));
      lastGood = out;
      console.log(`  clip-${i + 1}/${queries.length} ✓ [${c.src}] ${queries[i]}`);
      continue;
    } catch (e) { console.error(`  clip-${i + 1} download failed: ${e}`); }
  }
  if (lastGood) { await copyFile(lastGood, out); console.log(`  clip-${i + 1}: reused previous (no match for "${queries[i]}")`); continue; }
  const generic = await searchVideo("calm nature landscape", used, i);
  if (generic) { await writeFile(out, await downloadVideo(generic)); lastGood = out; console.log(`  clip-${i + 1}: generic fallback`); }
  else { console.error(`clip-${i + 1} FAILED with no fallback`); process.exit(1); }
}

await writeFile("out/beats.json", JSON.stringify(beats.map((b, i) => ({ words: b.words, query: queries[i] })), null, 1));
console.log(`✅ ${queries.length} stock video clips`);
