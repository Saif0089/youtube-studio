import "dotenv/config";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { generate } from "../lib/llm.js";
import { PRESET_NAMES } from "../remotion/doodlePresets.js";

const targetWords = Number(process.env.DOODLE_WORDS || 300);
const sceneCount = Number(process.env.DOODLE_SCENES || 8);
await mkdir("out", { recursive: true });
await mkdir("state", { recursive: true });
let used: string[] = [];
try { used = JSON.parse(await readFile("state/used-topics.json", "utf8")); } catch {}

// Pass 1: script broken into scenes (narration + a visual per scene)
const planSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    onScreenTitle: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    scenes: { type: "array", items: { type: "object", properties: { narration: { type: "string" }, visual: { type: "string" }, preset: { type: "string", enum: [...PRESET_NAMES] } }, required: ["narration", "visual", "preset"] } },
  },
  required: ["title", "onScreenTitle", "description", "tags", "scenes"],
};
const planPrompt = `You write videos for "InfotainmentStu", a channel about the PSYCHOLOGY OF MONEY & BEHAVIOR — curiosity explainers on why people spend, save, waste, chase, and self-sabotage with money, grounded in real behavioral science.

AVOID repeating any of these already-used titles/topics (pick a clearly different angle): ${used.length ? used.join("; ") : "(none yet)"}.

Write ONE video of about ${targetWords} words of spoken narration (~2 minutes), broken into EXACTLY ${sceneCount} SCENES that together tell a complete, building explanation (hook -> context -> the psychology -> a surprising insight -> satisfying reframe).
- Strong relatable HOOK in the first two sentences. Conversational, second-person ("you"). Accurate to real science — no invented studies, names, numbers, or quotes.
- For EACH scene give:
  - "narration": the spoken words for that scene (2-4 sentences, ~${Math.round(targetWords / sceneCount)} words).
  - "visual": a SHORT, simple description of ONE doodle CHARACTER clearly PERFORMING one action that illustrates the scene (e.g. "a person joyfully tossing money into the air", "a worried person staring at an empty wallet", "a person walking past shop windows"). One character + at most one simple prop.
  - "preset": the motion that best matches that action, chosen from: ${PRESET_NAMES.join(", ")}. (e.g. tossing money -> "toss"; celebrating -> "cheer"; clapping -> "clap"; dancing -> "dance"; walking/shopping -> "walk"; rushing -> "run"; jumping for joy -> "jump"; worrying -> "worry"; regret/facepalm -> "facepalm"; explaining/talking -> "gesture"; waving/greeting -> "wave"; pointing -> "point"; reaching/grabbing -> "reach"; counting money -> "count"; deciding/pondering -> "think"; looking around -> "look"; stretching/relaxed -> "stretch"; shrugging/unsure -> "shrug"; agreeing -> "nod"; refusing -> "shake"; excited -> "bounce"; calm standing -> "idle".) Vary the presets across scenes — avoid repeating the same one.
- "title": curiosity-driven YouTube title (<= 70 chars), e.g. starting "The Real Reason..." or "Why...".
- "onScreenTitle": punchy 2-4 word on-screen title.
- "description": 2-3 sentences then a blank line then "InfotainmentStu — the psychology of money & behavior, explained simply."
- "tags": 8-12 tags.
Return JSON only.`;

const plan = JSON.parse(await generate(planPrompt, planSchema));
used.push(plan.title);
await writeFile("state/used-topics.json", JSON.stringify(used.slice(-300), null, 1));

// Pass 2: a transparent, RIGGED doodle-host character SVG per scene (composited over a photo).
// Parts are tagged so the renderer can animate them with a preset (see doodlePresets.ts).
const svgPrompt = (visual: string) => `Draw ONE friendly hand-drawn DOODLE CHARACTER as inline SVG — a single character (optionally one small prop) on a TRANSPARENT background, ALREADY POSED performing this action: ${visual}.

RIG — build the character UPRIGHT and FACING FORWARD on the 0..1000 canvas, centered, and put each movable part in its OWN <g> with EXACTLY these class names so it can be animated:
- <g class="rig"> wraps the WHOLE character.
- Inside it: <g class="d-body"> (torso); <g class="d-head"> (head + face, drawn ABOVE the body so the head's BOTTOM edge meets the neck); <g class="d-arm-l"> and <g class="d-arm-r"> (arms — draw each hanging from its shoulder so the TOP of the arm group is the shoulder joint); <g class="d-leg-l"> and <g class="d-leg-r"> (legs — draw each from the hip down so the TOP of the leg group is the hip joint). Any handheld prop -> <g class="d-prop">.
- Each part is a SEPARATE group whose joint sits at the TOP (arms/legs) or BOTTOM (head) of its own shape, so rotating it looks natural.

STYLE — match exactly:
- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"> with NO background rect (fully transparent).
- Cute, WELL-PROPORTIONED character centered, filling most of the box. Thick black outlines (#1d1d1d, stroke-width 10-16), bright flat fills (teal #2bb3a3, red #e8503a, blue #3a6ea5, yellow #ffd23f, skin #ffe2c2). Round head, tube limbs. No gradients, no shading, no text/letters/numbers, no scenery or background.
- Build ONLY from primitives: <circle> <ellipse> <rect> <line> <path> <polygon>.

Output ONLY the raw <svg>...</svg> markup. No markdown, no explanation.`;

// Sequential SVG generation — concurrent `claude` CLI processes contend/hang on CI, so
// generate one at a time. This pool of doodles is reused across the video's sentences.
const scenes: { narration: string; visual: string; preset: string; svg: string }[] = [];
for (let i = 0; i < plan.scenes.length; i++) {
  const sc = plan.scenes[i];
  let svg = (await generate(svgPrompt(sc.visual))).trim();
  const m = svg.match(/<svg[\s\S]*<\/svg>/i);
  if (m) svg = m[0];
  scenes.push({ narration: sc.narration, visual: sc.visual, preset: sc.preset || "idle", svg });
  console.log(`  scene ${i + 1}/${plan.scenes.length} [${sc.preset}]: ${svg.length} bytes — ${sc.visual.slice(0, 46)}`);
}

const script = scenes.map((s) => s.narration).join(" ");
await writeFile("out/story.json", JSON.stringify({ title: plan.title, topic: "money psychology", description: plan.description, tags: plan.tags, onScreenTitle: plan.onScreenTitle, script }, null, 1));
await writeFile("out/scenes.json", JSON.stringify(scenes, null, 1));
console.log(`✅ doodle video "${plan.title}" — ${scenes.length} scenes, ${script.split(/\s+/).filter(Boolean).length} words`);
