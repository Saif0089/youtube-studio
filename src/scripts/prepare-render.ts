import { readFile, writeFile } from "node:fs/promises";

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
      if (/\s/.test(c)) {
        if (cur) { words.push({ w: cur, start: cs, end: ce }); cur = ""; started = false; }
      } else {
        if (!started) { cs = st[i] ?? ce; started = true; }
        cur += c; ce = en[i] ?? cs;
      }
    }
    if (cur) words.push({ w: cur, start: cs, end: ce });
  } catch {}
}

if (!words.length) { console.error("No timing found (need out/words.json or out/alignment.json)"); process.exit(1); }

const narrationDur = words[words.length - 1].end;

// group words into short caption lines (break on sentence end or LINE_MAX words)
const LINE_MAX = Number(process.env.CAPTION_WORDS || 4);
type Line = { start: number; end: number; words: { text: string; start: number; end: number }[] };
const lines: Line[] = [];
let cur: W[] = [];
const flush = () => {
  if (!cur.length) return;
  lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur.map((x) => ({ text: x.w, start: x.start, end: x.end })) });
  cur = [];
};
for (const wd of words) {
  cur.push(wd);
  if (cur.length >= LINE_MAX || /[.!?]$/.test(wd.w)) flush();
}
flush();

// phrase captions (fallback comps / SEO)
const captions = lines.map((l) => ({ text: l.words.map((w) => w.text).join(" "), start: l.start, end: l.end }));

const tail = 3;
const imgMaxSec = Number(process.env.IMG_MAX_SEC || 3); // each image shows at most this long (cycles to fill)
const durationInFrames = Math.round((narrationDur + tail) * fps);
const n = story.imagePrompts.length;
const props = {
  fps,
  durationInFrames,
  narrationDurSec: narrationDur,
  fadeTailSec: tail,
  imgMaxSec,
  audioSrc: "narration.mp3",
  musicSrc: "music.wav",
  images: Array.from({ length: n }, (_, i) => `scene-${i + 1}.jpg`),
  captions,
  lines,
  title: story.onScreenTitle,
  channel: "InfotainmentStu",
};
await writeFile("out/props.json", JSON.stringify(props, null, 1));
console.log(`words=${words.length} lines=${lines.length} dur=${narrationDur.toFixed(1)}s scenes=${n} frames=${durationInFrames} title="${story.onScreenTitle}"`);
