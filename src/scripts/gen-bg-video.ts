import "dotenv/config";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { splitForVisuals, words as countWords } from "../lib/sentences.js";
import { generate } from "../lib/llm.js";
import { searchVideoScored, downloadVideo } from "../lib/stock.js";

// Groups the script into ~8s beats, asks for TWO candidate stock-video queries per beat
// (a literal-specific one + a simpler backup), then picks the clip whose OWN description
// best matches the beat (relevance-scored) — not a lucky-dip top result.
await mkdir("out", { recursive: true });
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const TARGET_BEAT_WORDS = Number(process.env.BEAT_WORDS || 22);

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

// two candidate queries per beat (batched)
const schema = {
  type: "object",
  properties: { pairs: { type: "array", items: { type: "object", properties: { q1: { type: "string" }, q2: { type: "string" } }, required: ["q1", "q2"] } } },
  required: ["pairs"],
};
const pairs: { q1: string; q2: string }[] = [];
const BATCH = 30;
for (let i = 0; i < beats.length; i += BATCH) {
  const batch = beats.slice(i, i + BATCH);
  const numbered = batch.map((b, j) => `${j + 1}. ${b.text}`).join("\n");
  const bp = `Below are numbered narration beats (in order) from a money-psychology video. For EACH beat give TWO stock-footage search queries that visually match WHAT THE WORDS SAY:
- "q1": a LITERAL, specific 3-5 word query naming the exact subject/action/object in the beat (if the beat mentions selling a phone -> "person selling smartphone online"; a coffee mug experiment -> "coffee mug on desk"; an insulting low offer -> "person frowning at phone").
- "q2": a simpler 2-3 word backup for the same idea ("smartphone cash", "coffee mug", "frustrated phone").
Match the beat's CONCRETE NOUNS AND ACTIONS — never write mood-only queries ("thinking person", "city life") unless the beat truly has no concrete subject. Avoid abstract words (psychology, behavior), text, charts, logos, brands.
Return JSON {"pairs":[{"q1":"...","q2":"..."}, ...]} with EXACTLY ${batch.length} pairs, in order.

Beats:
${numbered}`;
  const out = JSON.parse(await generate(bp, schema));
  let arr: { q1: string; q2: string }[] = Array.isArray(out.pairs) ? out.pairs.map((x: any) => ({ q1: String(x.q1 ?? "").trim(), q2: String(x.q2 ?? "").trim() })).filter((x: any) => x.q1) : [];
  while (arr.length < batch.length) {
    const b = batch[arr.length].text.split(/\s+/).slice(0, 4).join(" ");
    arr.push({ q1: b, q2: b.split(/\s+/).slice(0, 2).join(" ") });
  }
  if (arr.length > batch.length) arr = arr.slice(0, batch.length);
  pairs.push(...arr);
  console.log(`  queries ${Math.min(i + BATCH, beats.length)}/${beats.length}`);
}

// scored download; reuse previous on a total miss so a run never fails
const used = new Set<string>();
let lastGood: string | null = null;
for (let i = 0; i < pairs.length; i++) {
  const out = `out/clip-${i + 1}.mp4`;
  const found = await searchVideoScored([pairs[i].q1, pairs[i].q2], used);
  if (found) {
    try {
      await writeFile(out, await downloadVideo(found.clip));
      lastGood = out;
      console.log(`  clip-${i + 1}/${pairs.length} ✓ [${found.clip.src} s=${found.score}] "${found.query}" -> ${found.clip.words.slice(0, 6).join(" ")}`);
      continue;
    } catch (e) { console.error(`  clip-${i + 1} download failed: ${e}`); }
  }
  if (lastGood) { await copyFile(lastGood, out); console.log(`  clip-${i + 1}: reused previous (no match for "${pairs[i].q1}")`); continue; }
  console.error(`clip-${i + 1} FAILED with no fallback`); process.exit(1);
}

await writeFile("out/beats.json", JSON.stringify(beats.map((b, i) => ({ words: b.words, query: pairs[i].q1 })), null, 1));
console.log(`✅ ${pairs.length} relevance-scored stock clips`);
