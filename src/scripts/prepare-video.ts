import { readFile, writeFile } from "node:fs/promises";
import { alignByWordCount, buildCaptionLines, type Word } from "../lib/timing.js";
import { words as countWords } from "../lib/sentences.js";

const fps = 24;
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const beats: { words: number; query: string }[] = JSON.parse(await readFile("out/beats.json", "utf8"));
const words: Word[] = JSON.parse(await readFile("out/words.json", "utf8")).map((x: any) => ({ w: String(x.w), start: +x.start, end: +x.end }));
if (!words.length) { console.error("No timing in out/words.json"); process.exit(1); }
const narrationDur = words[words.length - 1].end;
const tail = 2.5;

// each beat's clip plays exactly while its narration is spoken; last clip holds the fade tail
const segs = alignByWordCount(beats.map((b) => b.words), words, narrationDur);
const timeline = beats.map((_, i) => {
  const start = segs[i].start;
  const end = i < beats.length - 1 ? segs[i + 1].start : narrationDur + tail;
  return { clip: `clip-${i + 1}.mp4`, dur: Math.max(0.6, Math.round((end - start) * 1000) / 1000) };
});

// chapter cards: section headings timed by each section's word count (skip the opener —
// the title card owns the first seconds; a chapter card there would fight it)
type Card = { text: string; start: number };
let cards: Card[] = [];
const sections: { heading: string; narration: string }[] = story.sections ?? [];
if (sections.length > 1) {
  const secSegs = alignByWordCount(sections.map((s) => countWords(s.narration)), words, narrationDur);
  cards = sections.slice(1).map((s, k) => ({ text: s.heading, start: secSegs[k + 1].start }));
}

const lines = buildCaptionLines(words, Number(process.env.CAPTION_WORDS || 4));
const durationInFrames = Math.round((narrationDur + tail) * fps);
const props = {
  fps, durationInFrames, narrationDurSec: narrationDur, fadeTailSec: tail,
  lines, cards, title: story.onScreenTitle || story.title, channel: "InfotainmentStu",
  portrait: process.env.ORIENT === "portrait",
  images: ["thumb-bg.jpg"], // for the Thumbnail still
};
await writeFile("out/props.json", JSON.stringify(props));
await writeFile("out/timeline.json", JSON.stringify(timeline));
console.log(`beats=${beats.length} words=${words.length} dur=${narrationDur.toFixed(1)}s cards=${cards.length} clips=${timeline.length}`);
