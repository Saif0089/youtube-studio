import { readFile, writeFile } from "node:fs/promises";
import { splitForVisuals, words as countWords } from "../lib/sentences.js";
import { alignByWordCount, buildCaptionLines, type Word } from "../lib/timing.js";

const fps = 30;
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const pool: { narration: string; visual: string; preset: string; svg: string }[] = JSON.parse(await readFile("out/scenes.json", "utf8"));
const words: Word[] = JSON.parse(await readFile("out/words.json", "utf8")).map((x: any) => ({ w: String(x.w), start: +x.start, end: +x.end }));
if (!words.length) { console.error("No timing in out/words.json"); process.exit(1); }
const narrationDur = words[words.length - 1].end;

// per-sentence visual units -> photo + doodle timing aligned to the real word stream
const units = splitForVisuals(story.script);
const segments = alignByWordCount(units.map(countWords), words, narrationDur);

// per-sentence doodle assignment (out/doodle-map.json maps each unit -> a pool index);
// fall back to round-robin if the map is missing or short.
let map: number[] = [];
try { map = JSON.parse(await readFile("out/doodle-map.json", "utf8")); } catch {}
const doodles = units.map((_, i) => {
  const idx = Number.isInteger(map[i]) && map[i] >= 0 && map[i] < pool.length ? map[i] : i % pool.length;
  const p = pool[idx];
  return { svg: p.svg, preset: p.preset || "idle", start: segments[i].start, end: segments[i].end };
});

const lines = buildCaptionLines(words, Number(process.env.CAPTION_WORDS || 4));

const tail = 2.5;
const durationInFrames = Math.round((narrationDur + tail) * fps);
const props = {
  fps, durationInFrames, narrationDurSec: narrationDur, fadeTailSec: tail,
  audioSrc: "narration.mp3",
  images: units.map((_, i) => `bg-${i + 1}.jpg`),
  segments, doodles, lines,
  title: story.onScreenTitle || story.title,
  channel: "InfotainmentStu",
  portrait: process.env.ORIENT === "portrait",
};
await writeFile("out/props.json", JSON.stringify(props));
console.log(`words=${words.length} units=${units.length} pool=${pool.length} dur=${narrationDur.toFixed(1)}s frames=${durationInFrames}`);
