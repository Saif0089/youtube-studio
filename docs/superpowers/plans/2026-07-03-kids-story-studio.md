# Kids Story Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-dollar pipeline in a new `kids-studio` repo that turns user-pasted ChatGPT story JSON into ~7-min 3D-animated kids' episodes (fixed VRoid cast, Blender/Eevee) and uploads them made-for-kids to a new YouTube channel.

**Architecture:** Two phases. Phase A (interactive, Blender-MCP-driven, user approval gates): build the reusable studio — cast, 5 sets, motion library, lip-sync rig. Phase B (scripted, unattended): `npm run episode` consumes `stories/queue/*.json` → edge-tts voices → Rhubarb lip-sync → `assembler.py` builds the scene in Blender → Eevee render → ffmpeg mux → made-for-kids upload → Discord ping. No LLM at render time.

**Tech Stack:** Node ≥20 ESM + tsx + vitest, Python (Blender 5.0 scripting), Blender MCP (authoring only), VRoid Studio, Mixamo, Rhubarb Lip Sync, edge-tts (via uv), ffmpeg, googleapis, Discord webhook.

## Global Constraints

- **$0 marginal cost**: no paid APIs anywhere in the episode path. Stories come from user-pasted ChatGPT output.
- **Modesty (firm)**: characters fully, modestly dressed; no immodest/scary/violent content — enforced in the master prompt AND the validator's content checks.
- Format: ages 4–8, ~7 min, 1080p24, episode every 2–3 days, renders on the user's Mac (M3 Pro).
- Uploads: new channel, `selfDeclaredMadeForKids: true`, Discord ✅/🔴 pings.
- Blender binary: `/Applications/Blender.app/Contents/MacOS/Blender` (5.0.1). New repo: `~/Documents/LocalProject/kids-studio`.
- Approval gates (user must approve before continuing): Gate 1 cast portraits, Gate 2 set beauty-shots, Gate 3 20-sec test scene.

## File Structure (new repo `kids-studio`)

```
package.json, tsconfig.json, vitest.config.ts, .gitignore, .env(untracked)
studio/registry.json          # single source of truth: characters, voices, sets, marks, cameras, actions
studio/cast/*.vrm|.blend      # Phase A output (gitignored: *.blend, *.vrm are big — kept local)
studio/sets/*.blend
studio/actions/actions.blend  # Mixamo action library
prompts/master-prompt.md      # what the user pastes into ChatGPT
stories/queue/ stories/done/ stories/failed/
src/lib/registry.ts           # load + type the registry
src/lib/discord.ts            # ping helper
src/validate-episode.ts       # schema + registry + content validation
src/voices.ts                 # per-line edge-tts -> out/audio/*.mp3 + out/timeline.json
tools/edge_line.py            # uv-run edge-tts helper (one line -> mp3 + duration)
src/lipsync.ts                # rhubarb per dialogue line -> out/visemes/*.json
src/render.ts                 # drives Blender: assembler.py with episode inputs
blender/assembler.py          # builds + renders the episode inside Blender
blender/lib_studio.py         # shared Blender helpers (load set/cast, actions, camera, eevee)
src/compose.ts                # ffmpeg: frames+audio+music bed -> out/episode.mp4
src/music.ts                  # gentle synthesized music bed (ffmpeg sine pads)
src/youtube/{auth,uploader}.ts# copied from youtube-studio, + madeForKids
src/publish.ts                # upload + Discord
src/episode.ts                # orchestrator: queue -> ... -> publish
test/*.test.ts                # vitest
```

---

## PHASE B CODE FIRST (Tasks 1–5), because the factory code is testable without any 3D assets; Phase A authoring (Tasks 6–8) then plugs assets into a working pipeline; integration closes it (Tasks 9–14).

### Task 1: Repo scaffold

**Files:**
- Create: `~/Documents/LocalProject/kids-studio/{package.json,tsconfig.json,vitest.config.ts,.gitignore,.env.example}`
- Create: dirs `src/lib src/youtube blender tools prompts stories/{queue,done,failed} studio/{cast,sets,actions} test out`

**Interfaces:**
- Produces: npm scripts `test`, `episode`, `validate`; ESM TS project all later tasks live in.

- [ ] **Step 1: Create the repo and scaffold**

```bash
mkdir -p ~/Documents/LocalProject/kids-studio && cd ~/Documents/LocalProject/kids-studio
git init -b main
mkdir -p src/lib src/youtube blender tools prompts stories/queue stories/done stories/failed studio/cast studio/sets studio/actions test out
```

`package.json`:
```json
{
  "name": "kids-studio",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "validate": "tsx src/validate-episode.ts",
    "episode": "tsx src/episode.ts"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "dotenv": "^16.4.5",
    "googleapis": "^144.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "skipLibCheck": true, "resolveJsonModule": true, "noEmit": true
  },
  "include": ["src", "test"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

`.gitignore`:
```
node_modules
.env
out/
studio/**/*.blend
studio/**/*.blend1
studio/**/*.vrm
studio/**/*.fbx
stories/done/
stories/failed/
tools/rhubarb/
```

`.env.example`:
```
YT_CLIENT_ID=
YT_CLIENT_SECRET=
YT_REFRESH_TOKEN=            # minted for the NEW kids channel
DISCORD_WEBHOOK=
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender
PUBLISH_MODE=approval        # approval = private upload; auto = schedule public
```

- [ ] **Step 2: Install + sanity check**

Run: `npm install && npx vitest run`
Expected: "No test files found" (exit 0 with passWithNoTests false is exit 1 — add a trivial test in Task 2; for now expect the no-tests message).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold kids-studio"
```

---

### Task 2: Registry + episode validator (TDD)

The registry is the single source of truth for what the studio owns; the validator rejects any episode that references unknown assets or violates content rules.

**Files:**
- Create: `studio/registry.json`, `src/lib/registry.ts`, `src/validate-episode.ts`
- Test: `test/validate.test.ts`

**Interfaces:**
- Produces:
  - `type Registry = { characters: Record<string,{voice:string; pitch?:string}>; narratorVoice: string; sets: Record<string,{marks:string[]; cameras:string[]}>; actions: string[] }`
  - `loadRegistry(): Registry`
  - `type Episode = { title:string; moral:string; scenes: Scene[] }`
  - `type Scene = { set:string; cast:Record<string,{mark:string; action:string}>; narration?:string; dialogue?: {speaker:string; line:string}[] }`
  - `validateEpisode(ep:unknown, reg:Registry): { ok:true; episode:Episode } | { ok:false; errors:string[] }`

- [ ] **Step 1: Write `studio/registry.json`** (initial cast/set/action names — Phase A must build exactly these)

