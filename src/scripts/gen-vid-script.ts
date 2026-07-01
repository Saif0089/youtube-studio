import "dotenv/config";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { generate } from "../lib/llm.js";

// Two-pass script generator for the video-clip pipeline: plan the arc, then write each section
// in its OWN call. One-shot generation chronically under-writes (a "1200-word" ask comes back
// ~750 words); per-section generation reliably hits the target length AND reads deeper/engaging.
const targetWords = Number(process.env.VIDEO_WORDS || 1400);      // ~8 min at edge-tts's ~175 wpm
const sections = Number(process.env.VIDEO_SCENES || 12);
const wordsPerSection = Math.max(30, Math.round(targetWords / sections));
await mkdir("out", { recursive: true });
await mkdir("state", { recursive: true });
let used: string[] = [];
try { used = JSON.parse(await readFile("state/used-topics.json", "utf8")); } catch {}

// Pass 1: plan the title/metadata + section arc
const planSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    onScreenTitle: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, summary: { type: "string" } }, required: ["heading", "summary"] } },
  },
  required: ["title", "onScreenTitle", "description", "tags", "sections"],
};
const planPrompt = `You plan FACELESS YouTube explainers for "InfotainmentStu" — the PSYCHOLOGY OF MONEY & BEHAVIOR. Binge-worthy, curiosity-driven, genuinely fascinating.

AVOID repeating any of these already-used topics (pick a clearly different angle): ${used.length ? used.join("; ") : "(none yet)"}.

Plan ONE video with a strong narrative arc told in EXACTLY ${sections} sections: hook -> stakes -> the core psychology -> escalating, surprising insights -> a twist -> a satisfying reframe.
- Pick a genuinely interesting, REAL money-psychology question grounded in well-established behavioral science. No invented studies, names, numbers, or quotes.
- "title": curiosity-driven (<= 70 chars), e.g. "The Real Reason…" or "Why…".
- "onScreenTitle": punchy 2-4 words.
- "description": 2-3 sentences, then a blank line, then "InfotainmentStu — the psychology of money & behavior, explained simply."
- "tags": 8-12 tags.
- "sections": EXACTLY ${sections} sections, each with a "heading" and a 1-2 sentence "summary". In order, building on each other, no overlap. The FIRST is the hook; the LAST is the reframe.
Return JSON only.`;

const plan = JSON.parse(await generate(planPrompt, planSchema));
console.log(`planned "${plan.title}" — ${plan.sections.length} sections`);
used.push(plan.title);
await writeFile("state/used-topics.json", JSON.stringify(used.slice(-300), null, 1));

// Pass 2: write the FULL narration for each section (this is what actually hits the length)
const parts: string[] = [];
for (let i = 0; i < plan.sections.length; i++) {
  const sec = plan.sections[i];
  const first = i === 0, last = i === plan.sections.length - 1;
  const role = first
    ? "This is the OPENING — land a killer hook in the first two sentences (a bold claim, a vivid 'you' scenario, or a counterintuitive question). No throat-clearing, no 'in this video'."
    : last
      ? "This is the FINAL section — deliver a satisfying, thought-provoking reframe that recontextualizes everything (no 'in conclusion')."
      : "Keep momentum: open with a hook or a curiosity gap, and end leaning into the next idea.";
  const prevTail = parts.length ? parts[parts.length - 1].split(/\s+/).slice(-30).join(" ") : "";
  const secPrompt = `You are writing the SPOKEN narration for a money & behavior psychology explainer. Title: "${plan.title}".
Write ONLY the narration for this section: "${sec.heading}" — ${sec.summary}
Write the FULL ~${wordsPerSection} words — do NOT write short; hit that length. ${role}
Fast and conversational, second person ("you"), short punchy sentences, vivid and specific. Accurate to real behavioral science — no invented studies, names, numbers, or quotes. No headings, no stage directions, no lists, no markdown.${prevTail ? ` The previous section ended: "…${prevTail}". Continue smoothly with no repetition.` : ""}
Return ONLY the narration text.`;
  const txt = (await generate(secPrompt)).trim();
  parts.push(txt);
  console.log(`  section ${i + 1}/${plan.sections.length}: ${txt.split(/\s+/).filter(Boolean).length} words`);
}

const script = parts.join(" ");
await writeFile("out/story.json", JSON.stringify({ title: plan.title, topic: "money psychology", description: plan.description, tags: plan.tags, onScreenTitle: plan.onScreenTitle, script }, null, 1));
const wc = script.split(/\s+/).filter(Boolean).length;
console.log(`✅ script "${plan.title}" — ${wc} words (~${Math.round(wc / 175)} min), ${plan.sections.length} sections`);
