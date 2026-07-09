import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { splitForVisuals, words as countWords } from "../lib/sentences.js";
import { generate, generateImage, generateVision } from "../lib/llm.js";
import { candidateVideos, searchPhotoScored, downloadVideo, downloadPhoto } from "../lib/stock.js";
import { normalizeImage } from "../lib/normalize-image.js";

// V7 "AI STORYBOARD": every ~sentence beat gets a SHOT LIST of 2-3 visuals (~1.5-2.5s each —
// ~5x the cut rate of the original pipeline). Each shot is AI-GENERATED to depict the exact
// moment (Gemini image, consistent cinematic style); stock (vision-verified) and punch-text
// graphics fill in. Ladder per shot: generated image > vision-verified stock > matched photo
// > graphic card. All $0; quota-dead days degrade gracefully to stock.
const sh = promisify(execFile);
const portrait = process.env.ORIENT === "portrait";
const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080;
const STYLE = process.env.IMAGE_STYLE ||
  "Cinematic editorial illustration, dramatic rim lighting, rich saturated colors, high detail, slightly stylized realism";

async function kenBurnsClip(imgPath: string, outPath: string, idx: number): Promise<void> {
  // fast, punchy moves for short shots
  const moves = [
    { z: "min(1.0+0.0018*on,1.20)", x: "(iw-iw/zoom)/2", y: "(ih-ih/zoom)/2" },
    { z: "max(1.20-0.0018*on,1.0)", x: "(iw-iw/zoom)/2", y: "(ih-ih/zoom)/2" },
    { z: "1.15", x: "(iw-iw/zoom)*on/96", y: "(ih-ih/zoom)/2" },
    { z: "1.15", x: "(iw-iw/zoom)*(1-on/96)", y: "(ih-ih/zoom)/2" },
  ][idx % 4];
  await sh("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-t", "4", "-i", imgPath,
    "-vf", `scale=${Math.round(W * 1.3)}:${Math.round(H * 1.3)},zoompan=z='${moves.z}':x='${moves.x}':y='${moves.y}':d=96:s=${W}x${H}:fps=24,setsar=1`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", outPath]);
}

async function gradientClip(outPath: string, idx: number): Promise<void> {
  const hues = ["0x1a1030", "0x0e1e2e", "0x201420", "0x102018"];
  await sh("ffmpeg", ["-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=${hues[idx % 4]}:s=${W}x${H}:d=4:r=24`,
    "-vf", "noise=alls=6:allf=t,vignette=PI/4,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", outPath]);
}

await mkdir("out", { recursive: true });
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const TARGET_BEAT_WORDS = Number(process.env.BEAT_WORDS || 12);

// ~sentence beats
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

// storyboard: 2-3 shots per beat
type Shot = { k: "gen" | "stock" | "graphic"; p: string };
type BeatPlan = { shots: Shot[]; alt: string };
const schema = {
  type: "object",
  properties: { storyboard: { type: "array", items: { type: "object", properties: {
    shots: { type: "array", items: { type: "object", properties: {
      k: { type: "string", enum: ["gen", "stock", "graphic"] }, p: { type: "string" },
    }, required: ["k", "p"] } },
    alt: { type: "string" },
  }, required: ["shots", "alt"] } } },
  required: ["storyboard"],
};
const plans: BeatPlan[] = [];
const BATCH = 20;
for (let i = 0; i < beats.length; i += BATCH) {
  const batch = beats.slice(i, i + BATCH);
  const numbered = batch.map((b, j) => `${j + 1}. ${b.text}`).join("\n");
  const bp = `You are the storyboard editor of a fast-paced money-psychology explainer. For EACH numbered narration beat below, design 2-3 SHOTS (visual cuts shown while that beat is heard — fast rhythm, a new visual every ~2 seconds).

Each shot: {"k": kind, "p": prompt}
- "gen": an AI-image of the EXACT moment — a vivid one-sentence scene description matching precisely what the words say at that point ("a man's hand holding a phone showing a marketplace listing, shocked face reflected on the dark screen"). Most shots should be "gen". No text/words/numbers in the image. Any people modestly and fully dressed.
- "stock": ONLY for generic real-world footage that certainly exists (city streets, hands counting cash, shops) — a 3-5 word search query.
- "graphic": a 2-4 word PUNCH PHRASE for a bold text card ("YOUR BRAIN LIES", "THE FLIP TEST") — the single strongest claim/number moment; max one per beat, roughly one every 3-4 beats overall.
Also give "alt": the beat's 2-4 word punch phrase (fallback text card).
Shots must follow the beat's narrative order so visuals track the words as spoken.
Return JSON {"storyboard":[{"shots":[...],"alt":"..."}]} with EXACTLY ${batch.length} entries, in order.

Beats:
${numbered}`;
  const out = JSON.parse(await generate(bp, schema));
  let arr: BeatPlan[] = Array.isArray(out.storyboard) ? out.storyboard.map((x: any) => ({
    shots: (Array.isArray(x.shots) && x.shots.length ? x.shots : [{ k: "stock", p: "money" }])
      .slice(0, 3)
      .map((s0: any) => ({ k: ["gen", "stock", "graphic"].includes(s0.k) ? s0.k : "gen", p: String(s0.p ?? "").trim() })),
    alt: String(x.alt ?? "").trim() || "MONEY MIND",
  })) : [];
  while (arr.length < batch.length) {
    const b = batch[arr.length].text.split(/\s+/);
    arr.push({ shots: [{ k: "stock", p: b.slice(0, 4).join(" ") }], alt: b.slice(0, 3).join(" ").toUpperCase() });
  }
  if (arr.length > batch.length) arr = arr.slice(0, batch.length);
  plans.push(...arr);
  console.log(`  storyboard ${Math.min(i + BATCH, beats.length)}/${beats.length}`);
}

// vision pick among stock candidates (thumbnails -> Gemini)
async function visionPick(beatText: string, visual: string, cands: { clip: { thumb?: string } }[]): Promise<number> {
  const thumbs: Buffer[] = []; const map: number[] = [];
  for (let k = 0; k < cands.length; k++) {
    const t = cands[k].clip.thumb;
    if (!t) continue;
    try {
      const r = await fetch(t, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      thumbs.push(Buffer.from(await r.arrayBuffer())); map.push(k);
    } catch { /* skip */ }
    if (thumbs.length >= 4) break;
  }
  if (thumbs.length < 2) return -1;
  const resp = await generateVision(
    `Narration: "${beatText}"\nIntended visual: "${visual}"\nThe ${thumbs.length} images are candidate clips (1-${thumbs.length}). Which ONE clearly depicts the intended visual? BE STRICT — reply 0 if none clearly fits. Reply ONLY JSON: {"best": <0-${thumbs.length}>}`,
    thumbs);
  if (!resp) return -1;
  try {
    const n = Number(JSON.parse(resp.replace(/```(?:json)?|```/g, "").trim()).best);
    return n >= 1 && n <= thumbs.length ? map[n - 1] : -2;
  } catch { return -1; }
}

const used = new Set<string>();
const usedPhotos = new Set<string>();
let clipN = 0;
let genQuotaDead = false;
const shotMeta: { beat: number; type: "footage" | "graphic"; text: string }[] = [];
const stats = { gen: 0, stock: 0, photo: 0, graphic: 0 };

for (let i = 0; i < plans.length; i++) {
  for (const shot of plans[i].shots) {
    clipN++;
    const out = `out/clip-${clipN}.mp4`;

    if (shot.k === "graphic") {
      await gradientClip(out, clipN);
      shotMeta.push({ beat: i, type: "graphic", text: shot.p || plans[i].alt });
      stats.graphic++;
      console.log(`  clip-${clipN} [b${i + 1}] ▣ GRAPHIC "${shot.p}"`);
      continue;
    }

    // 1) generated image (unless quota already died this run)
    if (shot.k === "gen" && !genQuotaDead) {
      const img = await generateImage(`${shot.p}. Style: ${STYLE}. 16:9 wide composition. No text, letters, or numbers anywhere in the image. Any people modestly and fully dressed.`);
      if (img) {
        await normalizeImage(img, `out/gen-${clipN}.jpg`);
        await kenBurnsClip(`out/gen-${clipN}.jpg`, out, clipN);
        shotMeta.push({ beat: i, type: "footage", text: "" });
        stats.gen++;
        console.log(`  clip-${clipN} [b${i + 1}] ✨ GEN "${shot.p.slice(0, 60)}"`);
        continue;
      }
      genQuotaDead = true;
      console.log("  (image quota exhausted — remaining gen shots use stock fallback)");
    }

    // 2) stock, vision-verified
    const q = shot.k === "stock" ? shot.p : shot.p.split(/\s+/).slice(0, 5).join(" ");
    const cands = await candidateVideos([q], used, 4);
    let chosen = cands.length ? await visionPick(beats[i].text, q, cands) : -1;
    if (chosen === -1 && cands.length && cands[0].score >= 2) chosen = 0;
    if (chosen >= 0) {
      try {
        await writeFile(out, await downloadVideo(cands[chosen].clip));
        used.add(cands[chosen].clip.id);
        shotMeta.push({ beat: i, type: "footage", text: "" });
        stats.stock++;
        console.log(`  clip-${clipN} [b${i + 1}] ✓ STOCK s=${cands[chosen].score} "${q}" -> ${cands[chosen].clip.words.slice(0, 5).join(" ")}`);
        continue;
      } catch { /* fall through */ }
    }

    // 3) matched photo
    const ph = await searchPhotoScored([q], usedPhotos);
    if (ph && ph.score >= 2) {
      try {
        await normalizeImage(await downloadPhoto(ph.photo), `out/still-${clipN}.jpg`);
        await kenBurnsClip(`out/still-${clipN}.jpg`, out, clipN);
        shotMeta.push({ beat: i, type: "footage", text: "" });
        stats.photo++;
        console.log(`  clip-${clipN} [b${i + 1}] ✓ PHOTO s=${ph.score} "${q}"`);
        continue;
      } catch { /* fall through */ }
    }

    // 4) honest graphic card
    await gradientClip(out, clipN);
    shotMeta.push({ beat: i, type: "graphic", text: plans[i].alt });
    stats.graphic++;
    console.log(`  clip-${clipN} [b${i + 1}] ▣ GRAPHIC fallback "${plans[i].alt}"`);
  }
}

await writeFile("out/beats.json", JSON.stringify(beats.map((b) => ({ words: b.words })), null, 1));
await writeFile("out/shots.json", JSON.stringify(shotMeta, null, 1));
console.log(`✅ ${clipN} shots for ${beats.length} beats — ${stats.gen} generated, ${stats.stock} stock, ${stats.photo} photo, ${stats.graphic} graphic`);
