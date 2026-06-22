import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("GEMINI_API_KEY missing"); process.exit(1); }
const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const targetWords = Number(process.env.SCRIPT_WORDS || 2000);
const sceneCount = Number(process.env.SCENE_COUNT || 40);

await mkdir("out", { recursive: true });
await mkdir("state", { recursive: true });
let used: string[] = [];
try { used = JSON.parse(await readFile("state/used-topics.json", "utf8")); } catch {}

const schema = {
  type: "object",
  properties: {
    title: { type: "string" },
    topic: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    onScreenTitle: { type: "string" },
    script: { type: "string" },
    imagePrompts: { type: "array", items: { type: "string" } },
  },
  required: ["title", "topic", "description", "tags", "onScreenTitle", "script", "imagePrompts"],
};

const prompt = `You write for "InfotainmentStu", a YouTube channel of fascinating PSYCHOLOGY & SCIENCE explainers — "the real reason..." style curiosity videos that explain why humans and the world work the way they do. Clear, accurate, surprising, easy to follow.

Create ONE new video.
- Pick a genuinely interesting, REAL psychology/science/human-behavior question (e.g. "the real reason we procrastinate", "why the dark scares us", "why time feels faster as you age", "why we cry"). It must be grounded in real, well-established science. Do NOT invent fake studies, statistics, names, or quotes — if unsure of a detail, keep it general and accurate.
- Avoid these already-used topics: ${used.length ? used.join("; ") : "(none yet)"}.
- "script": spoken narration ONLY (no stage directions, no "[music]", no references to on-screen text). About ${targetWords} words. Open with a relatable hook in the first 2 sentences, build the explanation in clear digestible steps with a surprising insight or two, and end with a satisfying reframe. Conversational, vivid, second-person ("you"), written to be read aloud.
- "imagePrompts": exactly ${sceneCount} prompts, one per beat of the narration in order. Each must describe ONE simple scene drawable as a minimalist stick-figure doodle: a stick figure doing a clear action, or a single simple object/diagram. Examples: "a stick figure lying awake in bed staring at the ceiling", "a stick figure running away from a giant question mark", "a simple drawing of a brain with one area glowing", "a stick figure at a desk with a clock above". Keep each to one clear visual idea. NO readable text, NO logos, NO realistic faces. (The hand-drawn stick-figure style is added automatically later, so don't restate style.)
- "onScreenTitle": a punchy 2-4 word on-screen title.
- "title": a compelling, curiosity-driven YouTube title (<= 70 chars), ideally starting like "The Real Reason..." or "Why...".
- "description": 2-3 sentences, then a blank line, then "InfotainmentStu — the science of being human, explained simply."
- "tags": 8-12 relevant tags.
Return JSON only.`;

const reqBody = JSON.stringify({
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 1.05 },
});
let data: any;
for (let attempt = 1; ; attempt++) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: reqBody,
  });
  if (res.ok) { data = await res.json(); break; }
  const errTxt = (await res.text()).slice(0, 300);
  if ([429, 500, 502, 503, 504].includes(res.status) && attempt <= 6) {
    const wait = 5000 * attempt;
    console.log(`Gemini ${res.status} (attempt ${attempt}) — retrying in ${wait / 1000}s…`);
    await new Promise((r) => setTimeout(r, wait));
    continue;
  }
  console.error(`HTTP ${res.status}: ${errTxt}`);
  process.exit(1);
}
const txt = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
let story: any;
try { story = JSON.parse(txt); } catch { console.error("JSON parse failed. First 400 chars:\n" + txt.slice(0, 400)); process.exit(1); }
await writeFile("out/story.json", JSON.stringify(story, null, 1));
used.push(story.title);
await writeFile("state/used-topics.json", JSON.stringify(used.slice(-300), null, 1));
const wc = String(story.script).split(/\s+/).filter(Boolean).length;
console.log(`✅ "${story.title}" — ${wc} words, ${story.imagePrompts.length} scenes`);
console.log(`   topic: ${story.topic}`);
