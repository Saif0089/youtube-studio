import "dotenv/config";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { generate } from "../lib/llm.js";

// Short-form script for the LOCAL Wan-video channel. Default niche: cinematic nature &
// wildlife wonder (plays to Wan's strengths — animals, landscapes, motion). Swap the niche
// via WAN_NICHE. ~130-160 words ≈ 50-60s. Writes out/story.json in the shared schema so the
// rest of the pipeline (narrate/timing/music/compose) is reused unchanged.
const niche = process.env.WAN_NICHE ||
  "astonishing nature & wildlife facts — one vivid animal or natural phenomenon per video, cinematic and awe-driven";
const targetWords = Number(process.env.WAN_WORDS || 140);
await mkdir("out", { recursive: true });
await mkdir("state", { recursive: true });
let used: string[] = [];
try { used = JSON.parse(await readFile("state/wan-used-topics.json", "utf8")); } catch {}

const schema = {
  type: "object",
  properties: {
    title: { type: "string" },
    onScreenTitle: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    sections: { type: "array", items: { type: "object", properties: {
      heading: { type: "string" }, narration: { type: "string" },
    }, required: ["heading", "narration"] } },
  },
  required: ["title", "onScreenTitle", "description", "tags", "sections"],
};

const prompt = `You write SHORT, punchy narration for a faceless YouTube channel about: ${niche}.

Already covered — do NOT reuse or closely rephrase: ${used.length ? used.join("; ") : "(none yet)"}.

Write ONE ~${targetWords}-word script (~50-60 seconds spoken) as an awe-driven micro-story:
- Open COLD with a startling, concrete image or fact in the first sentence — no "did you know", no greeting.
- Every sentence must be VISUAL and CONCRETE — describe things a camera could film (a specific animal, action, place, moment). This is critical: each sentence becomes a generated cinematic video shot.
- Build wonder, land on one memorable closing line.
- Keep sentences short and spoken-natural. Real, accurate facts only — never invent numbers or species.
- Split into 5-7 "sections", each with a 2-4 word "heading" (an on-screen chapter label) and 1-2 sentences of "narration".
- "title": curiosity-driven (<= 70 chars). "onScreenTitle": punchy 2-4 words. "tags": 8-12. "description": 2 sentences + a blank line + "Cinematic nature, generated frame by frame."
Return JSON only.`;

const plan = JSON.parse(await generate(prompt, schema));
const script = plan.sections.map((s: { narration: string }) => s.narration).join(" ");
used.push(plan.title);
await writeFile("state/wan-used-topics.json", JSON.stringify(used.slice(-300), null, 1));
await writeFile("out/story.json", JSON.stringify({
  title: plan.title, topic: "nature", description: plan.description, tags: plan.tags,
  onScreenTitle: plan.onScreenTitle, script, sections: plan.sections,
}, null, 1));
const wc = script.split(/\s+/).filter(Boolean).length;
console.log(`✅ Wan script "${plan.title}" — ${wc} words (~${Math.round(wc / 2.6)}s), ${plan.sections.length} sections`);
console.log(`\n--- SCRIPT ---\n${script}\n`);
plan.sections.forEach((s: { heading: string }, i: number) => console.log(`  ${i + 1}. ${s.heading}`));
