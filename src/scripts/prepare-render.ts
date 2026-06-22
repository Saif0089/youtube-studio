import { readFile, writeFile } from "node:fs/promises";

const fps = 30;
const al = JSON.parse(await readFile("out/alignment.json", "utf8"));
const chars: string[] = al.characters ?? [];
const st: number[] = al.character_start_times_seconds ?? [];
const en: number[] = al.character_end_times_seconds ?? [];
const narrationDur = en.length ? en[en.length - 1] : 80;

type Cue = { text: string; start: number; end: number };
const cues: Cue[] = [];
let lineStart = 0;
let buf = "";
const flush = (endIdx: number) => {
  const text = buf.trim();
  if (text) cues.push({ text, start: st[lineStart] ?? 0, end: en[endIdx] ?? narrationDur });
  buf = "";
};
for (let i = 0; i < chars.length; i++) {
  if (buf === "") lineStart = i;
  buf += chars[i];
  const isSentenceEnd = /[.!?]/.test(chars[i]);
  const next = chars[i + 1] ?? "";
  const longEnough = buf.trim().length >= 42;
  if ((isSentenceEnd && (next === " " || next === "")) || (longEnough && chars[i] === " ")) flush(i);
}
if (buf.trim()) flush(chars.length - 1);

const tail = 3;
const durationInFrames = Math.round((narrationDur + tail) * fps);
const props = {
  fps,
  durationInFrames,
  narrationDurSec: narrationDur,
  fadeTailSec: tail,
  audioSrc: "narration.mp3",
  musicSrc: "music.wav",
  images: [1, 2, 3, 4, 5, 6, 7].map((n) => `scene-${n}.jpg`),
  captions: cues,
  title: "The Ship Found With No Crew",
  channel: "InfotainmentStu",
};
await writeFile("out/props.json", JSON.stringify(props, null, 1));
console.log(`captions=${cues.length} narrationDur=${narrationDur.toFixed(1)}s frames=${durationInFrames}`);
console.log("sample cues:", cues.slice(0, 3).map((c) => `[${c.start.toFixed(1)}-${c.end.toFixed(1)}] ${c.text}`).join(" | "));
