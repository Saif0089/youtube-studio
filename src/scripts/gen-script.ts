import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { splitForVisuals } from "../lib/sentences.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("GEMINI_API_KEY missing"); process.exit(1); }
const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const targetWords = Number(process.env.SCRIPT_WORDS || 2000);
const sections = Number(process.env.SCRIPT_SECTIONS || 9);
const wordsPerSection = Math.max(120, Math.round(targetWords / sections));
const PACE = Number(process.env.GEMINI_PACE_MS || 4000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await mkdir("out", { recursive: true });
await mkdir("state", { recursive: true });
let used: string[] = [];
try { used = JSON.parse(await readFile("state/used-topics.json", "utf8")); } catch {}

async function gemini(prompt: string, schema?: any): Promise<string> {
  const generationConfig: any = { temperature: 1.0, maxOutputTokens: 8192 };
  if (schema) { generationConfig.responseMimeType = "application/json"; generationConfig.responseSchema = schema; }
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig });
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    if (res.ok) {
      const data: any = await res.json();
      return data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    }
    const errTxt = (await res.text()).slice(0, 300);
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt <= 6) {
      const wait = 5000 * attempt;
      console.log(`Gemini ${res.status} (attempt ${attempt}) — retrying in ${wait / 1000}s…`);
      await sleep(wait);
      continue;
    }
    console.error(`HTTP ${res.status}: ${errTxt}`); process.exit(1);
  }
}

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
const planPrompt = `You plan videos for "InfotainmentStu", a YouTube channel of fascinating PSYCHOLOGY & SCIENCE explainers — "the real reason..." curiosity videos that explain why humans and the world work the way they do.

Plan ONE new video.
- Pick a genuinely interesting, REAL psychology/science/human-behavior question grounded in well-established science. No invented studies, names, numbers, or quotes.
- Avoid these already-used topics: ${used.length ? used.join("; ") : "(none yet)"}.
- "title": curiosity-driven YouTube title (<= 70 chars), ideally starting "The Real Reason..." or "Why...".
- "onScreenTitle": punchy 2-4 word on-screen title.
- "description": 2-3 sentences, then a blank line, then "InfotainmentStu — the science of being human, explained simply."
- "tags": 8-12 relevant tags.
- "sections": EXACTLY ${sections} sections that together tell a complete, building explanation (hook → context → the science → a surprising insight or two → satisfying reframe). Each has a "heading" and a 1-2 sentence "summary". In order, no overlap.
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
  const secPrompt = `You are writing the SPOKEN narration for a YouTube psychology/science explainer. Title: "${plan.title}". Topic: ${plan.topic}.
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

// --- Pass 3: ONE image prompt per sentence (so visuals illustrate exactly what's said) ---
const sentences = splitForVisuals(script);
const promptSchema = { type: "object", properties: { prompts: { type: "array", items: { type: "string" } } }, required: ["prompts"] };
const BATCH = 40;
const imagePrompts: string[] = [];
for (let i = 0; i < sentences.length; i += BATCH) {
  const batch = sentences.slice(i, i + BATCH);
  const numbered = batch.map((s, j) => `${j + 1}. ${s}`).join("\n");
  const bp = `Below are numbered sentences from a psychology/science explainer narration. For EACH sentence, write ONE image prompt: a simple, colorful, minimalist whiteboard doodle that clearly ILLUSTRATES that specific sentence — a stick figure doing a clear action, or a simple object/scene that matches exactly what the sentence is saying. One clear visual idea each, distinct from the others. No readable text, letters, numbers, logos, or realistic faces. Do not describe art style.
Return JSON {"prompts": [...]} with EXACTLY ${batch.length} prompts, in the same order as the sentences.

Sentences:
${numbered}`;
  const out = JSON.parse(await gemini(bp, promptSchema));
  let arr: string[] = Array.isArray(out.prompts) ? out.prompts.map((x: any) => String(x).trim()).filter(Boolean) : [];
  while (arr.length < batch.length) arr.push(batch[arr.length]); // fallback: use the sentence text itself
  if (arr.length > batch.length) arr = arr.slice(0, batch.length);
  imagePrompts.push(...arr);
  console.log(`  prompts ${Math.min(i + BATCH, sentences.length)}/${sentences.length}`);
  await sleep(PACE);
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
