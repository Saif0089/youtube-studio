import "dotenv/config";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { generate } from "../lib/llm.js";

// Two-pass script generator, retention-first: plan a tight arc with REAL, verifiable
// psychology (named experiments that actually exist), then write each section with
// concrete scenes, open loops, and a payoff roughly every 45 seconds. ~5 minutes dense.
const targetWords = Number(process.env.VIDEO_WORDS || 850);       // ~5 min at ~175 wpm
const sections = Number(process.env.VIDEO_SCENES || 8);
const wordsPerSection = Math.max(30, Math.round(targetWords / sections));
await mkdir("out", { recursive: true });
await mkdir("state", { recursive: true });
let used: string[] = [];
try { used = JSON.parse(await readFile("state/used-topics.json", "utf8")); } catch {}

// Pass 1: plan the arc
const planSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    onScreenTitle: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    openLoop: { type: "string" },
    sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, summary: { type: "string" }, device: { type: "string" } }, required: ["heading", "summary", "device"] } },
  },
  required: ["title", "onScreenTitle", "description", "tags", "openLoop", "sections"],
};
const planPrompt = `You plan FACELESS YouTube explainers for "InfotainmentStu" — the PSYCHOLOGY OF MONEY & BEHAVIOR. The bar: a bored viewer at minute 3 must still NEED to know what happens next.

Already covered — do NOT reuse these OR any close rephrasing of the same idea: ${used.length ? used.join("; ") : "(none yet)"}.

Draw from the WIDE space of behavioral money psychology and pick ONE concept clearly DIFFERENT from everything above — e.g. loss aversion, sunk-cost fallacy, anchoring, mental accounting, lifestyle inflation, endowment effect, scarcity mindset, hyperbolic discounting, decoy pricing, social comparison, money scripts from childhood, windfall spending, subscription creep, the Diderot effect, revenge spending, the IKEA effect, present bias — or another well-established one.

GROUND IT IN REALITY — this is the most important rule:
- Use ONLY real, well-documented psychology: experiments and researchers that actually exist (e.g. Kahneman & Tversky's loss-aversion work, Mischel's marshmallow studies, Thaler's mental accounting, Ariely's decoy pricing demos, the Dunn/Norton spending-and-happiness research). Retell them VIVIDLY but accurately.
- NEVER invent facts, numbers, or names. If you don't know an exact figure, describe it qualitatively ("most people", "a large majority").

Plan ONE video in EXACTLY ${sections} sections with a strong arc: cold-open story hook → the trap revealed → the real experiment → escalation ("it gets worse") → the twist → the reframe/fix.
- "openLoop": one sentence of unfinished business planted in section 1 and paid off in the LAST section (e.g. "the one-question test that reveals if you're doing this").
- Each section: "heading" = a punchy 2-4 word ON-SCREEN chapter card ("THE $99 TRICK", "YOUR BRAIN LIES"); "summary" = 1-2 sentences of what it covers; "device" = the retention device it uses ("story", "real experiment", "concrete scene", "twist", "payoff", "question").
- At least: one famous REAL experiment retold as a scene, TWO concrete second-person everyday scenes (checkout line, food app at 11pm, the gym membership you forgot), and the open loop resolved at the end.
- "title": curiosity-driven (<= 70 chars). "onScreenTitle": punchy 2-4 words. "tags": 8-12. "description": 2-3 sentences, blank line, then "InfotainmentStu — the psychology of money & behavior, explained simply."
Return JSON only.`;

const plan = JSON.parse(await generate(planPrompt, planSchema));
console.log(`planned "${plan.title}" — ${plan.sections.length} sections, loop: ${plan.openLoop}`);
used.push(plan.title);
await writeFile("state/used-topics.json", JSON.stringify(used.slice(-300), null, 1));

// Pass 2: write each section
const parts: string[] = [];
for (let i = 0; i < plan.sections.length; i++) {
  const sec = plan.sections[i];
  const first = i === 0, last = i === plan.sections.length - 1;
  const role = first
    ? `OPENING — drop the viewer INTO a concrete scene or real story mid-action within the first sentence. No greetings, no "in this video". Before this section ends, plant the open loop: "${plan.openLoop}".`
    : last
      ? `FINAL section — resolve the open loop ("${plan.openLoop}") with a satisfying, practical payoff, then land one thought that reframes everything. No "in conclusion".`
      : `Keep momentum: open on a concrete beat, end leaning into the next section ("but that's not even the strange part…" energy — without using that exact phrase).`;
  const prevTail = parts.length ? parts[parts.length - 1].split(/\s+/).slice(-30).join(" ") : "";
  const secPrompt = `You are writing SPOKEN narration for a money-psychology explainer. Title: "${plan.title}".
Write ONLY the narration for this section: "${sec.heading}" — ${sec.summary} (retention device: ${sec.device})
Write the FULL ~${wordsPerSection} words. ${role}
STYLE RULES:
- Short, punchy sentences. Second person. Present tense where possible.
- EVERY paragraph needs something CONCRETE: a place, an object, an action, a real researcher/experiment, or a vivid scene. Zero abstract filler ("it's interesting that", "studies show that people often").
- Real facts only — retell real experiments vividly; never invent numbers or names. Qualitative beats fabricated.
- No headings, no lists, no markdown, no stage directions.${prevTail ? ` The previous section ended: "…${prevTail}". Continue smoothly, no repetition.` : ""}
Return ONLY the narration text.`;
  const txt = (await generate(secPrompt)).trim();
  parts.push(txt);
  console.log(`  section ${i + 1}/${plan.sections.length} [${sec.device}]: ${txt.split(/\s+/).filter(Boolean).length} words`);
}

const script = parts.join(" ");
const sectionsOut = plan.sections.map((s: { heading: string }, i: number) => ({ heading: s.heading, narration: parts[i] }));
await writeFile("out/story.json", JSON.stringify({
  title: plan.title, topic: "money psychology", description: plan.description, tags: plan.tags,
  onScreenTitle: plan.onScreenTitle, script, sections: sectionsOut,
}, null, 1));
const wc = script.split(/\s+/).filter(Boolean).length;
console.log(`✅ script "${plan.title}" — ${wc} words (~${Math.round(wc / 175)} min), ${plan.sections.length} sections`);
