import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { generate } from "../lib/llm.js";

await mkdir("out", { recursive: true });

// Pass 1: script broken into scenes (narration + a visual description per scene)
const planSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    onScreenTitle: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    scenes: {
      type: "array",
      items: { type: "object", properties: { narration: { type: "string" }, visual: { type: "string" } }, required: ["narration", "visual"] },
    },
  },
  required: ["title", "onScreenTitle", "description", "tags", "scenes"],
};
const planPrompt = `Write a punchy YouTube SHORT (~110 words total, ~40-50s spoken) about the PSYCHOLOGY OF MONEY & BEHAVIOR.
- Strong scroll-stopping hook in the FIRST sentence (a question or bold claim).
- Spoken narration only, second-person ("you"), punchy and conversational, accurate to real behavioral science (no invented studies, numbers, or quotes).
- End with a short CTA: the full breakdown is on the channel, subscribe.
- Break it into EXACTLY 4 SCENES. For each scene give:
  - "narration": the spoken words for that scene (1-2 sentences).
  - "visual": a SHORT, simple description of ONE doodle that illustrates the scene — a single character doing one clear action plus simple props (e.g. "a person holding an empty wallet as coins float away"). Must work in a TALL vertical 9:16 frame.
- "title": YouTube title <= 80 chars, ending " #shorts".
- "onScreenTitle": punchy 2-4 word hook.
- "description": 1-2 sentences then " #shorts #money #psychology #finance".
- "tags": 6-10 tags.
Return JSON only.`;

const plan = JSON.parse(await generate(planPrompt, planSchema));

// Pass 2: a doodle SVG per scene
const svgPrompt = (visual: string) => `Draw ONE clean, flat, friendly hand-drawn DOODLE as inline SVG, for a TALL vertical 9:16 video frame.

SCENE: ${visual}

STYLE — match exactly:
- Root: <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"> and a full-size background <rect> filled #fffdf8.
- Thick black outlines (#1d1d1d, stroke-width 7-11), bright flat color fills (teal #2bb3a3, red #e8503a, blue #3a6ea5, yellow #ffd23f, skin #ffe2c2). Simple cute WELL-PROPORTIONED shapes: round head, simple body, tube limbs. No gradients, no shading, no text/letters/numbers.
- Build ONLY from primitives: <circle> <ellipse> <rect> <line> <path> <polygon>, grouped with <g>.
- Put the main subject in the CENTER of the tall frame, leaving clear empty space in the TOP fifth (for a title) and BOTTOM third (for captions).

ANIMATION — add a class to elements that should move:
- class="anim-bob" on the main character group.
- class="anim-float" on airborne things (money, bubbles).
- class="anim-spin" on round rotating things (coins, suns, wheels).
- class="anim-sway" on tall rocking things (plants, signs).

Output ONLY the raw <svg>...</svg> markup. No markdown, no explanation.`;

// Generate scene SVGs concurrently (pool of workers) to cut Claude-call wall-clock.
const CONC = Number(process.env.DOODLE_CONCURRENCY || 4);
const scenes: { narration: string; visual: string; svg: string }[] = new Array(plan.scenes.length);
let nextScene = 0;
async function svgWorker() {
  for (let i = nextScene++; i < plan.scenes.length; i = nextScene++) {
    const sc = plan.scenes[i];
    let svg = (await generate(svgPrompt(sc.visual))).trim();
    const m = svg.match(/<svg[\s\S]*<\/svg>/i);
    if (m) svg = m[0];
    scenes[i] = { narration: sc.narration, visual: sc.visual, svg };
    console.log(`  scene ${i + 1}/${plan.scenes.length}: ${svg.length} bytes — ${sc.visual.slice(0, 50)}`);
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, plan.scenes.length) }, () => svgWorker()));

const script = scenes.map((s) => s.narration).join(" ");
await writeFile(
  "out/story.json",
  JSON.stringify({ title: plan.title, topic: "money psychology short", description: plan.description, tags: plan.tags, onScreenTitle: plan.onScreenTitle, script }, null, 1),
);
await writeFile("out/scenes.json", JSON.stringify(scenes, null, 1));
console.log(`✅ doodle short "${plan.title}" — ${scenes.length} scenes, ${script.split(/\s+/).filter(Boolean).length} words`);
