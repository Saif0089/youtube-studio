import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { splitForVisuals } from "../lib/sentences.js";
import { generate as gemini } from "../lib/llm.js";

const targetWords = Number(process.env.SCRIPT_WORDS || 2000);
const sections = Number(process.env.SCRIPT_SECTIONS || 9);
const wordsPerSection = Math.max(120, Math.round(targetWords / sections));
const PACE = Number(process.env.GEMINI_PACE_MS || 4000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await mkdir("out", { recursive: true });
await mkdir("state", { recursive: true });
let used: string[] = [];
try { used = JSON.parse(await readFile("state/used-topics.json", "utf8")); } catch {}

// --- Pass 1: plan ---
const planSchema = {
  type: "object",
  properties: {
    title: { type: "string" }, topic: { type: "string" }, description: { type: "string" },
    tags: { type: "array", items: { type: "string" } }, onScreenTitle: { type: "string" },
    sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, summary: { type: "string" } }, required: ["heading", "summary"] } },
  },
  required: ["title", "topic", "description", "tags", "onScreenTitle", "sections"],
};
const planPrompt = `You plan videos for "InfotainmentStu", a YouTube channel about the PSYCHOLOGY OF MONEY & BEHAVIOR — "the real reason..." curiosity videos explaining why people spend, save, waste, chase, and self-sabotage with money and success, grounded in behavioral psychology and economics.

Plan ONE new video.
- Pick a genuinely interesting, REAL question about money psychology, spending/saving behavior, wealth, success habits, or behavioral economics, grounded in well-established science. No invented studies, names, numbers, statistics, or quotes — keep specifics general and accurate. Examples: "the real reason you can't save money", "why we feel poor even when we earn more", "the psychology of impulse spending", "why money doesn't buy happiness".
- Avoid these already-used topics: ${used.length ? used.join("; ") : "(none yet)"}.
- "title": curiosity-driven YouTube title (<= 70 chars), ideally starting "The Real Reason..." or "Why...".
- "onScreenTitle": punchy 2-4 word on-screen title.
- "description": 2-3 sentences, then a blank line, then "InfotainmentStu — the psychology of money & behavior, explained simply."
- "tags": 8-12 relevant tags.
- "sections": EXACTLY ${sections} sections that together tell a complete, building explanation (hook → context → the psychology → a surprising insight or two → satisfying reframe). Each has a "heading" and a 1-2 sentence "summary". In order, no overlap.
Return JSON only.`;

const plan = JSON.parse(await gemini(planPrompt, planSchema));
console.log(`planned "${plan.title}" — ${plan.sections.length} sections`);

// --- Pass 2: per-section narration ---
const parts: string[] = [];
for (let s = 0; s < plan.sections.length; s++) {
  const sec = plan.sections[s];
  const first = s === 0, last = s === plan.sections.length - 1;
  const role = first ? "This is the opening — start with a strong, relatable hook in the first two sentences."
    : last ? "This is the FINAL section — end with a satisfying, thought-provoking reframe (no 'in conclusion')." : "";
  const prevTail = parts.length ? parts[parts.length - 1].split(/\s+/).slice(-25).join(" ") : "";
  const secPrompt = `You are writing the SPOKEN narration for a YouTube money & behavior psychology explainer. Title: "${plan.title}". Topic: ${plan.topic}.
Write ONLY the narration for this section: "${sec.heading}" — ${sec.summary}
About ${wordsPerSection} words — write the full amount. ${role}
Continue naturally; no headings, no stage directions, no "[music]", no markdown, no lists; conversational, second-person ("you"); accurate to real science (no invented studies/names/numbers/quotes).${prevTail ? ` The previous section ended: "...${prevTail}". Continue smoothly.` : ""}
Return ONLY the narration text.`;
  const txt = (await gemini(secPrompt)).trim();
  parts.push(txt);
  console.log(`  section ${s + 1}/${plan.sections.length}: ${txt.split(/\s+/).filter(Boolean).length} words`);
  await sleep(PACE);
}
const script = parts.join("\n\n");