```json
{
  "narratorVoice": "en-US-JennyNeural",
  "characters": {
    "Zayd": { "voice": "en-GB-MaisieNeural", "pitch": "-4Hz" },
    "Maryam": { "voice": "en-US-AnaNeural" }
  },
  "sets": {
    "bedroom":  { "marks": ["A", "B"], "cameras": ["wide", "closeA", "closeB"] },
    "kitchen":  { "marks": ["A", "B"], "cameras": ["wide", "closeA", "closeB"] },
    "park":     { "marks": ["A", "B", "C"], "cameras": ["wide", "closeA", "closeB"] },
    "forest":   { "marks": ["A", "B"], "cameras": ["wide", "closeA", "closeB"] },
    "street":   { "marks": ["A", "B"], "cameras": ["wide", "closeA", "closeB"] }
  },
  "actions": ["idle", "talk", "walk", "run", "jump", "wave", "sit", "clap", "laugh", "point",
              "look_around", "think", "cheer", "nod", "shake_head", "pick_up", "hug", "scared",
              "sleep", "stretch", "dance_happy", "kneel", "sneak", "surprised", "yawn"]
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// test/validate.test.ts
import { describe, it, expect } from "vitest";
import { validateEpisode } from "../src/validate-episode.js";
import { loadRegistry } from "../src/lib/registry.js";

const reg = loadRegistry();
const good = {
  title: "The Lost Kitten", moral: "kindness",
  scenes: [{
    set: "park",
    cast: { Zayd: { mark: "A", action: "idle" }, Maryam: { mark: "B", action: "wave" } },
    narration: "One sunny day, Zayd and Maryam heard a tiny meow.",
    dialogue: [{ speaker: "Maryam", line: "Did you hear that?" }]
  }]
};

describe("validateEpisode", () => {
  it("accepts a well-formed episode", () => {
    const r = validateEpisode(good, reg);
    expect(r.ok).toBe(true);
  });
  it("rejects unknown set / character / action / mark", () => {
    const bad = structuredClone(good) as any;
    bad.scenes[0].set = "moon";
    bad.scenes[0].cast.Bob = { mark: "A", action: "idle" };
    bad.scenes[0].cast.Zayd.action = "backflip";
    bad.scenes[0].cast.Maryam.mark = "Z";
    const r = validateEpisode(bad, reg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
  it("rejects dialogue from a character not on stage", () => {
    const bad = structuredClone(good) as any;
    bad.scenes[0].dialogue.push({ speaker: "Zaynab", line: "hi" });
    expect(validateEpisode(bad, reg).ok).toBe(false);
  });
  it("rejects banned content words", () => {
    const bad = structuredClone(good) as any;
    bad.scenes[0].narration = "Then the zombie attacked with a gun.";
    expect(validateEpisode(bad, reg).ok).toBe(false);
  });
  it("rejects empty scenes or missing title", () => {
    expect(validateEpisode({ title: "", moral: "x", scenes: [] }, reg).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/validate.test.ts` — Expected: FAIL (modules missing).

- [ ] **Step 4: Implement**

```ts
// src/lib/registry.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type Registry = {
  narratorVoice: string;
  characters: Record<string, { voice: string; pitch?: string }>;
  sets: Record<string, { marks: string[]; cameras: string[] }>;
  actions: string[];
};
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export function loadRegistry(): Registry {
  return JSON.parse(readFileSync(join(root, "studio", "registry.json"), "utf8"));
}
```

```ts
// src/validate-episode.ts
import { loadRegistry, type Registry } from "./lib/registry.js";

export type Scene = {
  set: string;
  cast: Record<string, { mark: string; action: string }>;
  narration?: string;
  dialogue?: { speaker: string; line: string }[];
};
export type Episode = { title: string; moral: string; scenes: Scene[] };

// Kid-safety + modesty guard on story text (defense in depth; the master prompt also forbids these).
const BANNED = /\b(gun|knife|blood|kill|dead|die|zombie|ghost|demon|devil|hell|monster attack|kiss|boyfriend|girlfriend|naked|underwear|beer|wine|drunk|cigarette|drug)\b/i;

export function validateEpisode(ep: unknown, reg: Registry): { ok: true; episode: Episode } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const e = ep as Episode;
  if (!e || typeof e !== "object") return { ok: false, errors: ["not an object"] };
  if (!e.title?.trim()) errors.push("missing title");
  if (!e.moral?.trim()) errors.push("missing moral");
  if (!Array.isArray(e.scenes) || e.scenes.length === 0) errors.push("no scenes");
  for (const [i, s] of (e.scenes ?? []).entries()) {
    const at = `scene ${i + 1}`;
    const set = reg.sets[s.set];
    if (!set) { errors.push(`${at}: unknown set "${s.set}"`); continue; }
    const onStage = Object.keys(s.cast ?? {});
    if (!onStage.length) errors.push(`${at}: empty cast`);
    for (const [name, c] of Object.entries(s.cast ?? {})) {
      if (!reg.characters[name]) errors.push(`${at}: unknown character "${name}"`);
      if (!set.marks.includes(c.mark)) errors.push(`${at}: unknown mark "${c.mark}" in ${s.set}`);
      if (!reg.actions.includes(c.action)) errors.push(`${at}: unknown action "${c.action}"`);
    }
    for (const d of s.dialogue ?? []) {
      if (!onStage.includes(d.speaker)) errors.push(`${at}: speaker "${d.speaker}" not on stage`);
      if (BANNED.test(d.line)) errors.push(`${at}: banned content in dialogue`);
    }
    if (s.narration && BANNED.test(s.narration)) errors.push(`${at}: banned content in narration`);
    if (!s.narration && !(s.dialogue?.length)) errors.push(`${at}: scene has no narration and no dialogue`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, episode: e };
}

// CLI: npm run validate stories/queue/foo.json
if (process.argv[2]) {
  const { readFileSync } = await import("node:fs");
  const r = validateEpisode(JSON.parse(readFileSync(process.argv[2], "utf8")), loadRegistry());
  if (r.ok) console.log("✅ valid");
  else { console.error("❌ " + r.errors.join("\n❌ ")); process.exit(1); }
}
```

- [ ] **Step 5: Run tests** — `npx vitest run` — Expected: PASS (5 tests).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: registry + episode validator with kid-safety guard"`

---

### Task 3: Master ChatGPT prompt

**Files:**
- Create: `prompts/master-prompt.md`

**Interfaces:**
- Consumes: names from `studio/registry.json` (must match EXACTLY).
- Produces: the file the user pastes into ChatGPT; ChatGPT's reply is saved as `stories/queue/<slug>.json`.

