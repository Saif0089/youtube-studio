import "dotenv/config";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { splitForVisuals } from "../lib/sentences.js";
import { generate } from "../lib/llm.js";
import { searchPhoto, downloadPhoto } from "../lib/stock.js";
import { normalizeImage } from "../lib/normalize-image.js";

await mkdir("out", { recursive: true });
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const scenes: { visual: string }[] = JSON.parse(await readFile("out/scenes.json", "utf8"));
const units = splitForVisuals(story.script);
const poolList = scenes.map((s, i) => `${i}: ${s.visual}`).join("\n"); // doodle pool the model maps each line to
const schema = {
  type: "object",
  properties: {
    queries: { type: "array", items: { type: "string" } },
    doodles: { type: "array", items: { type: "integer" } },
  },
  required: ["queries", "doodles"],
};

// Per line: ONE stock-photo query (for the background) AND the index of the pool doodle whose
// action best fits the line (so the on-screen doodle changes every sentence AND stays relevant).
const queries: string[] = [];
const doodleMap: number[] = [];
const BATCH = 40;
for (let i = 0; i < units.length; i += BATCH) {
  const batch = units.slice(i, i + BATCH);
  const numbered = batch.map((s, j) => `${j + 1}. ${s}`).join("\n");
  const bp = `Below are numbered narration lines (in order) from a money & behavior psychology video.

For EACH line return two things:
- a "query": ONE concrete, literal stock-photo SEARCH QUERY of 2-5 words describing a real, photographable scene that matches the line — a person, place, object, or action (e.g. "person counting coins", "empty wallet on table", "busy city commute"). Prefer everyday money/life and natural-environment settings. Avoid abstract words (psychology, behavior, emotion), text, charts, logos, brand names.
- a "doodle": the INDEX (an integer) of the doodle from the list below whose action best matches this line.

DOODLE LIST (index: action):
${poolList}

Return JSON {"queries":[...],"doodles":[...]} with EXACTLY ${batch.length} entries each, in line order. Each "doodles" value MUST be an integer from 0 to ${scenes.length - 1}.

Lines:
${numbered}`;
  const out = JSON.parse(await generate(bp, schema));
  let q: string[] = Array.isArray(out.queries) ? out.queries.map((x: any) => String(x).trim()).filter(Boolean) : [];
  let d: number[] = Array.isArray(out.doodles) ? out.doodles.map((x: any) => Number(x)) : [];
  while (q.length < batch.length) q.push(batch[q.length].split(/\s+/).slice(0, 4).join(" "));
  if (q.length > batch.length) q = q.slice(0, batch.length);
  for (let j = 0; j < batch.length; j++) {
    const v = d[j];
    doodleMap.push(Number.isInteger(v) && v >= 0 && v < scenes.length ? v : (i + j) % scenes.length);
  }
  queries.push(...q);
  console.log(`  lines ${Math.min(i + BATCH, units.length)}/${units.length}`);
}

// fetch + normalize one photo per query; reuse previous on a miss so a run never fails
const used = new Set<string>();
let lastGood: string | null = null;
for (let i = 0; i < queries.length; i++) {
  const out = `out/bg-${i + 1}.jpg`;
  const cand = await searchPhoto(queries[i], used, i);
  if (cand) {
    try {
      await normalizeImage(await downloadPhoto(cand), out);
      lastGood = out;
      console.log(`  bg-${i + 1}/${queries.length} ✓ [${cand.src}] ${queries[i]} -> doodle#${doodleMap[i]}`);
      continue;
    } catch (e) { console.error(`  bg-${i + 1} download failed: ${e}`); }
  }
  if (lastGood) { await copyFile(lastGood, out); console.log(`  bg-${i + 1}: reused previous (no match for "${queries[i]}")`); continue; }
  const generic = await searchPhoto("calm natural landscape", used, i);
  if (generic) { await normalizeImage(await downloadPhoto(generic), out); lastGood = out; console.log(`  bg-${i + 1}: generic fallback`); }
  else { console.error(`bg-${i + 1} FAILED with no fallback`); process.exit(1); }
}

await writeFile("out/bg.json", JSON.stringify({ queries }, null, 1));
await writeFile("out/doodle-map.json", JSON.stringify(doodleMap));
console.log(`✅ ${queries.length} stock backgrounds + per-sentence doodle map`);
