import "dotenv/config";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { splitForVisuals, words as countWords } from "../lib/sentences.js";
import { generate } from "../lib/llm.js";
import { searchVideoScored, searchPhotoScored, downloadVideo, downloadPhoto } from "../lib/stock.js";
import { normalizeImage } from "../lib/normalize-image.js";

// Per-sentence beats -> TWO candidate queries each -> relevance-scored VIDEO pick.
// HYBRID fallback: when no video really matches, use a matched stock PHOTO as a Ken Burns
// clip (photo libraries are ~10x deeper — a matching photo beats a non-matching video).
const sh = promisify(execFile);
async function kenBurnsClip(imgPath: string, outPath: string, idx: number): Promise<void> {
  const portrait = process.env.ORIENT === "portrait";
  const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080;
  const zoomIn = idx % 2 === 0;
  const z = zoomIn ? "min(1.0+0.0006*on,1.16)" : "max(1.16-0.0006*on,1.0)";
  await sh("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-t", "10", "-i", imgPath,
    "-vf", `scale=${Math.round(W * 1.25)}:${Math.round(H * 1.25)},zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=240:s=${W}x${H}:fps=24,setsar=1`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", outPath]);
}

await mkdir("out", { recursive: true });
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const TARGET_BEAT_WORDS = Number(process.env.BEAT_WORDS || 12);  // ~one clip per sentence

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
  const bp = `Below are numbered narration beats (in order) from a money-psychology video. For EACH beat give TWO stock-footage search queries for the SINGLE MOST VIVID concrete image in that beat (the thing a viewer should SEE while hearing it):
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

// hybrid scored download: real match on video > real match on photo > any video > reuse previous
const used = new Set<string>();
const usedPhotos = new Set<string>();
let lastGood: string | null = null;
let photoCount = 0;
for (let i = 0; i < pairs.length; i++) {
  const out = `out/clip-${i + 1}.mp4`;
  const q = [pairs[i].q1, pairs[i].q2];
  const vid = await searchVideoScored(q, used);

  if (vid && vid.score >= 2) {
    try {
      await writeFile(out, await downloadVideo(vid.clip));
      lastGood = out;
      console.log(`  clip-${i + 1}/${pairs.length} ✓ [video s=${vid.score}] "${vid.query}" -> ${vid.clip.words.slice(0, 6).join(" ")}`);
      continue;
    } catch (e) { console.error(`  clip-${i + 1} video download failed: ${e}`); }
  }

  // no genuinely matching video — try a matching PHOTO as a Ken Burns clip
  const ph = await searchPhotoScored(q, usedPhotos);
  if (ph) {
    try {
      await normalizeImage(await downloadPhoto(ph.photo), `out/still-${i + 1}.jpg`);
      await kenBurnsClip(`out/still-${i + 1}.jpg`, out, i);
      lastGood = out;
      photoCount++;
      console.log(`  clip-${i + 1}/${pairs.length} ✓ [PHOTO s=${ph.score}] "${ph.query}" -> ${ph.photo.words.slice(0, 6).join(" ")}`);
      continue;
    } catch (e) { console.error(`  clip-${i + 1} photo path failed: ${e}`); }
  }

  // last resorts: the unmatched video, then previous clip
  if (vid) {
    try {
      await writeFile(out, await downloadVideo(vid.clip));
      lastGood = out;
      console.log(`  clip-${i + 1}/${pairs.length} ~ [video weak s=${vid.score}] "${vid.query}" -> ${vid.clip.words.slice(0, 6).join(" ")}`);
      continue;
    } catch { /* fall through */ }
  }
  if (lastGood) { await copyFile(lastGood, out); console.log(`  clip-${i + 1}: reused previous (no match for "${pairs[i].q1}")`); continue; }
  console.error(`clip-${i + 1} FAILED with no fallback`); process.exit(1);
}

await writeFile("out/beats.json", JSON.stringify(beats.map((b, i) => ({ words: b.words, query: pairs[i].q1 })), null, 1));
console.log(`✅ ${pairs.length} visuals (${pairs.length - photoCount} video, ${photoCount} ken-burns photo)`);
