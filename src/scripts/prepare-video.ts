import { readFile, writeFile } from "node:fs/promises";
import { alignByWordCount, buildCaptionLines, type Word } from "../lib/timing.js";
import { words as countWords } from "../lib/sentences.js";

const fps = 24;
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const beats: { words: number }[] = JSON.parse(await readFile("out/beats.json", "utf8"));
const shots: { beat: number; type: "footage" | "graphic"; text: string }[] = JSON.parse(await readFile("out/shots.json", "utf8"));
const words: Word[] = JSON.parse(await readFile("out/words.json", "utf8")).map((x: any) => ({ w: String(x.w), start: +x.start, end: +x.end }));
if (!words.length) { console.error("No timing in out/words.json"); process.exit(1); }
const narrationDur = words[words.length - 1].end;
const tail = 2.5;

// beat windows from spoken-word counts, then split each beat evenly across its shots
const segs = alignByWordCount(beats.map((b) => b.words), words, narrationDur);
const timeline: { clip: string; dur: number }[] = [];
const graphics: { text: string; start: number; end: number }[] = [];
let clipN = 0;
for (let i = 0; i < beats.length; i++) {
  const beatShots = shots.filter((s) => s.beat === i);
  if (!beatShots.length) continue;
  const start = segs[i].start;
  const end = i < beats.length - 1 ? segs[i + 1].start : narrationDur + tail;
  const share = Math.max(0.6, (end - start) / beatShots.length);
  beatShots.forEach((s, j) => {
    clipN++;
    timeline.push({ clip: `clip-${clipN}.mp4`, dur: Math.round(share * 1000) / 1000 });
    if (s.type === "graphic" && s.text) {
      graphics.push({ text: s.text, start: start + j * share, end: start + (j + 1) * share });
    }
  });
}

// chapter cards from section headings (skip the opener — the title card owns it)
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
  lines, cards, graphics, title: story.onScreenTitle || story.title, channel: "InfotainmentStu",
  portrait: process.env.ORIENT === "portrait",
  images: ["thumb-bg.jpg"],
};
await writeFile("out/props.json", JSON.stringify(props));
await writeFile("out/timeline.json", JSON.stringify(timeline));
console.log(`beats=${beats.length} shots=${timeline.length} words=${words.length} dur=${narrationDur.toFixed(1)}s cards=${cards.length} graphics=${graphics.length}`);
