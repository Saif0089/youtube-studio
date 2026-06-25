import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { generate } from "../lib/llm.js";

const targetWords = Number(process.env.DOODLE_WORDS || 300);
const sceneCount = Number(process.env.DOODLE_SCENES || 8);
await mkdir("out", { recursive: true });

// Pass 1: script broken into scenes (narration + a visual per scene)
const planSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    onScreenTitle: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    scenes: { type: "array", items: { type: "object", properties: { narration: { type: "string" }, visual: { type: "string" } }, required: ["narration", "visual"] } },
  },
  required: ["title", "onScreenTitle", "description", "tags", "scenes"],
};
const planPrompt = `You write videos for "InfotainmentStu", a channel about the PSYCHOLOGY OF MONEY & BEHAVIOR — curiosity explainers on why people spend, save, waste, chase, and self-sabotage with money, grounded in real behavioral science.

Write ONE video of about ${targetWords} words of spoken narration (~2 minutes), broken into EXACTLY ${sceneCount} SCENES that together tell a complete, building explanation (hook -> context -> the psychology -> a surprising insight -> satisfying reframe).
- Strong relatable HOOK in the first two sentences. Conversational, second-person ("you"). Accurate to real science — no invented studies, names, numbers, or quotes.
- For EACH scene give:
  - "narration": the spoken words for that scene (2-4 sentences, ~${Math.round(targetWords / sceneCount)} words).
  - "visual": a SHORT, simple description of ONE doodle illustrating that scene — a single character doing one clear action plus simple props. Must work in a WIDE 16:9 frame.
- "title": curiosity-driven YouTube title (<= 70 chars), e.g. starting "The Real Reason..." or "Why...".
- "onScreenTitle": punchy 2-4 word on-screen title.
- "description": 2-3 sentences then a blank line then "InfotainmentStu — the psychology of money & behavior, explained simply."
- "tags": 8-12 tags.
Return JSON only.`;

const plan = JSON.parse(await generate(planPrompt, planSchema));

// Pass 2: a wide doodle SVG per scene
const svgPrompt = (visual: string) => `Draw ONE clean, flat, friendly hand-drawn DOODLE as inline SVG, for a WIDE 16:9 video frame.

SCENE: ${visual}

STYLE — match exactly:
- Root: <svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"> and a full-size background <rect> filled #fffdf8.
- Thick black outlines (#1d1d1d, stroke-width 7-11), bright flat color fills (teal #2bb3a3, red #e8503a, blue #3a6ea5, yellow #ffd23f, skin #ffe2c2). Simple cute WELL-PROPORTIONED shapes: round head, simple body, tube limbs. No gradients, no shading, no text/letters/numbers.
- Build ONLY from primitives: <circle> <ellipse> <rect> <line> <path> <polygon>, grouped with <g>.
- Compose for a WIDE frame: place the subject and props spread across the width, and leave clear empty space in the BOTTOM fifth for captions.

ANIMATION — add a class to elements that should move:
- class="anim-bob" on the main character group.
- class="anim-float" on airborne things (money, bubbles).
- class="anim-spin" on round rotating things (coins, suns, wheels).
- class="anim-sway" on tall rocking things (plants, signs).

Output ONLY the raw <svg>...</svg> markup. No markdown, no explanation.`;

// Sequential SVG generation — concurrent `claude` CLI processes contend/hang on CI, so
// generate one at a time. Keep the scene count modest so the (slower) render fits the timeout.
const scenes: { narration: string; visual: string; svg: string }[] = [];
for (let i = 0; i < plan.scenes.length; i++) {
  const sc = plan.scenes[i];
  let svg = (await generate(svgPrompt(sc.visual))).trim();
  const m = svg.match(/<svg[\s\S]*<\/svg>/i);
  if (m) svg = m[0];
  scenes.push({ narration: sc.narration, visual: sc.visual, svg });
  console.log(`  scene ${i + 1}/${plan.scenes.length}: ${svg.length} bytes — ${sc.visual.slice(0, 50)}`);
}

const script = scenes.map((s) => s.narration).join(" ");
await writeFile("out/story.json", JSON.stringify({ title: plan.title, topic: "money psychology", description: plan.description, tags: plan.tags, onScreenTitle: plan.onScreenTitle, script }, null, 1));
await writeFile("out/scenes.json", JSON.stringify(scenes, null, 1));
console.log(`✅ doodle video "${plan.title}" — ${scenes.length} scenes, ${script.split(/\s+/).filter(Boolean).length} words`);
