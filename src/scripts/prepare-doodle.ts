import { readFile, writeFile } from "node:fs/promises";
import { words as countWords } from "../lib/sentences.js";

const fps = 30;
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const scenes: { narration: string; visual: string; svg: string }[] = JSON.parse(await readFile("out/scenes.json", "utf8"));

type W = { w: string; start: number; end: number };
const words: W[] = JSON.parse(await readFile("out/words.json", "utf8")).map((x: any) => ({ w: String(x.w), start: +x.start, end: +x.end }));
if (!words.length) { console.error("No timing in out/words.json"); process.exit(1); }
const narrationDur = words[words.length - 1].end;

// word-by-word caption lines
const LINE_MAX = Number(process.env.CAPTION_WORDS || 4);
type Line = { start: number; end: number; words: { text: string; start: number; end: number }[] };
const lines: Line[] = [];
let cur: W[] = [];
const flush = () => { if (cur.length) { lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur.map((x) => ({ text: x.w, start: x.start, end: x.end })) }); cur = []; } };
for (const wd of words) { cur.push(wd); if (cur.length >= LINE_MAX || /[.!?]$/.test(wd.w)) flush(); }
flush();

// time each scene to its narration: walk the spoken-word stream by each scene's word count
const startIdx: number[] = [];
let wi = 0;
for (const s of scenes) { startIdx.push(Math.min(wi, words.length - 1)); wi += countWords(s.narration); }
const sceneOut = scenes.map((s, k) => {
  const start = words[startIdx[k]].start;
  const end = k < scenes.length - 1 ? words[startIdx[k + 1]].start : narrationDur;
  return { svg: s.svg, start, end };
});

const tail = 2.5;
const durationInFrames = Math.round((narrationDur + tail) * fps);
const props = {
  fps,
  durationInFrames,
  narrationDurSec: narrationDur,
  fadeTailSec: tail,
  audioSrc: "narration.mp3",
  scenes: sceneOut,
  lines,
  title: story.onScreenTitle || story.title,
  channel: "InfotainmentStu",
  portrait: process.env.ORIENT !== "landscape", // default vertical (Short); ORIENT=landscape -> 16:9 long video
};
await writeFile("out/props.json", JSON.stringify(props));
console.log(`words=${words.length} scenes=${scenes.length} dur=${narrationDur.toFixed(1)}s durFrames=${durationInFrames}`);