- [ ] **Step 1: Write the prompt** (registry names embedded verbatim)

````markdown
# Master Prompt — paste everything below into ChatGPT

You are the story writer for a 3D-animated YouTube show for children aged 4–8.
Write ONE complete episode as a single JSON object — and NOTHING else, no prose, no markdown fences.

THE SHOW: Two siblings, Zayd (7, curious, brave) and Maryam (5, kind, funny, loves animals),
have gentle everyday adventures and learn a small good lesson (honesty, kindness, patience,
sharing, gratitude, courage, cleanliness, helping parents).

STRICT CONTENT RULES:
- Wholesome, family-safe, Islamically appropriate. No violence, weapons, scary monsters,
  ghosts, magic spells, romance, or disrespect. Modest and kind throughout.
- Simple words a 5-year-old follows. Short sentences. Warm, gentle humor is welcome.

FORMAT — return exactly this JSON shape:
{
  "title": "<catchy episode title, <= 60 chars>",
  "moral": "<one word or short phrase>",
  "scenes": [ 8 to 12 scenes, each:
    {
      "set": one of: "bedroom" | "kitchen" | "park" | "forest" | "street",
      "cast": { "<CharacterName>": { "mark": "A"|"B"|"C(park only)", "action": "<one action>" } },
      "narration": "<1-3 sentences the narrator reads (optional if dialogue present)>",
      "dialogue": [ { "speaker": "Zayd"|"Maryam", "line": "<one short spoken line>" } ]
    }
  ]
}

RULES:
- Characters may ONLY be "Zayd" and "Maryam". Speakers must be on stage in that scene's "cast".
- "action" must be ONE of exactly: idle, talk, walk, run, jump, wave, sit, clap, laugh, point,
  look_around, think, cheer, nod, shake_head, pick_up, hug, scared, sleep, stretch, dance_happy,
  kneel, sneak, surprised, yawn.
- Total spoken words (all narration + all dialogue) between 850 and 1000 — this makes a ~7 minute
  episode. Count carefully.
- Story arc: cozy opening → a small problem or discovery → trying and learning → happy resolution
  that lands the moral in the last scene.
````

