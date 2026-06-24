import { readFile, writeFile } from "node:fs/promises";
import { splitForVisuals, words as countWords } from "../lib/sentences.js";

const fps = 30;
const story = JSON.parse(await readFile("out/story.json", "utf8"));

type W = { w: string; start: number; end: number };
let words: W[] = [];

// Preferred: Edge-TTS word-level timing
try {
  const raw = JSON.parse(await readFile("out/words.json", "utf8"));
  if (Array.isArray(raw) && raw.length) words = raw.map((x: any) => ({ w: String(x.w), start: +x.start, end: +x.end }));
} catch {}

// Fallback: ElevenLabs char-level alignment -> words
if (!words.length) {
  try {
    const al = JSON.parse(await readFile("out/alignment.json", "utf8"));
    const chars: string[] = al.characters ?? [];
    const st: number[] = al.character_start_times_seconds ?? [];
    const en: number[] = al.character_end_times_seconds ?? [];
    let cur = "", cs = 0, ce = 0, started = false;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (/\s/.test(c)) { if (cur) { words.push({ w: cur, start: cs, end: ce }); cur = ""; started = false; } }
      else { if (!started) { cs = st[i] ?? ce; started = true; } cur += c; ce = en[i] ?? cs; }
    }
    if (cur) words.push({ w: cur, start: cs, end: ce });
  } catch {}
}
if (!words.length) { console.error("No timing found (need out/words.json or out/alignment.json)"); process.exit(1); }
const narrationDur = words[words.length - 1].end;

// --- word-by-word caption lines (unchanged) ---
const LINE_MAX = Number(process.env.CAPTION_WORDS || 4);
type Line = { start: number; end: number; words: { text: string; start: number; end: number }[] };
const lines: Line[] = [];
let cur: W[] = [];
const flush = () => { if (cur.length) { lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur.map((x) => ({ text: x.w, start: x.start, end: x.end })) }); cur = []; } };
for (const wd of words) { cur.push(wd); if (cur.length >= LINE_MAX || /[.!?]$/.test(wd.w)) flush(); }
flush();
const captions = lines.map((l) => ({ text: l.words.map((w) => w.text).join(" "), start: l.start, end: l.end }));

// --- per-sentence image segments: each image is shown exactly while its sentence is spoken ---
const sentences = splitForVisuals(story.script);
const n = story.imagePrompts.length;
const wt = (i: number) => words[Math.max(0, Math.min(words.length - 1, i))].start;
let segments: { start: number; end: number }[] = [];

if (sentences.length === n) {
  // walk the spoken-word stream, advancing by each line's word count, so every image
  // is timed to the EXACT moment its line's first word is spoken (no proportional drift)
  const startIdx: number[] = [];
  let wi = 0;
  for (const s of sentences) { startIdx.push(Math.min(wi, words.length - 1)); wi += countWords(s); }
  for (let k = 0; k < n; k++) {
    const start = words[startIdx[k]].start;
    const end = k < n - 1 ? words[startIdx[k + 1]].start : narrationDur;
    segments.push({ start, end });
  }
} else {
  // robust fallback: distribute images evenly across the real word timeline
  console.log(`note: sentences(${sentences.length}) != images(${n}); using even-word timing`);
  for (let k = 0; k < n; k++) {
    const start = wt(Math.round((k * words.length) / n));
    const end = k < n - 1 ? wt(Math.round(((k + 1) * words.length) / n)) : narrationDur;
    segments.push({ start, end });
  }
}

const tail = 3;
const durationInFrames = Math.round((narrationDur + tail) * fps);
const props = {
  fps, durationInFrames, narrationDurSec: narrationDur, fadeTailSec: tail,
  audioSrc: "narration.mp3", musicSrc: "music.wav",
  images: Array.from({ length: n }, (_, i) => `scene-${i + 1}.jpg`),
  captions, lines, segments,
  title: story.onScreenTitle, channel: "InfotainmentStu",
};
await writeFile("out/props.json", JSON.stringify(props, null, 1));
const avg = (segments.reduce((a, s) => a + (s.end - s.start), 0) / Math.max(1, segments.length));
console.log(`words=${words.length} sentences=${sentences.length} images=${n} dur=${narrationDur.toFixed(1)}s avgImg=${avg.toFixed(1)}s title="${story.onScreenTitle}"`);
