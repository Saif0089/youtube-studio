import { readFile, writeFile } from "node:fs/promises";

const fps = 30;
const al = JSON.parse(await readFile("out/alignment.json", "utf8"));
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const chars: string[] = al.characters ?? [];
const st: number[] = al.character_start_times_seconds ?? [];
const en: number[] = al.character_end_times_seconds ?? [];
const narrationDur = en.length ? en[en.length - 1] : 80;

type Cue = { text: string; start: number; end: number };
const cues: Cue[] = [];
let lineStart = 0;
let buf = "";
const flush = (endIdx: number) => {
  const t = buf.trim();
  if (t) cues.push({ text: t, start: st[lineStart] ?? 0, end: en[endIdx] ?? narrationDur });
  buf = "";
};
for (let i = 0; i < chars.length; i++) {
  if (buf === "") lineStart = i;
  buf += chars[i];
  const isEnd = /[.!?]/.test(chars[i]);
  const next = chars[i + 1] ?? "";
  const long = buf.trim().length >= 42;
  if ((isEnd && (next === " " || next === "")) || (long && chars[i] === " ")) flush(i);
}
if (buf.trim()) flush(chars.length - 1);

const tail = 3;
const durationInFrames = Math.round((narrationDur + tail) * fps);
const n = story.imagePrompts.length;
const props = {
  fps,
  durationInFrames,
  narrationDurSec: narrationDur,
  fadeTailSec: tail,
  audioSrc: "narration.mp3",
  musicSrc: "music.wav",
  images: Array.from({ length: n }, (_, i) => `scene-${i + 1}.jpg`),
  captions: cues,
  title: story.onScreenTitle,
  channel: "InfotainmentStu",
};
await writeFile("out/props.json", JSON.stringify(props, null, 1));
console.log(`captions=${cues.length} dur=${narrationDur.toFixed(1)}s scenes=${n} frames=${durationInFrames} title="${story.onScreenTitle}"`);
