import "dotenv/config";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { generate } from "../lib/llm.js";

// Lean script generator for the video-clip pipeline: ONE LLM call -> punchy money-psychology
// script + metadata. No doodles, no per-scene SVGs. Dedups against state/used-topics.json.
const targetWords = Number(process.env.VIDEO_WORDS || 900);
const sceneCount = Number(process.env.VIDEO_SCENES || 9);
await mkdir("out", { recursive: true });
await mkdir("state", { recursive: true });
let used: string[] = [];
try { used = JSON.parse(await readFile("state/used-topics.json", "utf8")); } catch {}

const planSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    onScreenTitle: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    scenes: { type: "array", items: { type: "object", properties: { narration: { type: "string" } }, required: ["narration"] } },
  },
  required: ["title", "onScreenTitle", "description", "tags", "scenes"],
};

const planPrompt = `You write FACELESS YouTube explainers for "InfotainmentStu" — the PSYCHOLOGY OF MONEY & BEHAVIOR. Punchy, curiosity-driven, binge-worthy.

AVOID repeating any of these already-used topics (pick a clearly different angle): ${used.length ? used.join("; ") : "(none yet)"}.

Write ONE video of about ${targetWords} words of SPOKEN narration (~${Math.round(targetWords / 150)} min), in EXACTLY ${sceneCount} scenes that build a complete arc (hook -> tension -> the psychology -> a surprising insight -> a satisfying reframe).
- OPEN WITH A KILLER HOOK in the first 1-2 sentences — a bold claim, a vivid "you" scenario, or a counterintuitive question. No throat-clearing, no "in this video". Make people NEED the answer.
- Conversational and fast. Short, punchy sentences. Keep curiosity gaps open ("but here's the strange part…"). Second person ("you"). Accurate to real behavioral science — no invented studies, names, numbers, or quotes.
- Each scene "narration": 2-4 sentences (~${Math.round(targetWords / sceneCount)} words), flowing naturally from the previous scene.
- "title": curiosity-driven (<= 70 chars), e.g. "The Real Reason…" or "Why…".
- "onScreenTitle": punchy 2-4 words.
- "description": 2-3 sentences, then a blank line, then "InfotainmentStu — the psychology of money & behavior, explained simply."
- "tags": 8-12 tags.
Return JSON only.`;

const plan = JSON.parse(await generate(planPrompt, planSchema));
used.push(plan.title);
await writeFile("state/used-topics.json", JSON.stringify(used.slice(-300), null, 1));

const script = plan.scenes.map((s: any) => String(s.narration).trim()).filter(Boolean).join(" ");
await writeFile("out/story.json", JSON.stringify({ title: plan.title, topic: "money psychology", description: plan.description, tags: plan.tags, onScreenTitle: plan.onScreenTitle, script }, null, 1));
const wc = script.split(/\s+/).filter(Boolean).length;
console.log(`✅ script "${plan.title}" — ${wc} words (~${Math.round(wc / 150)} min), ${plan.scenes.length} scenes`);
