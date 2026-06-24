import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { splitForVisuals } from "../lib/sentences.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("GEMINI_API_KEY missing"); process.exit(1); }
const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const targetWords = Number(process.env.SHORT_WORDS || 120);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gemini(prompt: string, schema?: any): Promise<string> {
  const generationConfig: any = { temperature: 1.0, maxOutputTokens: 4096 };
  if (schema) { generationConfig.responseMimeType = "application/json"; generationConfig.responseSchema = schema; }
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig });
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) { const data: any = await res.json(); return data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? ""; }
    const errTxt = (await res.text()).slice(0, 300);
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt <= 5) { await sleep(5000 * attempt); continue; }
    console.error(`HTTP ${res.status}: ${errTxt}`); process.exit(1);
  }
}

await mkdir("out", { recursive: true });

const planSchema = { type: "object", properties: { title: { type: "string" }, onScreenTitle: { type: "string" }, description: { type: "string" }, tags: { type: "array", items: { type: "string" } }, script: { type: "string" } }, required: ["title", "onScreenTitle", "description", "tags", "script"] };
const planPrompt = `Write a punchy YouTube SHORT (~${targetWords} words, ~40-50 seconds read aloud) about the PSYCHOLOGY OF MONEY & BEHAVIOR.
- A self-contained, surprising money-psychology insight with a STRONG hook in the first sentence (a question or bold claim that stops the scroll).
- Spoken narration ONLY, second-person ("you"), punchy and conversational, accurate to real behavioral science (no invented studies, numbers, or quotes).
- End with a short call to action: tell viewers the full breakdown is on the channel and to subscribe.
- "title": punchy YouTube title <= 80 chars, ending with " #shorts".
- "onScreenTitle": 2-4 word hook.
- "description": 1-2 sentences then " #shorts #money #psychology #finance".
- "tags": 6-10 tags.
Return JSON only.`;
const plan = JSON.parse(await gemini(planPrompt, planSchema));
const script: string = plan.script;

const lines = splitForVisuals(script);
const promptSchema = { type: "object", properties: { prompts: { type: "array", items: { type: "string" } } }, required: ["prompts"] };
const numbered = lines.map((s, i) => `${i + 1}. ${s}`).join("\n");
const bp = `Below are numbered lines from a money-psychology YouTube short. For EACH line, write ONE image prompt for a simple colorful minimalist whiteboard doodle (TALL vertical composition) that clearly illustrates that line — a stick figure doing a clear money-related action, or a simple object/scene. One clear visual each, distinct. No readable text, logos, or realistic faces. Do not describe art style. Return JSON {"prompts":[...]} with EXACTLY ${lines.length} entries in order.

Lines:
${numbered}`;
const out = JSON.parse(await gemini(bp, promptSchema));
let imagePrompts: string[] = Array.isArray(out.prompts) ? out.prompts.map((x: any) => String(x).trim()).filter(Boolean) : [];
while (imagePrompts.length < lines.length) imagePrompts.push(lines[imagePrompts.length]);
imagePrompts = imagePrompts.slice(0, lines.length);

const story = { title: plan.title, topic: "money psychology short", description: plan.description, tags: plan.tags, onScreenTitle: plan.onScreenTitle, script, imagePrompts };
await writeFile("out/story.json", JSON.stringify(story, null, 1));
const wc = script.split(/\s+/).filter(Boolean).length;
console.log(`✅ short "${plan.title}" — ${wc} words, ${imagePrompts.length} drawings`);