// --- Pass 3: image prompts ---
// "doodle" (default): ONE whiteboard-doodle prompt per sentence (cheap, keyless image models).
// "photo": a SMALL set of cinematic photo beats (RealVisXL is ~90s/image, so one-per-sentence
// would take hours) — each is held longer with Ken Burns motion in the render.
const imageStyle = (process.env.IMAGE_STYLE || "doodle").toLowerCase();
const promptSchema = { type: "object", properties: { prompts: { type: "array", items: { type: "string" } } }, required: ["prompts"] };
let imagePrompts: string[] = [];

if (imageStyle === "photo") {
  // Density off the ACTUAL script length (~one fresh photo per ~120 words ≈ ~48s), not the target.
  const scriptWords = script.split(/\s+/).filter(Boolean).length;
  const photoCount = Math.max(4, Number(process.env.PHOTO_IMAGES || Math.round(scriptWords / 120)));
  const pp = `Below is the full narration of a money & behavior psychology explainer video. Break it into EXACTLY ${photoCount} visual beats, IN ORDER, evenly covering the script from start to end. For EACH beat write ONE photographic scene description for a photorealistic image model: a real person (or people) in a real setting, doing something specific that illustrates that part of the script — say who, where, the action, and the mood/lighting. Make the ${photoCount} scenes visually varied (different people, places, angles, times of day). No text, words, numbers, logos, charts, graphs, or split-screens.
Return JSON {"prompts":[...]} with EXACTLY ${photoCount} prompts, in order.

Narration:
${script}`;
  const out = JSON.parse(await gemini(pp, promptSchema));
  imagePrompts = Array.isArray(out.prompts) ? out.prompts.map((x: any) => String(x).trim()).filter(Boolean) : [];
  console.log(`  ${imagePrompts.length} photoreal scene prompts (target ${photoCount})`);
} else {
  const sentences = splitForVisuals(script);
  const BATCH = 40;
  for (let i = 0; i < sentences.length; i += BATCH) {
    const batch = sentences.slice(i, i + BATCH);
    const numbered = batch.map((s, j) => `${j + 1}. ${s}`).join("\n");
    const bp = `Below are numbered lines (in order) from a money & behavior psychology explainer narration. For EACH line, write ONE image prompt: a simple, colorful, minimalist whiteboard doodle that clearly ILLUSTRATES that specific line — a stick figure doing a clear action, or a simple object/scene that matches exactly what the line is saying. One clear visual idea each, distinct from the others. No readable text, letters, numbers, logos, or realistic faces. Do not describe art style.
Return JSON {"prompts": [...]} with EXACTLY ${batch.length} prompts, in the same order as the lines.

Lines:
${numbered}`;
    const out = JSON.parse(await gemini(bp, promptSchema));
    let arr: string[] = Array.isArray(out.prompts) ? out.prompts.map((x: any) => String(x).trim()).filter(Boolean) : [];
    while (arr.length < batch.length) arr.push(batch[arr.length]); // fallback: use the sentence text itself
    if (arr.length > batch.length) arr = arr.slice(0, batch.length);
    imagePrompts.push(...arr);
    console.log(`  prompts ${Math.min(i + BATCH, sentences.length)}/${sentences.length}`);
    await sleep(PACE);
  }
}

const story = {
  title: plan.title, topic: plan.topic, description: plan.description, tags: plan.tags,
  onScreenTitle: plan.onScreenTitle, script, imagePrompts,
};
await writeFile("out/story.json", JSON.stringify(story, null, 1));
used.push(plan.title);
await writeFile("state/used-topics.json", JSON.stringify(used.slice(-300), null, 1));
const wc = script.split(/\s+/).filter(Boolean).length;
console.log(`✅ "${story.title}" — ${wc} words (~${Math.round(wc / 150)} min), ${imagePrompts.length} sentence-matched drawings`);
console.log(`   topic: ${story.topic}`);
