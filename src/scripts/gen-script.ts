import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("GEMINI_API_KEY missing"); process.exit(1); }
const model = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const targetWords = Number(process.env.SCRIPT_WORDS || 2000);
const sceneCount = Number(process.env.SCENE_COUNT || 40);
const sections = Number(process.env.SCRIPT_SECTIONS || 9);
const wordsPerSection = Math.max(120, Math.round(targetWords / sections));
const PACE = Number(process.env.GEMINI_PACE_MS || 4000); // spacing between calls to respect free-tier RPM

await mkdir("out", { recursive: true });
await mkdir("state", { recursive: true });
let used: string[] = [];
try { used = JSON.parse(await readFile("state/used-topics.json", "utf8")); } catch {}

// --- Gemini call with retry/backoff; schema => JSON mode, else plain text ---
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
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    console.error(`HTTP ${res.status}: ${errTxt}`); process.exit(1);
  }
}

// --- Pass 1: plan (metadata + section outline) ---
const planSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    topic: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    onScreenTitle: { type: "string" },
    sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, summary: { type: "string" } }, required: ["heading", "summary"] } },
  },
  required: ["title", "topic", "description", "tags", "onScreenTitle", "sections"],
};
const planPrompt = `You plan videos for "InfotainmentStu", a YouTube channel of fascinating PSYCHOLOGY & SCIENCE explainers — "the real reason..." style curiosity videos that explain why humans and the world work the way they do.

Plan ONE new video.
- Pick a genuinely interesting, REAL psychology/science/human-behavior question grounded in well-established science (e.g. "the real reason we procrastinate", "why time feels faster as you age", "why we cry"). No invented studies, names, numbers, or quotes.
- Avoid these already-used topics: ${used.length ? used.join("; ") : "(none yet)"}.
- "title": curiosity-driven YouTube title (<= 70 chars), ideally starting "The Real Reason..." or "Why...".
- "onScreenTitle": punchy 2-4 word on-screen title.
- "description": 2-3 sentences, then a blank line, then "InfotainmentStu — the science of being human, explained simply."
- "tags": 8-12 relevant tags.
- "sections": EXACTLY ${sections} sections that together tell a complete, building explanation (hook/relatable opening → context → the science → a surprising insight or two → satisfying reframe). Each has a "heading" and a 1-2 sentence "summary" of what it covers. Make the sections flow in order and not overlap.
Return JSON only.`;

const plan = JSON.parse(await gemini(planPrompt, planSchema));
console.log(`planned "${plan.title}" — ${plan.sections.length} sections`);

// --- Pass 2: write each section's narration (reliable long-form) ---
const parts: string[] = [];
for (let s = 0; s < plan.sections.length; s++) {
  const sec = plan.sections[s];
  const first = s === 0, last = s === plan.sections.length - 1;
  const role = first ? "This is the opening — start with a strong, relatable hook in the first two sentences."
    : last ? "This is the FINAL section — end with a satisfying, thought-provoking reframe (no 'in conclusion')." : "";
  const prevTail = parts.length ? parts[parts.length - 1].split(/\s+/).slice(-25).join(" ") : "";
  const secPrompt = `You are writing the SPOKEN narration for a YouTube psychology/science explainer.
Title: "${plan.title}". Topic: ${plan.topic}.
Write ONLY the narration for this section: "${sec.heading}" — ${sec.summary}
Length: about ${wordsPerSection} words — write the FULL amount, do not summarize. ${role}
Continue naturally; do NOT restate the title or earlier points; no headings, no stage directions, no "[music]", no markdown, no lists. Conversational, second-person ("you"), vivid, and accurate to real science (no invented studies/names/numbers/quotes).
${prevTail ? `The previous section ended: "...${prevTail}". Continue smoothly.` : ""}
Return ONLY the narration text.`;
  const txt = (await gemini(secPrompt)).trim();
  parts.push(txt);
  console.log(`  section ${s + 1}/${plan.sections.length}: ${txt.split(/\s+/).filter(Boolean).length} words`);
  await new Promise((r) => setTimeout(r, PACE));
}
const script = parts.join("\n\n");

// --- Pass 3: image prompts spread across the full script ---
const imgSchema = { type: "object", properties: { imagePrompts: { type: "array", items: { type: "string" } } }, required: ["imagePrompts"] };
const imgPrompt = `Here is a narration script:

${script}

Produce EXACTLY ${sceneCount} image prompts, one per beat of the narration IN ORDER, evenly covering the whole script from start to finish. Each describes ONE simple scene drawable as a minimalist stick-figure doodle: a stick figure doing a clear action, or a single simple object/diagram (e.g. "a stick figure lying awake in bed", "a simple brain with one area glowing", "a stick figure running from a giant question mark"). One clear visual idea each. NO readable text, NO logos, NO realistic faces. Do not describe art style. Return JSON {"imagePrompts": [...]}.`;
const img = JSON.parse(await gemini(imgPrompt, imgSchema));
let imagePrompts: string[] = Array.isArray(img.imagePrompts) ? img.imagePrompts : [];
if (imagePrompts.length === 0) { console.error("no imagePrompts generated"); process.exit(1); }

const story = {
  title: plan.title,
  topic: plan.topic,
  description: plan.description,
  tags: plan.tags,
  onScreenTitle: plan.onScreenTitle,
  script,
  imagePrompts,
};
await writeFile("out/story.json", JSON.stringify(story, null, 1));
used.push(plan.title);
await writeFile("state/used-topics.json", JSON.stringify(used.slice(-300), null, 1));
const wc = script.split(/\s+/).filter(Boolean).length;
console.log(`✅ "${story.title}" — ${wc} words (~${Math.round(wc / 150)} min), ${imagePrompts.length} scenes`);
console.log(`   topic: ${story.topic}`);