- [ ] **Step 2: Verify round-trip** — paste into ChatGPT once, save the reply as `stories/queue/sample.json`, run `npm run validate stories/queue/sample.json`. Expected: `✅ valid` (iterate the prompt if ChatGPT's output fails validation; keep fixes in the prompt, not the validator).

- [ ] **Step 3: Commit** — `git add prompts stories/queue/sample.json && git commit -m "feat: ChatGPT master prompt + validated sample episode"`

---

### Task 4: Voices + timeline (edge-tts per line)

**Files:**
- Create: `tools/edge_line.py`, `src/voices.ts`, `src/lib/discord.ts`
- Test: `test/timeline.test.ts`

**Interfaces:**
- Consumes: `Episode`, `Registry`.
- Produces: `out/audio/<n>.mp3` (one per utterance, in order) and `out/timeline.json`:
  `type Utterance = { idx:number; scene:number; kind:"narration"|"dialogue"; speaker?:string; text:string; file:string; start:number; dur:number }`
  `type Timeline = { utterances: Utterance[]; sceneStarts: number[]; sceneEnds: number[]; totalDur: number }`
  - `buildTimeline(durs: {scene:number; kind:"narration"|"dialogue"; speaker?:string; text:string; dur:number}[], gap?:number, scenePad?:number): Timeline` (pure, tested)
  - `runVoices(ep: Episode): Promise<Timeline>` (writes files; calls buildTimeline)
- Timing model: utterances play sequentially with `gap=0.45s` between, `scenePad=0.8s` after each scene's last utterance; scene N starts at its first utterance minus 0.4s lead-in (clamped ≥ previous scene end).

- [ ] **Step 1: Write the failing test (pure timeline math)**

```ts
// test/timeline.test.ts
import { describe, it, expect } from "vitest";
import { buildTimeline } from "../src/voices.js";

describe("buildTimeline", () => {
  it("sequences utterances with gaps and computes scene bounds", () => {
    const t = buildTimeline([
      { scene: 0, kind: "narration", text: "a", dur: 2 },
      { scene: 0, kind: "dialogue", speaker: "Zayd", text: "b", dur: 1 },
      { scene: 1, kind: "narration", text: "c", dur: 3 },
    ], 0.5, 1.0);
    expect(t.utterances[0].start).toBeCloseTo(0.4);       // lead-in offset
    expect(t.utterances[1].start).toBeCloseTo(0.4 + 2 + 0.5);
    expect(t.sceneEnds[0]).toBeCloseTo(t.utterances[1].start + 1 + 1.0);
    expect(t.utterances[2].start).toBeCloseTo(t.sceneEnds[0] + 0.4);
    expect(t.totalDur).toBeCloseTo(t.sceneEnds[1]);
    expect(t.sceneStarts[1]).toBeCloseTo(t.sceneEnds[0]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/timeline.test.ts` — FAIL.

- [ ] **Step 3: Implement**

```python
# tools/edge_line.py — one utterance -> mp3; prints duration seconds to stdout
import asyncio, sys, json
import edge_tts

text, voice, outfile = sys.argv[1], sys.argv[2], sys.argv[3]
pitch = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else "+0Hz"

async def main():
    comm = edge_tts.Communicate(text, voice, pitch=pitch)
    audio = bytearray(); last_end = 0.0
    async for chunk in comm.stream():
        if chunk["type"] == "audio": audio.extend(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            last_end = (chunk["offset"] + chunk["duration"]) / 1e7
    if not audio: raise SystemExit("no audio")
    open(outfile, "wb").write(bytes(audio))
    print(json.dumps({"dur": round(last_end + 0.15, 3)}))

asyncio.run(main())
```

```ts
// src/lib/discord.ts
export async function ping(content: string): Promise<void> {
  const hook = process.env.DISCORD_WEBHOOK;
  if (!hook) return;
  try { await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }); } catch {}
}
```

```ts
// src/voices.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { loadRegistry } from "./lib/registry.js";
import type { Episode } from "./validate-episode.js";
const run = promisify(execFile);

export type Utterance = { idx: number; scene: number; kind: "narration" | "dialogue"; speaker?: string; text: string; file: string; start: number; dur: number };
export type Timeline = { utterances: Utterance[]; sceneStarts: number[]; sceneEnds: number[]; totalDur: number };

const LEAD = 0.4;
export function buildTimeline(durs: { scene: number; kind: "narration" | "dialogue"; speaker?: string; text: string; dur: number }[], gap = 0.45, scenePad = 0.8): Timeline {
  const utterances: Utterance[] = [];
  const sceneStarts: number[] = []; const sceneEnds: number[] = [];
  let t = 0; let curScene = -1;
  for (const [i, d] of durs.entries()) {
    if (d.scene !== curScene) {
      if (curScene >= 0) { t += scenePad; sceneEnds[curScene] = t; }
      curScene = d.scene; sceneStarts[curScene] = t; t += LEAD;
    } else t += gap;
    utterances.push({ idx: i, scene: d.scene, kind: d.kind, speaker: d.speaker, text: d.text, file: `out/audio/${i}.mp3`, start: t, dur: d.dur });
    t += d.dur;
  }
  if (curScene >= 0) { t += scenePad; sceneEnds[curScene] = t; }
  return { utterances, sceneStarts, sceneEnds, totalDur: t };
}

export async function runVoices(ep: Episode): Promise<Timeline> {
  const reg = loadRegistry();
  await mkdir("out/audio", { recursive: true });
  const specs: { scene: number; kind: "narration" | "dialogue"; speaker?: string; text: string; voice: string; pitch?: string }[] = [];
  ep.scenes.forEach((s, i) => {
    if (s.narration) specs.push({ scene: i, kind: "narration", text: s.narration, voice: reg.narratorVoice });
    for (const d of s.dialogue ?? []) {
      const c = reg.characters[d.speaker];
      specs.push({ scene: i, kind: "dialogue", speaker: d.speaker, text: d.line, voice: c.voice, pitch: c.pitch });
    }
  });
  const durs: { scene: number; kind: "narration" | "dialogue"; speaker?: string; text: string; dur: number }[] = [];
  for (const [i, sp] of specs.entries()) {
    const { stdout } = await run("uv", ["run", "--with", "edge-tts", "python3", "tools/edge_line.py", sp.text, sp.voice, `out/audio/${i}.mp3`, sp.pitch ?? ""]);
    durs.push({ scene: sp.scene, kind: sp.kind, speaker: sp.speaker, text: sp.text, dur: JSON.parse(stdout).dur });
    console.log(`  voice ${i + 1}/${specs.length} (${sp.kind}${sp.speaker ? ":" + sp.speaker : ""})`);
  }
  const tl = buildTimeline(durs);
  await writeFile("out/timeline.json", JSON.stringify(tl, null, 1));
  return tl;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run` — PASS. Then live smoke: `npx tsx -e 'import("./src/voices.js").then(async m=>{const ep=JSON.parse((await import("node:fs")).readFileSync("stories/queue/sample.json","utf8"));console.log((await m.runVoices(ep)).totalDur)}'` — Expected: prints total seconds (~400–460 for a valid sample), `out/audio/*.mp3` exist.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: per-line edge-tts voices + tested timeline"`

---

### Task 5: Rhubarb lip-sync

**Files:**
- Create: `src/lipsync.ts`
- Test: `test/lipsync.test.ts`

**Interfaces:**
- Consumes: `Timeline` (dialogue utterances + mp3 files).
- Produces: `out/visemes/<idx>.json` per dialogue utterance: `{ cues: { t:number; v:"aa"|"ih"|"ou"|"ee"|"oh"|"rest" }[] }` (VRM blendshape names A/I/U/E/O map: aa→A, ih→I, ou→U, ee→E, oh→O, rest→closed).
  - `mapRhubarb(shape: string): "aa"|"ih"|"ou"|"ee"|"oh"|"rest"` (pure, tested)
  - `runLipsync(tl: Timeline): Promise<void>`
- Rhubarb outputs shapes A–H + X. Mapping: A(closed)→rest, B(slight)→ih, C(open)→ee, D(wide open)→aa, E(round)→oh, F(puckered)→ou, G(F/V)→ih, H(L)→ih, X(idle)→rest.

- [ ] **Step 1: Install Rhubarb (one-time)**

```bash
mkdir -p tools/rhubarb && cd tools/rhubarb
curl -sL https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v1.14.0/Rhubarb-Lip-Sync-1.14.0-macOS.zip -o rhubarb.zip
unzip -o rhubarb.zip && rm rhubarb.zip
mv Rhubarb-Lip-Sync-1.14.0-macOS/* . && rmdir Rhubarb-Lip-Sync-1.14.0-macOS
xattr -dr com.apple.quarantine . 2>/dev/null; ./rhubarb --version
```
Expected: `Rhubarb Lip Sync version 1.14.0`. (Intel binary — runs under Rosetta on Apple Silicon; if Rosetta is missing: `softwareupdate --install-rosetta --agree-to-license`.)

- [ ] **Step 2: Write the failing test**

```ts
// test/lipsync.test.ts
import { describe, it, expect } from "vitest";
import { mapRhubarb } from "../src/lipsync.js";

describe("mapRhubarb", () => {
  it("maps rhubarb shapes to VRM visemes", () => {
    expect(mapRhubarb("D")).toBe("aa");
    expect(mapRhubarb("C")).toBe("ee");
    expect(mapRhubarb("E")).toBe("oh");
    expect(mapRhubarb("F")).toBe("ou");
    expect(mapRhubarb("B")).toBe("ih");
    expect(mapRhubarb("A")).toBe("rest");
    expect(mapRhubarb("X")).toBe("rest");
    expect(mapRhubarb("?")).toBe("rest");
  });
});
```

- [ ] **Step 3: Run to verify failure**, then implement:

```ts
// src/lipsync.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import type { Timeline } from "./voices.js";
const run = promisify(execFile);

export type Viseme = "aa" | "ih" | "ou" | "ee" | "oh" | "rest";
const MAP: Record<string, Viseme> = { A: "rest", B: "ih", C: "ee", D: "aa", E: "oh", F: "ou", G: "ih", H: "ih", X: "rest" };
export const mapRhubarb = (shape: string): Viseme => MAP[shape] ?? "rest";

export async function runLipsync(tl: Timeline): Promise<void> {
  await mkdir("out/visemes", { recursive: true });
  const lines = tl.utterances.filter((u) => u.kind === "dialogue");
  for (const u of lines) {
    // rhubarb wants wav — convert first
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", u.file, "-ar", "16000", "-ac", "1", `out/visemes/${u.idx}.wav`]);
    const { stdout } = await run("tools/rhubarb/rhubarb", ["-f", "json", "--dialogFile", "/dev/null", `out/visemes/${u.idx}.wav`], { maxBuffer: 10_000_000 });
    const cues = (JSON.parse(stdout).mouthCues as { start: number; value: string }[]).map((c) => ({ t: c.start, v: mapRhubarb(c.value) }));
    await writeFile(`out/visemes/${u.idx}.json`, JSON.stringify({ cues }));
    console.log(`  lipsync ${u.idx} (${u.speaker}): ${cues.length} cues`);
  }
}
```
Note: pass the utterance text via `--dialogFile` only if recognition struggles; start without it (`/dev/null` above is deliberate — remove the flag if rhubarb errors on it: `["-f","json", wav]`).

- [ ] **Step 4: Run tests** — `npx vitest run` — PASS. Live smoke on one sample mp3 from Task 4: expect a visemes JSON with >3 cues.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: rhubarb lip-sync -> VRM viseme cues"`

---

## PHASE A — STUDIO AUTHORING (interactive; Blender open with MCP addon connected)

### Task 6: Cast (VRoid) — **GATE 1**

**Files:**
- Create: `studio/cast/zayd.vrm`, `studio/cast/maryam.vrm` (from VRoid Studio), `studio/cast/cast.blend`

**Interfaces:**
- Produces: `cast.blend` containing collections `CAST_Zayd`, `CAST_Maryam`; each armature named `RIG_<Name>`; body mesh keeps VRM shape keys `Fcl_MTH_A/I/U/E/O` (VRoid naming) — assembler (Task 9) depends on these exact names.

- [ ] **Step 1 (user):** Install VRoid Studio (free, vroid.com). Design Zayd (7yo boy: modest shirt+trousers) and Maryam (5yo girl: headscarf or modest dress — user's call, guided live). Export each as VRM 0.x into `studio/cast/`.
- [ ] **Step 2:** Install the Blender **VRM add-on** (VRM-Addon-for-Blender, free) — verify it lists Blender 5.0 support; if 5.0 is unsupported, install Blender 4.2 LTS alongside and pin `BLENDER_BIN` to it (decision recorded in `.env`).
- [ ] **Step 3 (MCP):** Import both VRMs; organize into `CAST_*` collections; rename armatures `RIG_Zayd`, `RIG_Maryam`; confirm shape keys `Fcl_MTH_A/I/U/E/O` exist on the face/body mesh (`print([k.name for k in mesh.data.shape_keys.key_blocks])` via MCP).
- [ ] **Step 4 (MCP, look-dev):** Toon-feel pass: flat-ish shading, subtle rim light, eye highlights. Render 2 portraits per kid (front, 3/4) at 1080p.
- [ ] **Step 5 — GATE 1:** Show the user the portraits. Iterate in VRoid/Blender until **user approves**. Save `cast.blend`.
- [ ] **Step 6:** Commit registry/doc changes only (blends are gitignored): `git add -A && git commit -m "feat: cast approved (gate 1)"`

### Task 7: Motion library (Mixamo → action library)

**Files:**
- Create: `studio/actions/actions.blend` — 25 actions named EXACTLY as `studio/registry.json` `actions` list.

**Interfaces:**
- Produces: Blender actions `ACT_idle`, `ACT_walk`, … `ACT_yawn` (prefix `ACT_` + registry name), usable on both `RIG_*` armatures.

- [ ] **Step 1:** Export Zayd's mesh+armature as FBX from Blender (`cast.blend`, with shape keys OFF for this export — Mixamo strips them anyway; this FBX is ONLY for rigging animations).
- [ ] **Step 2 (user assist):** Upload to mixamo.com (free Adobe account) → auto-rig → download the 25 animations (in registry naming order: Idle, Talking, Walking, Running, Jump, Waving, Sitting Idle, Clapping, Laughing, Pointing, Looking Around, Thinking, Cheering, Head Nod Yes, Head Shake No, Picking Up Object, Hug, Terrified→rename scared, Sleeping Idle, Stretching, Happy Dance→dance_happy (verify it's kid-appropriate/modest, else use Excited), Kneeling, Sneaking, Surprised, Yawn) as **FBX without skin**.
- [ ] **Step 3 (MCP):** Import each FBX; retarget Mixamo skeleton → `RIG_Zayd` using the VRM addon's humanoid bone mapping (both are humanoid; primary route). Fallback route if mapping fights: Rokoko Retargeting add-on (free). Bake each to an action named `ACT_<registryName>`, strip root motion (in-place), save all in `actions.blend`.
- [ ] **Step 4 (verify):** MCP: play `ACT_walk` and `ACT_talk` on BOTH rigs; screenshot; confirm no limb explosions and shape keys still intact on cast meshes.
- [ ] **Step 5:** Commit docs/registry deltas: `git commit -am "feat: motion library retargeted (25 actions)"`

### Task 8: Sets ×5 — **GATE 2**

**Files:**
- Create: `studio/sets/{bedroom,kitchen,park,forest,street}.blend`

**Interfaces:**
- Produces: per set — collection `SET`, empties `MARK_A`, `MARK_B` (`MARK_C` in park) for character placement, cameras `CAM_wide`, `CAM_closeA`, `CAM_closeB`, lighting + world done, compositor glare (bloom) node group saved. Names must match `registry.json`.

- [ ] **Step 1:** Download CC0 asset packs once: Kenney (furniture/nature/city kits), Quaternius (nature/buildings), Poly Haven HDRIs (via MCP's Poly Haven integration).
- [ ] **Step 2 (MCP, per set):** Assemble the set; art-direct to the reference image mood: warm saturated palette, purple/gold night accents where fitting (bedroom = the reference's cozy night look), soft key + rim, AO, compositor glare for glow. Add `MARK_*` empties (60cm apart, facing camera) and the 3 cameras (wide = full set, closeA/B aimed at marks A/B head-height).
- [ ] **Step 3 (MCP, per set):** Beauty-shot render 1080p with both kids placed at marks in `ACT_idle`.
- [ ] **Step 4 — GATE 2:** User reviews 5 beauty shots; iterate until approved.
- [ ] **Step 5:** `git commit -am "feat: five sets approved (gate 2)"`

---

## PHASE B INTEGRATION

### Task 9: Blender assembler

**Files:**
- Create: `blender/lib_studio.py`, `blender/assembler.py`, `src/render.ts`

**Interfaces:**
- Consumes: `out/episode.json` (validated Episode), `out/timeline.json`, `out/visemes/*.json`, `studio/{cast/cast.blend,sets/*.blend,actions/actions.blend}`, registry names from Tasks 6–8 (`CAST_*`, `RIG_*`, `ACT_*`, `MARK_*`, `CAM_*`, `Fcl_MTH_*`).
- Produces: `out/frames/scene-<i>.mp4` per scene (Blender renders each scene separately — restartable), via
  `renderEpisode(): Promise<void>` in `src/render.ts` running `$BLENDER_BIN -b studio/sets/<set>.blend -P blender/assembler.py -- --scene <i> --episode out/episode.json --timeline out/timeline.json`.

- [ ] **Step 1: Write `blender/lib_studio.py`**

```python
# Shared helpers used by assembler.py (linked cast/actions, placement, lipsync, camera, eevee).
import bpy, json, math, os

FPS = 24

def link_collection(blend, coll):
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        if coll in src.collections: dst.collections = [coll]
    c = bpy.data.collections.get(coll)
    if c and c.name not in {x.name for x in bpy.context.scene.collection.children}:
        bpy.context.scene.collection.children.link(c)
    return c

def load_actions(blend):
    with bpy.data.libraries.load(blend, link=False) as (src, dst):
        dst.actions = [a for a in src.actions if a.startswith("ACT_")]

def rig_of(name):    return bpy.data.objects[f"RIG_{name}"]
def mark_of(scene, m):
    return bpy.data.objects[f"MARK_{m}"]

def place(name, mark):
    r = rig_of(name); e = mark_of(bpy.context.scene, mark)
    r.location = e.location; r.rotation_euler = e.rotation_euler

def apply_action(name, action, start_f, end_f):
    r = rig_of(name)
    act = bpy.data.actions.get(f"ACT_{action}") or bpy.data.actions.get("ACT_idle")
    r.animation_data_create()
    nla = r.animation_data.nla_tracks.new(); nla.name = f"{name}-{action}"
    strip = nla.strips.new(action, int(start_f), act)
    strip.action_frame_end = act.frame_range[1]
    strip.repeat = max(1.0, (end_f - start_f) / max(1, act.frame_range[1] - act.frame_range[0]))
    strip.frame_end = int(end_f)

def face_mesh(name):
    # the cast mesh that owns the VRM mouth shape keys
    for o in bpy.data.objects:
        if o.type == "MESH" and o.parent and o.parent.name == f"RIG_{name}" and o.data.shape_keys:
            if any(k.name.startswith("Fcl_MTH_") for k in o.data.shape_keys.key_blocks):
                return o
    return None

VISEME_KEY = {"aa": "Fcl_MTH_A", "ih": "Fcl_MTH_I", "ou": "Fcl_MTH_U", "ee": "Fcl_MTH_E", "oh": "Fcl_MTH_O"}

def key_mouth(name, cues, base_time):
    o = face_mesh(name)
    if not o: return
    kb = o.data.shape_keys.key_blocks
    def set_all(t, active):
        f = int((base_time + t) * FPS)
        for v, keyname in VISEME_KEY.items():
            if keyname in kb:
                kb[keyname].value = 1.0 if v == active else 0.0
                kb[keyname].keyframe_insert("value", frame=f)
    for c in cues: set_all(c["t"], c["v"] if c["v"] != "rest" else None)

def bind_camera(cam_name, frame):
    cam = bpy.data.objects[cam_name]
    m = bpy.context.scene.timeline_markers.new(cam_name, frame=int(frame))
    m.camera = cam

def setup_eevee(out_path, frame_start, frame_end):
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "SceneEEVEE") else "BLENDER_EEVEE"
    s.render.resolution_x, s.render.resolution_y = 1920, 1080
    s.render.fps = FPS
    s.frame_start, s.frame_end = int(frame_start), int(frame_end)
    s.render.image_settings.file_format = "FFMPEG"
    s.render.ffmpeg.format = "MPEG4"; s.render.ffmpeg.codec = "H264"
    s.render.ffmpeg.constant_rate_factor = "HIGH"
    s.render.filepath = out_path
```

- [ ] **Step 2: Write `blender/assembler.py`**

```python
# Builds ONE scene of the episode inside the set's .blend, then renders it.
# argv: -- --scene <i> --episode <path> --timeline <path>
import bpy, json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib_studio as st

argv = sys.argv[sys.argv.index("--") + 1:]
def arg(flag): return argv[argv.index(flag) + 1]
i = int(arg("--scene"))
ep = json.load(open(arg("--episode")))
tl = json.load(open(arg("--timeline")))
scene = ep["scenes"][i]

start, end = tl["sceneStarts"][i], tl["sceneEnds"][i]
f0, f1 = 0, int((end - start) * st.FPS)   # render scene-local frames

st.link_collection("studio/cast/cast.blend", "CAST_Zayd")
st.link_collection("studio/cast/cast.blend", "CAST_Maryam")
st.load_actions("studio/actions/actions.blend")

# hide non-cast characters, place + animate the ones on stage
on_stage = scene["cast"].keys()
for name in ["Zayd", "Maryam"]:
    st.rig_of(name).hide_render = name not in on_stage
    for o in bpy.data.objects:
        if o.parent and o.parent.name == f"RIG_{name}": o.hide_render = name not in on_stage
for name, c in scene["cast"].items():
    st.place(name, c["mark"])
    st.apply_action(name, c["action"], f0, f1)

# lip-sync + talk gesture for each dialogue utterance in this scene
for u in tl["utterances"]:
    if u["scene"] != i or u["kind"] != "dialogue": continue
    vpath = f'out/visemes/{u["idx"]}.json'
    if os.path.exists(vpath):
        cues = json.load(open(vpath))["cues"]
        st.key_mouth(u["speaker"], cues, u["start"] - start)

# camera cuts: wide at scene start; cut to speaker's close-up per dialogue line, back to wide after
st.bind_camera("CAM_wide", f0)
marks = {n: c["mark"] for n, c in scene["cast"].items()}
for u in tl["utterances"]:
    if u["scene"] != i or u["kind"] != "dialogue": continue
    cam = "CAM_closeA" if marks.get(u["speaker"]) == "A" else "CAM_closeB"
    st.bind_camera(cam, (u["start"] - start) * st.FPS)
    st.bind_camera("CAM_wide", (u["start"] - start + u["dur"] + 0.3) * st.FPS)

st.setup_eevee(f"out/frames/scene-{i}.mp4", f0, f1)
bpy.ops.render.render(animation=True)
print(f"RENDERED scene {i}: frames {f0}-{f1}")
```

- [ ] **Step 3: Write `src/render.ts`**

```ts
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";

const BLENDER = process.env.BLENDER_BIN || "/Applications/Blender.app/Contents/MacOS/Blender";
const run = (args: string[]) =>
  new Promise<void>((res, rej) => {
    const p = spawn(BLENDER, args, { stdio: "inherit" });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`blender exit ${c}`))));
  });

export async function renderEpisode(): Promise<void> {
  const ep = JSON.parse(await readFile("out/episode.json", "utf8"));
  await mkdir("out/frames", { recursive: true });
  for (let i = 0; i < ep.scenes.length; i++) {
    console.log(`\n— render scene ${i + 1}/${ep.scenes.length} (${ep.scenes[i].set}) —`);
    await run(["-b", `studio/sets/${ep.scenes[i].set}.blend`, "-P", "blender/assembler.py", "--",
      "--scene", String(i), "--episode", "out/episode.json", "--timeline", "out/timeline.json"]);
  }
}
```

- [ ] **Step 4 (verify):** After Tasks 6–8 exist, run one scene manually against the sample episode: `npx tsx -e 'import("./src/render.js").then(m=>m.renderEpisode())'` with a 1-scene episode.json. Expected: `out/frames/scene-0.mp4` plays: kids at marks, action playing, mouths moving on dialogue, camera cutting.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: blender assembler + per-scene renderer"`

### Task 10: 20-sec test scene — **GATE 3 (go/no-go on the look)**

- [ ] **Step 1:** Hand-write `stories/queue/_test20s.json`: one park scene, both kids, 2 dialogue lines + 1 narration (~50 words).
- [ ] **Step 2:** Run voices → lipsync → render for it (the Task 13 orchestrator pieces manually).
- [ ] **Step 3 — GATE 3:** User watches the clip. Iterate lighting/materials/camera via MCP until **approved**. This is the go/no-go for the whole look. Record approved render settings back into the set .blends.
- [ ] **Step 4:** `git commit -am "feat: test scene approved (gate 3)"`

### Task 11: Music bed + compose

**Files:**
- Create: `src/music.ts`, `src/compose.ts`
- Test: `test/compose.test.ts`

**Interfaces:**
- Consumes: `out/frames/scene-*.mp4`, `out/timeline.json`, `out/audio/*.mp3`.
- Produces: `out/episode.mp4` (1080p24, AAC).
  - `buildConcatList(sceneCount:number): string` (pure, tested) — ffmpeg concat file body.
  - `composeEpisode(): Promise<void>` — concat scenes → overlay every utterance at its `start` → music bed at −26 dB under it all.

- [ ] **Step 1: Failing test**

```ts
// test/compose.test.ts
import { describe, it, expect } from "vitest";
import { buildConcatList } from "../src/compose.js";

describe("buildConcatList", () => {
  it("lists scene files in order", () => {
    expect(buildConcatList(3)).toBe("file 'frames/scene-0.mp4'\nfile 'frames/scene-1.mp4'\nfile 'frames/scene-2.mp4'");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/music.ts — gentle lullaby-ish pad (free, synthesized; same technique as youtube-studio)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

export async function buildMusic(durSec: number): Promise<void> {
  const d = Math.ceil(durSec + 2);
  const sine = (f: number) => ["-f", "lavfi", "-i", `sine=frequency=${f}:duration=${d}`];
  await run("ffmpeg", ["-y",
    ...sine(261.63), ...sine(329.63), ...sine(392.0), ...sine(523.25),
    "-filter_complex",
    "[0]volume=0.30[a];[1]volume=0.22[b];[2]volume=0.20[c];[3]volume=0.10[d];" +
    "[a][b][c][d]amix=inputs=4:normalize=0[m];" +
    `[m]tremolo=f=0.15:d=0.4,lowpass=f=1800,loudnorm=I=-26:TP=-2,afade=t=in:d=3,afade=t=out:st=${d - 4}:d=4[out]`,
    "-map", "[out]", "-c:a", "pcm_s16le", "out/music.wav"]);
}
```

```ts
// src/compose.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { buildMusic } from "./music.js";
const run = promisify(execFile);

export function buildConcatList(sceneCount: number): string {
  return Array.from({ length: sceneCount }, (_, i) => `file 'frames/scene-${i}.mp4'`).join("\n");
}

export async function composeEpisode(): Promise<void> {
  const tl = JSON.parse(await readFile("out/timeline.json", "utf8"));
  const ep = JSON.parse(await readFile("out/episode.json", "utf8"));
  await writeFile("out/concat.txt", buildConcatList(ep.scenes.length));
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "out/concat.txt", "-c", "copy", "out/video.mp4"]);
  await buildMusic(tl.totalDur);
  // one adelay-ed input per utterance, mixed with the music bed
  const inputs: string[] = ["-i", "out/video.mp4", "-i", "out/music.wav"];
  const parts: string[] = [];
  tl.utterances.forEach((u: { file: string; start: number }, k: number) => {
    inputs.push("-i", u.file);
    parts.push(`[${k + 2}:a]adelay=${Math.round(u.start * 1000)}|${Math.round(u.start * 1000)}[u${k}]`);
  });
  const mix = tl.utterances.map((_: unknown, k: number) => `[u${k}]`).join("") + "[1:a]";
  const filter = parts.join(";") + `;${mix}amix=inputs=${tl.utterances.length + 1}:normalize=0:duration=first[a]`;
  await run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filter,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "out/episode.mp4"]);
  console.log("✅ out/episode.mp4");
}
```

- [ ] **Step 3:** `npx vitest run` — PASS. Live: run against Gate-3 outputs → `out/episode.mp4` plays with synced voices + soft music.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: music bed + episode composer"`

### Task 12: Uploader (made-for-kids) + token

**Files:**
- Create: `src/youtube/auth.ts`, `src/youtube/uploader.ts` (copy from `~/Documents/LocalProject/youtube-studio/src/youtube/`, then modify), `src/publish.ts`

**Interfaces:**
- Produces: `publishEpisode(title:string, description:string): Promise<string>` → videoId. Upload body MUST include `status.selfDeclaredMadeForKids: true`; `PUBLISH_MODE=approval` → private, `auto` → `publishAt` +2h.

- [ ] **Step 1:** Copy `auth.ts`/`uploader.ts` from youtube-studio; in the uploader's `videos.insert` request body add `selfDeclaredMadeForKids: true` under `status` and accept `madeForKids` in `UploadOptions`.
- [ ] **Step 2 (user):** Create the new YouTube channel (youtube.com → switcher → “create channel”); run youtube-studio's `npm run mint-token` flow with the same OAuth client, **selecting the kids channel** when Google asks; put the refresh token in `kids-studio/.env` as `YT_REFRESH_TOKEN`.
- [ ] **Step 3:** `src/publish.ts`:

```ts
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { getAuthorizedClient } from "./youtube/auth.js";
import { uploadVideo } from "./youtube/uploader.js";
import { ping } from "./lib/discord.js";

export async function publishEpisode(): Promise<string> {
  const ep = JSON.parse(await readFile("out/episode.json", "utf8"));
  const mode = (process.env.PUBLISH_MODE || "approval").toLowerCase();
  const description = `${ep.title} — a story about ${ep.moral}.\n\nA cozy animated story for kids.`;
  const opts: Parameters<typeof uploadVideo>[1] = {
    videoPath: "out/episode.mp4", title: ep.title, description,
    tags: ["kids stories", "bedtime stories", "animated stories for kids", ep.moral],
    madeForKids: true,
  } as never;
  if (mode === "auto") (opts as { publishAt?: string }).publishAt = new Date(Date.now() + 2 * 3600e3).toISOString();
  const id = await uploadVideo(getAuthorizedClient({
    clientId: process.env.YT_CLIENT_ID!, clientSecret: process.env.YT_CLIENT_SECRET!, refreshToken: process.env.YT_REFRESH_TOKEN!,
  } as never), opts);
  await ping(`✅ **Kids episode done** — ${mode === "auto" ? "⏰ scheduled PUBLIC (~2h)" : "🔒 PRIVATE for review"}\n**${ep.title}**\n👀 https://youtu.be/${id}`);
  return id;
}
```
(Adapt the `getAuthorizedClient` call signature to whatever the copied `auth.ts` exports — keep the copied file's interface, don't invent a new one.)

- [ ] **Step 4 (verify):** dry-run auth: list channel via the client (or upload the Gate-3 20-sec clip PRIVATE, then delete it in Studio).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: made-for-kids uploader + publish with Discord ping"`

### Task 13: Orchestrator + queue (TDD queue logic)

**Files:**
- Create: `src/lib/queue.ts`, `src/episode.ts`
- Test: `test/queue.test.ts`

**Interfaces:**
- Produces: `pickNext(files:string[]): string | null` (oldest-first by name, ignores `_`-prefixed files — tested); `npm run episode` runs the full chain and moves the story file to `done/` (success) or `failed/` (validation errors), pinging Discord: 🔴 fail, ⚠️ queue low (<2), ✅ done (from publish).

- [ ] **Step 1: Failing test**

```ts
// test/queue.test.ts
import { describe, it, expect } from "vitest";
import { pickNext } from "../src/lib/queue.js";

describe("pickNext", () => {
  it("returns oldest by filename, skipping _-prefixed", () => {
    expect(pickNext(["b.json", "_test.json", "a.json"])).toBe("a.json");
  });
  it("returns null when empty", () => {
    expect(pickNext(["_x.json"])).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/lib/queue.ts
export function pickNext(files: string[]): string | null {
  const c = files.filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
  return c[0] ?? null;
}
```

```ts
// src/episode.ts
import "dotenv/config";
import { readdir, readFile, rename, mkdir, writeFile, rm } from "node:fs/promises";
import { loadRegistry } from "./lib/registry.js";
import { validateEpisode } from "./validate-episode.js";
import { pickNext } from "./lib/queue.js";
import { runVoices } from "./voices.js";
import { runLipsync } from "./lipsync.js";
import { renderEpisode } from "./render.js";
import { composeEpisode } from "./compose.js";
import { publishEpisode } from "./publish.js";
import { ping } from "./lib/discord.js";

const step = async (name: string, fn: () => Promise<unknown>) => { console.log(`\n=== ${name} ===`); return fn(); };

const files = await readdir("stories/queue").catch(() => []);
const next = pickNext(files);
if (!next) { console.log("queue empty — nothing to do"); await ping("⚠️ **Kids studio queue is EMPTY** — paste new ChatGPT episodes into stories/queue/."); process.exit(0); }
if (files.filter((f) => f.endsWith(".json") && !f.startsWith("_")).length <= 2) await ping("⚠️ Kids studio queue is low — refill soon.");

const raw = JSON.parse(await readFile(`stories/queue/${next}`, "utf8"));
const v = validateEpisode(raw, loadRegistry());
if (!v.ok) {
  await rename(`stories/queue/${next}`, `stories/failed/${next}`);
  await ping(`🔴 **Kids episode "${next}" failed validation** (moved to failed/):\n${v.errors.slice(0, 8).join("\n")}`);
  process.exit(1);
}

try {
  await rm("out", { recursive: true, force: true }); await mkdir("out", { recursive: true });
  await writeFile("out/episode.json", JSON.stringify(v.episode, null, 1));
  const tl = await step("voices", () => runVoices(v.episode));
  await step("lip-sync", () => runLipsync(tl as never));
  await step("render (this is the long part)", () => renderEpisode());
  await step("compose", () => composeEpisode());
  await step("publish", () => publishEpisode());
  await rename(`stories/queue/${next}`, `stories/done/${next}`);
  console.log("\n✅ episode complete");
} catch (e) {
  await ping(`🔴 **Kids episode FAILED during build** (${next}): ${String(e).slice(0, 300)}`);
  throw e;
}
```

- [ ] **Step 3:** `npx vitest run` — all suites PASS.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: episode orchestrator + story queue"`

### Task 14: First real episode + go-live

- [ ] **Step 1:** User pastes the master prompt into ChatGPT, saves 3 episodes into `stories/queue/`.
- [ ] **Step 2:** `npm run episode` (PUBLISH_MODE=approval). Full 7-min build overnight. Verify `out/episode.mp4` end-to-end, then the private upload.
- [ ] **Step 3:** User reviews the private video on the new channel. Fix-list → iterate.
- [ ] **Step 4 (go-live, user's call):** set `PUBLISH_MODE=auto` in `.env`. Optional schedule: `launchd` plist running `npm run episode` at 23:00 every 2nd day (guard: queue-empty exits cleanly; add a `state/last-run.txt` date check mirroring youtube-studio's guard if double-runs become a concern).
- [ ] **Step 5:** `git commit -am "chore: go-live config"` — and add a README documenting: refill queue → episodes appear.

---

## Self-Review

- **Spec coverage:** two-phase architecture (T6–8 vs T1–5/9–13), ChatGPT queue + master prompt (T3, T13), gates 1/2/3 (T6/T8/T10), made-for-kids + new token (T12), Discord pings (T4 lib, T12, T13), modesty (T3 prompt + T2 BANNED guard + T6 wardrobe), $0 (no paid API anywhere), Mac-local renders (T9 render.ts), trigger + schedule (T14). ✓
- **Placeholders:** none — every code step has full code; authoring tasks have concrete procedures + named outputs.
- **Type consistency:** `Timeline/Utterance` (T4) consumed by T5/T9/T11; registry names (T2) consumed by T3/T6/T7/T8/T9; `ACT_/RIG_/MARK_/CAM_/Fcl_MTH_` naming defined T6–8, consumed T9. `pickNext` (T13) matches test. ✓
- **Known open risk carried from spec:** VRM addon vs Blender 5.0 (T6 Step 2 has the 4.2-LTS fallback decision point); Mixamo strips shape keys (mitigated: separate FBX for animation rigging only, shape keys live only in cast.blend).
