# Stock-Photo Background + Doodle Host — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daily AI-drawn-SVG doodle video with real per-sentence copyright-free stock-photo backgrounds + a transparent doodle host character per scene, 8–9 min long, with topic variety.

**Architecture:** Merge the two existing pipelines. Background = per-sentence Pexels→Pixabay photos (Ken Burns, word-timing aligned). Doodle = transparent per-scene character on a translucent stage with a draw-on wipe + single idle bob. Captions = existing word-by-word. New `HostVideo` Remotion composition layers them.

**Tech Stack:** TypeScript ESM (tsx), Remotion 4, edge-tts (uv), vitest, ffmpeg, Claude Code CLI (script+SVG), Pexels + Pixabay REST.

## Global Constraints

- Node ≥ 20, ESM (`"type":"module"`); relative imports use `.js` extensions.
- Text/SVG model: Claude only (`SCRIPT_PROVIDER=claude`). No new text API key.
- Stock keys: `PEXELS_API_KEY` (primary), `PIXABAY_API_KEY` (fallback) — already in local `.env`, must be added as GitHub secrets for CI.
- Never crash a run on a single missing image: reuse previous good image.
- Long video landscape 1920×1080 @ 30fps; Short portrait 1080×1920 @ 30fps.
- `PUBLISH_MODE=approval` (private upload) stays until the user approves output.
- Deterministic split: `splitForVisuals` is called on the SAME script in both `gen-bg-stock` and `prepare-host` so image count and order match.

---

### Task 1: `lib/timing.ts` — alignment + caption helpers (pure, TDD)

Extracts the per-unit word-timing alignment and caption-line grouping that today are duplicated inline in `prepare-render.ts` and `prepare-doodle.ts`, into pure, tested functions.

**Files:**
- Create: `src/lib/timing.ts`
- Test: `test/timing.test.ts`

**Interfaces:**
- Produces:
  - `type Word = { w: string; start: number; end: number }`
  - `type Seg = { start: number; end: number }`
  - `type Line = { start: number; end: number; words: { text: string; start: number; end: number }[] }`
  - `alignByWordCount(unitWordCounts: number[], words: Word[], narrationDur: number): Seg[]`
  - `buildCaptionLines(words: Word[], maxWords: number): Line[]`

- [ ] **Step 1: Write the failing test**

```ts
// test/timing.test.ts
import { describe, it, expect } from "vitest";
import { alignByWordCount, buildCaptionLines, type Word } from "../src/lib/timing.js";

const W = (w: string, start: number, end: number): Word => ({ w, start, end });

describe("alignByWordCount", () => {
  it("starts each unit at its first word and ends at the next unit's start", () => {
    const words = [W("a", 0, 1), W("b", 1, 2), W("c", 2, 3), W("d", 3, 4)];
    const segs = alignByWordCount([2, 2], words, 4);
    expect(segs).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });
  it("last unit ends at narrationDur", () => {
    const words = [W("a", 0, 1), W("b", 1, 2), W("c", 2, 3)];
    const segs = alignByWordCount([1, 2], words, 3.5);
    expect(segs[1]).toEqual({ start: 1, end: 3.5 });
  });
  it("clamps a unit start index past the end of the word list", () => {
    const words = [W("a", 0, 1), W("b", 1, 2)];
    const segs = alignByWordCount([1, 1, 5], words, 2); // 3rd unit's count overruns
    expect(segs.length).toBe(3);
    expect(segs[2].start).toBe(words[words.length - 1].start);
  });
});

describe("buildCaptionLines", () => {
  it("flushes at maxWords", () => {
    const words = [W("one", 0, 1), W("two", 1, 2), W("three", 2, 3), W("four", 3, 4), W("five", 4, 5)];
    const lines = buildCaptionLines(words, 2);
    expect(lines.map((l) => l.words.map((w) => w.text).join(" "))).toEqual(["one two", "three four", "five"]);
    expect(lines[0]).toMatchObject({ start: 0, end: 2 });
  });
  it("flushes at sentence-ending punctuation", () => {
    const words = [W("hello.", 0, 1), W("next", 1, 2), W("word", 2, 3)];
    const lines = buildCaptionLines(words, 9);
    expect(lines[0].words.map((w) => w.text)).toEqual(["hello."]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/timing.test.ts`
Expected: FAIL — cannot find module `../src/lib/timing.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/timing.ts
export type Word = { w: string; start: number; end: number };
export type Seg = { start: number; end: number };
export type CaptionWord = { text: string; start: number; end: number };
export type Line = { start: number; end: number; words: CaptionWord[] };

// Assign a time segment to each ordered unit by walking the spoken-word stream:
// unit k starts at the spoken time of its first word; ends at unit k+1's start
// (last unit ends at narrationDur). unitWordCounts[k] = number of words in unit k.
export function alignByWordCount(unitWordCounts: number[], words: Word[], narrationDur: number): Seg[] {
  if (!words.length) return unitWordCounts.map(() => ({ start: 0, end: narrationDur }));
  const startIdx: number[] = [];
  let wi = 0;
  for (const c of unitWordCounts) { startIdx.push(Math.min(wi, words.length - 1)); wi += c; }
  return unitWordCounts.map((_, k) => {
    const start = words[startIdx[k]].start;
    const end = k < unitWordCounts.length - 1 ? words[startIdx[k + 1]].start : narrationDur;
    return { start, end: Math.max(end, start) };
  });
}

// Group words into caption lines: flush at maxWords or sentence-ending punctuation.
export function buildCaptionLines(words: Word[], maxWords: number): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) {
      lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur.map((x) => ({ text: x.w, start: x.start, end: x.end })) });
      cur = [];
    }
  };
  for (const wd of words) { cur.push(wd); if (cur.length >= maxWords || /[.!?]$/.test(wd.w)) flush(); }
  flush();
  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/timing.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/timing.ts test/timing.test.ts
git commit -m "feat: timing helpers (word-aligned segments + caption lines)"
```

---

### Task 2: `lib/stock.ts` — Pexels→Pixabay client (TDD)

**Files:**
- Create: `src/lib/stock.ts`
- Test: `test/stock.test.ts`

**Interfaces:**
- Produces:
  - `type Candidate = { id: string; url: string; src: "pexels" | "pixabay" }`
  - `parsePexels(json: any): Candidate[]`
  - `parsePixabay(json: any): Candidate[]`
  - `pickCandidate(cands: Candidate[], exclude: Set<string>, seed: number): Candidate | null`
  - `searchPhoto(query: string, exclude: Set<string>, seed: number): Promise<Candidate | null>`
  - `downloadPhoto(c: Candidate): Promise<Buffer>`

- [ ] **Step 1: Write the failing test**

```ts
// test/stock.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parsePexels, parsePixabay, pickCandidate, searchPhoto, type Candidate } from "../src/lib/stock.js";

describe("parsePexels", () => {
  it("maps photos to candidates and drops urlless entries", () => {
    const j = { photos: [{ id: 1, src: { large2x: "u1" } }, { id: 2, src: {} }] };
    expect(parsePexels(j)).toEqual([{ id: "px-1", url: "u1", src: "pexels" }]);
  });
});

describe("parsePixabay", () => {
  it("maps hits to candidates", () => {
    const j = { hits: [{ id: 9, largeImageURL: "u9" }] };
    expect(parsePixabay(j)).toEqual([{ id: "pb-9", url: "u9", src: "pixabay" }]);
  });
});

describe("pickCandidate", () => {
  const c = (id: string): Candidate => ({ id, url: id, src: "pexels" });
  it("skips excluded ids", () => {
    const got = pickCandidate([c("a"), c("b")], new Set(["a"]), 0);
    expect(got?.id).toBe("b");
  });
  it("rotates the start index by seed", () => {
    expect(pickCandidate([c("a"), c("b"), c("c")], new Set(), 1)?.id).toBe("b");
  });
  it("returns null when all excluded", () => {
    expect(pickCandidate([c("a")], new Set(["a"]), 0)).toBeNull();
  });
});

describe("searchPhoto fallback", () => {
  beforeEach(() => { process.env.PEXELS_API_KEY = "PX"; process.env.PIXABAY_API_KEY = "PB"; });
  afterEach(() => { vi.unstubAllGlobals(); });
  it("falls back to Pixabay when Pexels returns nothing, and excludes the pick", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.includes("pexels.com") ? { photos: [] } : { hits: [{ id: 7, largeImageURL: "u7" }] };
      return { ok: true, json: async () => body } as any;
    }));
    const exclude = new Set<string>();
    const got = await searchPhoto("money", exclude, 0);
    expect(got).toEqual({ id: "pb-7", url: "u7", src: "pixabay" });
    expect(exclude.has("pb-7")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/stock.test.ts`
Expected: FAIL — cannot find module `../src/lib/stock.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/stock.ts
export type Candidate = { id: string; url: string; src: "pexels" | "pixabay" };

export function parsePexels(json: any): Candidate[] {
  const photos = Array.isArray(json?.photos) ? json.photos : [];
  return photos
    .map((p: any) => ({ id: `px-${p.id}`, url: p?.src?.large2x || p?.src?.large || p?.src?.original, src: "pexels" as const }))
    .filter((c: Candidate) => !!c.url);
}

export function parsePixabay(json: any): Candidate[] {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return hits
    .map((h: any) => ({ id: `pb-${h.id}`, url: h?.largeImageURL || h?.webformatURL, src: "pixabay" as const }))
    .filter((c: Candidate) => !!c.url);
}

// Pick the first candidate whose id isn't excluded, rotating the start by seed for variety.
export function pickCandidate(cands: Candidate[], exclude: Set<string>, seed: number): Candidate | null {
  const n = cands.length;
  if (!n) return null;
  for (let k = 0; k < n; k++) {
    const c = cands[((seed % n) + k) % n];
    if (!exclude.has(c.id)) return c;
  }
  return null;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<any | null> {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function pexelsSearch(query: string): Promise<Candidate[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const orient = process.env.ORIENT === "portrait" ? "portrait" : "landscape";
  const u = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orient}&per_page=15&size=large`;
  const j = await fetchJson(u, { Authorization: key });
  return j ? parsePexels(j) : [];
}

async function pixabaySearch(query: string): Promise<Candidate[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const orient = process.env.ORIENT === "portrait" ? "vertical" : "horizontal";
  const u = `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&orientation=${orient}&per_page=15&safesearch=true`;
  const j = await fetchJson(u);
  return j ? parsePixabay(j) : [];
}

// Search Pexels then Pixabay; broaden the query once (first 2 words) if both are empty.
// Adds the chosen id to `exclude` (per-video dedup). Returns null only if truly nothing found.
export async function searchPhoto(query: string, exclude: Set<string>, seed: number): Promise<Candidate | null> {
  const broad = query.split(/\s+/).slice(0, 2).join(" ");
  const queries = broad && broad !== query ? [query, broad] : [query];
  for (const q of queries) {
    let pick = pickCandidate(await pexelsSearch(q), exclude, seed);
    if (pick) { exclude.add(pick.id); return pick; }
    pick = pickCandidate(await pixabaySearch(q), exclude, seed);
    if (pick) { exclude.add(pick.id); return pick; }
  }
  return null;
}

export async function downloadPhoto(c: Candidate): Promise<Buffer> {
  const r = await fetch(c.url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`download ${c.src} ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/stock.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stock.ts test/stock.test.ts
git commit -m "feat: Pexels->Pixabay stock photo client"
```

---

### Task 3: Raise `normalize-image.ts` landscape to 1920×1080

**Files:**
- Modify: `src/lib/normalize-image.ts:7-9`

**Interfaces:**
- Consumes: nothing new. Produces: unchanged signature `normalizeImage(buf, outPath)`.

- [ ] **Step 1: Edit the dimensions**

Replace lines 7-9:

```ts
  const portrait = process.env.ORIENT === "portrait";
  const W = portrait ? 1080 : 1280;
  const H = portrait ? 1920 : 720;
```

with:

```ts
  const portrait = process.env.ORIENT === "portrait";
  const W = portrait ? 1080 : 1920;
  const H = portrait ? 1920 : 1080;
```

- [ ] **Step 2: Verify with a real image**

Run:
```bash
set -a; source .env; set +a
node --input-type=module -e '
import { searchPhoto, downloadPhoto } from "./src/lib/stock.ts";
import { normalizeImage } from "./src/lib/normalize-image.ts";
' 2>/dev/null || true
npx tsx -e '
import { searchPhoto, downloadPhoto } from "./src/lib/stock.js";
import { normalizeImage } from "./src/lib/normalize-image.js";
const c = await searchPhoto("kitchen table", new Set(), 0);
await normalizeImage(await downloadPhoto(c!), "/tmp/nz-test.jpg");
'
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 /tmp/nz-test.jpg
```
Expected: `1920,1080`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/normalize-image.ts
git commit -m "fix: normalize landscape stills to 1920x1080 (crisp backgrounds)"
```

---

### Task 4: `gen-doodle-long.ts` — topic dedup + transparent character SVG

**Files:**
- Modify: `src/scripts/gen-doodle-long.ts`

**Interfaces:**
- Consumes: `state/used-topics.json` (array of titles), `DOODLE_WORDS`, `DOODLE_SCENES`.
- Produces: `out/story.json` (`{title,onScreenTitle,description,tags,topic,script}`), `out/scenes.json` (`[{narration,visual,svg}]`, svg = transparent character), appends new title to `state/used-topics.json`.

- [ ] **Step 1: Add used-topics read at the top**

Change the imports line:
```ts
import { writeFile, mkdir } from "node:fs/promises";
```
to:
```ts
import { writeFile, readFile, mkdir } from "node:fs/promises";
```

After `await mkdir("out", { recursive: true });` add:
```ts
await mkdir("state", { recursive: true });
let used: string[] = [];
try { used = JSON.parse(await readFile("state/used-topics.json", "utf8")); } catch {}
```

- [ ] **Step 2: Inject the avoid-list into the planner prompt**

In `planPrompt`, immediately after the first line ("...real behavioral science."), insert a new line:
```ts

AVOID repeating any of these already-used titles/topics (pick a clearly different angle): ${used.length ? used.join("; ") : "(none yet)"}.
```

- [ ] **Step 3: Persist the chosen topic**

Immediately after `const plan = JSON.parse(await generate(planPrompt, planSchema));` add:
```ts
used.push(plan.title);
await writeFile("state/used-topics.json", JSON.stringify(used.slice(-300), null, 1));
```

- [ ] **Step 4: Replace the SVG prompt with a transparent character**

Replace the whole `const svgPrompt = (visual: string) => ` template (lines ~37-53) with:
```ts
const svgPrompt = (visual: string) => `Draw ONE clean, friendly hand-drawn DOODLE CHARACTER as inline SVG — a single subject on a TRANSPARENT background (it will be composited on top of a photo).

SCENE: ${visual}

STYLE — match exactly:
- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"> with NO background rect (fully transparent).
- ONE simple, cute, WELL-PROPORTIONED character (or single object) doing the action, centered, filling most of the 1000x1000 box.
- Thick black outlines (#1d1d1d, stroke-width 10-16), bright flat color fills (teal #2bb3a3, red #e8503a, blue #3a6ea5, yellow #ffd23f, skin #ffe2c2). Round head, simple body, tube limbs. No gradients, no shading, no text/letters/numbers, no scenery or background.
- Build ONLY from primitives: <circle> <ellipse> <rect> <line> <path> <polygon>, grouped with <g>.

Output ONLY the raw <svg>...</svg> markup. No markdown, no explanation.`;
```

- [ ] **Step 5: Verify dedup + transparency on a tiny run**

Run:
```bash
set -a; source .env; set +a
SCRIPT_PROVIDER=claude DOODLE_WORDS=120 DOODLE_SCENES=2 npx tsx src/scripts/gen-doodle-long.ts
echo "--- scenes have transparent svg (no full-frame bg rect, viewBox 1000): ---"
npx tsx -e 'const s=require("fs").readFileSync("out/scenes.json","utf8"); const a=JSON.parse(s); console.log("scenes:",a.length); console.log("viewBox 1000?",/viewBox="0 0 1000 1000"/.test(a[0].svg)); console.log("has bg rect fffdf8?",/fffdf8/.test(a[0].svg));'
echo "--- topic appended to used-topics: ---"
tail -n 3 state/used-topics.json
```
Expected: `scenes: 2`, `viewBox 1000? true`, `has bg rect fffdf8? false`, and the new title visible in used-topics.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/gen-doodle-long.ts state/used-topics.json
git commit -m "feat: topic dedup + transparent doodle-host SVGs in gen-doodle-long"
```

---

### Task 5: `gen-bg-stock.ts` — per-sentence stock keywords + fetch

**Files:**
- Create: `src/scripts/gen-bg-stock.ts`

**Interfaces:**
- Consumes: `out/story.json` (`script`), `lib/sentences.splitForVisuals`, `lib/llm.generate`, `lib/stock.{searchPhoto,downloadPhoto}`, `lib/normalize-image.normalizeImage`.
- Produces: `out/bg-1.jpg … out/bg-N.jpg` where `N = splitForVisuals(script).length`; `out/bg.json` (`{queries}`).

- [ ] **Step 1: Write the script**

```ts
// src/scripts/gen-bg-stock.ts
import "dotenv/config";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { splitForVisuals } from "../lib/sentences.js";
import { generate } from "../lib/llm.js";
import { searchPhoto, downloadPhoto } from "../lib/stock.js";
import { normalizeImage } from "../lib/normalize-image.js";

await mkdir("out", { recursive: true });
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const units = splitForVisuals(story.script);
const schema = { type: "object", properties: { queries: { type: "array", items: { type: "string" } } }, required: ["queries"] };

// 1) one concrete stock-search query per narration line (batched)
const queries: string[] = [];
const BATCH = 40;
for (let i = 0; i < units.length; i += BATCH) {
  const batch = units.slice(i, i + BATCH);
  const numbered = batch.map((s, j) => `${j + 1}. ${s}`).join("\n");
  const bp = `Below are numbered narration lines (in order) from a money & behavior psychology video. For EACH line, write ONE concrete, literal stock-photo SEARCH QUERY of 2-5 words describing a real, photographable scene that matches the line — a person, place, object, or action (e.g. "person counting coins", "empty wallet on table", "busy city commute", "woman shopping online", "calm sunrise over hills"). Prefer everyday money/life and natural-environment settings. Avoid abstract words (psychology, behavior, emotion), avoid text, charts, logos, and brand names.
Return JSON {"queries":[...]} with EXACTLY ${batch.length} queries, one per line, in order.

Lines:
${numbered}`;
  const out = JSON.parse(await generate(bp, schema));
  let arr: string[] = Array.isArray(out.queries) ? out.queries.map((x: any) => String(x).trim()).filter(Boolean) : [];
  while (arr.length < batch.length) arr.push(batch[arr.length].split(/\s+/).slice(0, 4).join(" "));
  if (arr.length > batch.length) arr = arr.slice(0, batch.length);
  queries.push(...arr);
  console.log(`  queries ${Math.min(i + BATCH, units.length)}/${units.length}`);
}

// 2) fetch + normalize one photo per query; reuse previous on a miss so a run never fails
const used = new Set<string>();
let lastGood: string | null = null;
for (let i = 0; i < queries.length; i++) {
  const out = `out/bg-${i + 1}.jpg`;
  const cand = await searchPhoto(queries[i], used, i);
  if (cand) {
    try {
      await normalizeImage(await downloadPhoto(cand), out);
      lastGood = out;
      console.log(`  bg-${i + 1}/${queries.length} ✓ [${cand.src}] ${queries[i]}`);
      continue;
    } catch (e) { console.error(`  bg-${i + 1} download failed: ${e}`); }
  }
  if (lastGood) { await copyFile(lastGood, out); console.log(`  bg-${i + 1}: reused previous (no match for "${queries[i]}")`); continue; }
  const generic = await searchPhoto("calm natural landscape", used, i);
  if (generic) { await normalizeImage(await downloadPhoto(generic), out); lastGood = out; console.log(`  bg-${i + 1}: generic fallback`); }
  else { console.error(`bg-${i + 1} FAILED with no fallback`); process.exit(1); }
}

await writeFile("out/bg.json", JSON.stringify({ queries }, null, 1));
console.log(`✅ ${queries.length} stock backgrounds`);
```

- [ ] **Step 2: Verify on the scenes from Task 4**

Run (uses `out/story.json` produced in Task 4 Step 5):
```bash
set -a; source .env; set +a
SCRIPT_PROVIDER=claude ORIENT=landscape npx tsx src/scripts/gen-bg-stock.ts
ls out/bg-*.jpg | head
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 out/bg-1.jpg
```
Expected: several `out/bg-*.jpg`, first one reports `1920,1080`. The count equals `splitForVisuals(script).length`.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/gen-bg-stock.ts
git commit -m "feat: per-sentence stock background fetch (Pexels->Pixabay)"
```

---

### Task 6: `prepare-host.ts` — props for HostVideo

**Files:**
- Create: `src/scripts/prepare-host.ts`

**Interfaces:**
- Consumes: `out/story.json`, `out/scenes.json`, `out/words.json`, `lib/timing.{alignByWordCount,buildCaptionLines}`, `lib/sentences.{splitForVisuals,words}`.
- Produces: `out/props.json` =
  `{ fps, durationInFrames, narrationDurSec, fadeTailSec, audioSrc, images:string[], segments:Seg[], scenes:{svg,start,end}[], lines:Line[], title, channel, portrait }`.

- [ ] **Step 1: Write the script**

```ts
// src/scripts/prepare-host.ts
import { readFile, writeFile } from "node:fs/promises";
import { splitForVisuals, words as countWords } from "../lib/sentences.js";
import { alignByWordCount, buildCaptionLines, type Word } from "../lib/timing.js";

const fps = 30;
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const scenes: { narration: string; visual: string; svg: string }[] = JSON.parse(await readFile("out/scenes.json", "utf8"));
const words: Word[] = JSON.parse(await readFile("out/words.json", "utf8")).map((x: any) => ({ w: String(x.w), start: +x.start, end: +x.end }));
if (!words.length) { console.error("No timing in out/words.json"); process.exit(1); }
const narrationDur = words[words.length - 1].end;

const units = splitForVisuals(story.script);
const segments = alignByWordCount(units.map(countWords), words, narrationDur);
const sceneSegs = alignByWordCount(scenes.map((s) => countWords(s.narration)), words, narrationDur);
const sceneOut = scenes.map((s, k) => ({ svg: s.svg, start: sceneSegs[k].start, end: sceneSegs[k].end }));
const lines = buildCaptionLines(words, Number(process.env.CAPTION_WORDS || 4));

const tail = 2.5;
const durationInFrames = Math.round((narrationDur + tail) * fps);
const props = {
  fps, durationInFrames, narrationDurSec: narrationDur, fadeTailSec: tail,
  audioSrc: "narration.mp3",
  images: units.map((_, i) => `bg-${i + 1}.jpg`),
  segments, scenes: sceneOut, lines,
  title: story.onScreenTitle || story.title,
  channel: "InfotainmentStu",
  portrait: process.env.ORIENT === "portrait",
};
await writeFile("out/props.json", JSON.stringify(props));
console.log(`words=${words.length} units=${units.length} scenes=${scenes.length} dur=${narrationDur.toFixed(1)}s frames=${durationInFrames}`);
```

- [ ] **Step 2: Verify (needs narration first)**

Run:
```bash
set -a; source .env; set +a
npx tsx src/scripts/narrate-edge.ts
ORIENT=landscape npx tsx src/scripts/prepare-host.ts
npx tsx -e 'const p=JSON.parse(require("fs").readFileSync("out/props.json","utf8")); console.log({images:p.images.length, segments:p.segments.length, scenes:p.scenes.length, lines:p.lines.length, dur:p.narrationDurSec}); console.log("images==segments:", p.images.length===p.segments.length); console.log("seg0",p.segments[0],"scene0",{start:p.scenes[0].start,end:p.scenes[0].end});'
```
Expected: `images == segments` is `true`; `segments` length equals `bg-*.jpg` count from Task 5; first segment starts at 0-ish.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/prepare-host.ts
git commit -m "feat: prepare-host props (per-sentence photo + per-scene doodle timing)"
```

---

### Task 7: `HostVideo.tsx` composition + Root registration

**Files:**
- Create: `src/remotion/HostVideo.tsx`
- Modify: `src/remotion/Root.tsx`

**Interfaces:**
- Consumes: `out/props.json` shape from Task 6.
- Produces: Remotion compositions `HostVideo` (1920×1080) and `HostShort` (1080×1920).

- [ ] **Step 1: Write the composition**

```tsx
// src/remotion/HostVideo.tsx
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig, staticFile, Easing } from "remotion";

type CaptionWord = { text: string; start: number; end: number };
type Line = { start: number; end: number; words: CaptionWord[] };
type Seg = { start: number; end: number };
type Scene = { svg: string; start: number; end: number };

export type HostProps = {
  fps: number; durationInFrames: number; narrationDurSec: number; fadeTailSec: number;
  audioSrc: string; musicSrc?: string;
  images: string[]; segments: Seg[]; scenes: Scene[]; lines: Line[];
  title: string; channel: string; portrait?: boolean;
};

const ACCENT = "#ff5a3c";
const DIM = "#e9e9e2";
const END = "#0e0e0e";

// Background photo with a slow Ken Burns move, timed to its sentence.
const BgImage: React.FC<{ src: string; dur: number; idx: number }> = ({ src, dur, idx }) => {
  const f = useCurrentFrame();
  const zoomIn = idx % 2 === 0;
  const scale = interpolate(f, [0, dur], zoomIn ? [1.06, 1.14] : [1.14, 1.06], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  const panX = interpolate(f, [0, dur], idx % 2 === 0 ? [-1.2, 1.2] : [1.2, -1.2], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  const fade = Math.min(8, Math.floor(dur / 3));
  const opacity = fade >= 1 && dur - fade > fade
    ? interpolate(f, [0, fade, dur - fade, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  return (
    <AbsoluteFill style={{ opacity }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translateX(${panX}%)` }} />
    </AbsoluteFill>
  );
};

// Doodle host: left->right "draw-on" wipe, then ONE gentle idle bob. Sits on a translucent stage.
const DoodleHost: React.FC<{ svg: string; dur: number; portrait: boolean }> = ({ svg, dur, portrait }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const revealFrames = Math.min(Math.round(0.6 * fps), Math.max(1, Math.floor(dur / 2)));
  const reveal = interpolate(f, [0, revealFrames], [100, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }); // % clipped from the right
  const pop = interpolate(f, [0, revealFrames], [0.96, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const bob = f > revealFrames ? Math.sin(((f - revealFrames) / fps) * Math.PI * 2 * 0.5) * 6 : 0;
  const size = portrait ? "64%" : "34%";
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: portrait ? 40 : 64, paddingBottom: portrait ? 540 : 150 }}>
      <style>{`.host-svg svg{width:100%;height:100%;display:block}`}</style>
      <div style={{ width: size, aspectRatio: "1 / 1", background: "rgba(255,253,248,0.82)", borderRadius: 28, boxShadow: "0 10px 30px rgba(0,0,0,0.22)", padding: 18, transform: `translateY(${bob}px) scale(${pop})` }}>
        <div className="host-svg" style={{ width: "100%", height: "100%", clipPath: `inset(0 ${reveal}% 0 0)` }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </AbsoluteFill>
  );
};

export const HostVideo: React.FC<HostProps> = (props) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;
  const portrait = props.portrait ?? false;
  const n = props.images.length;
  const xfade = Math.round(0.3 * fps);

  const segs: Seg[] = props.segments && props.segments.length === n
    ? props.segments
    : props.images.map((_, i) => ({ start: (i * props.narrationDurSec) / n, end: ((i + 1) * props.narrationDurSec) / n }));

  const titleOpacity = portrait ? 1 : interpolate(t, [0.3, 1.1, 3.8, 4.6], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const endStart = props.narrationDurSec - 0.2;
  const whiteOut = interpolate(t, [endStart, endStart + props.fadeTailSec], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const line = props.lines.find((l) => t >= l.start && t <= l.end) ?? null;

  return (
    <AbsoluteFill style={{ backgroundColor: END }}>
      {/* per-sentence background photos */}
      {props.images.map((src, i) => {
        const seg = segs[i];
        const start = Math.round(seg.start * fps);
        const from = i === 0 ? 0 : start;
        const isLast = i === n - 1;
        const end = isLast ? props.durationInFrames : Math.round(seg.end * fps) + xfade;
        const dur = Math.max(1, end - from);
        return (
          <Sequence key={`bg-${i}`} from={Math.max(0, from)} durationInFrames={dur}>
            <BgImage src={src} dur={dur} idx={i} />
          </Sequence>
        );
      })}

      {/* legibility scrim */}
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.20) 62%, rgba(0,0,0,0.52) 100%)" }} />

      {/* doodle host per scene */}
      {props.scenes.map((s, i) => {
        const from = Math.round(s.start * fps);
        const isLast = i === props.scenes.length - 1;
        const end = isLast ? props.durationInFrames : Math.round(s.end * fps);
        const dur = Math.max(1, end - from);
        return (
          <Sequence key={`sc-${i}`} from={Math.max(0, from)} durationInFrames={dur}>
            <DoodleHost svg={s.svg} dur={dur} portrait={portrait} />
          </Sequence>
        );
      })}

      {/* title card */}
      <AbsoluteFill style={{ justifyContent: portrait ? "flex-start" : "center", alignItems: "center", paddingTop: portrait ? 120 : 0, opacity: titleOpacity }}>
        <div style={{ color: "#fff", fontSize: portrait ? 80 : 96, fontWeight: 900, fontFamily: "'Arial Black', Arial, sans-serif", textAlign: "center", lineHeight: 1.04, maxWidth: "86%", textShadow: "0 4px 24px rgba(0,0,0,0.6)", padding: "10px 30px" }}>{props.title}</div>
      </AbsoluteFill>

      {/* word-by-word captions */}
      {line && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: portrait ? 360 : 70 }}>
          <div style={{ background: "rgba(0,0,0,0.55)", padding: "16px 34px", borderRadius: 16, maxWidth: "90%" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", gap: "6px 22px", fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 800, fontSize: portrait ? 60 : 52, lineHeight: 1.15 }}>
              {line.words.map((w, k) => {
                const spoken = t >= w.start;
                const active = t >= w.start && t <= w.end;
                return <span key={k} style={{ color: active ? ACCENT : spoken ? "#fff" : DIM }}>{w.text}</span>;
              })}
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* watermark */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: 36 }}>
        <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 30, fontWeight: 800, fontFamily: "Arial, sans-serif", textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>{props.channel}</div>
      </AbsoluteFill>

      {/* end fade */}
      <AbsoluteFill style={{ backgroundColor: END, opacity: whiteOut }} />

      <Audio src={staticFile(props.audioSrc)} />
      {props.musicSrc ? <Audio src={staticFile(props.musicSrc)} volume={0.18} /> : null}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Register both compositions in Root.tsx**

Add the import near the other component imports:
```tsx
import { HostVideo, HostProps } from "./HostVideo";
```
Add these two `<Composition>` blocks inside the fragment (after the `ExplainerVideo` block):
```tsx
      <Composition
        id="HostVideo"
        component={HostVideo as React.FC<Record<string, unknown>>}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={(defaultProps as unknown as HostProps).durationInFrames}
        defaultProps={defaultProps as unknown as HostProps}
        calculateMetadata={({ props }) => meta(props as unknown as HostProps)}
      />
      <Composition
        id="HostShort"
        component={HostVideo as React.FC<Record<string, unknown>>}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={(defaultProps as unknown as HostProps).durationInFrames}
        defaultProps={defaultProps as unknown as HostProps}
        calculateMetadata={({ props }) => meta(props as unknown as HostProps)}
      />
```

- [ ] **Step 3: Verify the bundle compiles + a single still renders**

Run (uses props.json + bg images + narration from Tasks 4-6):
```bash
set -a; source .env; set +a
cp out/narration.mp3 public/narration.mp3 2>/dev/null; mkdir -p public
for f in out/bg-*.jpg; do cp "$f" "public/$(basename "$f")"; done
cp out/narration.mp3 public/narration.mp3
npx remotion still src/remotion/index.ts HostVideo /tmp/host-frame.png --props=./out/props.json --frame=120 --log=error
echo "rendered:" && ls -la /tmp/host-frame.png
```
Expected: `/tmp/host-frame.png` exists (a frame showing a photo background + doodle host + caption). Open it to eyeball composition.

- [ ] **Step 4: Commit**

```bash
git add src/remotion/HostVideo.tsx src/remotion/Root.tsx
git commit -m "feat: HostVideo composition (photo bg + doodle host + draw-on)"
```

---

### Task 8: `make-daily.ts` — long-video orchestrator

**Files:**
- Create: `src/scripts/make-daily.ts`

**Interfaces:**
- Consumes: all scripts above + `narrate-edge.ts`, `publish.ts`, Remotion `HostVideo`/`Thumbnail`.
- Produces: `out/story.mp4`, `out/thumbnail.jpg`; uploads via `publish.ts` unless `NO_PUBLISH` set.

- [ ] **Step 1: Write the orchestrator**

```ts
// src/scripts/make-daily.ts
import { spawn } from "node:child_process";
import { readFile, copyFile, mkdir, rm } from "node:fs/promises";

// Daily long video: script + transparent doodle host scenes (Claude) -> per-sentence stock
// backgrounds (Pexels->Pixabay) -> edge-tts -> HostVideo render -> thumbnail -> publish.
const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} -> exit ${c}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };
const LAND = { ORIENT: "landscape" };
const conc = process.env.RENDER_CONCURRENCY || "4";

await step("1/7 script + doodle host scenes (Claude)", () => run("npx", ["tsx", "src/scripts/gen-doodle-long.ts"]));
await step("2/7 per-sentence stock backgrounds", () => run("npx", ["tsx", "src/scripts/gen-bg-stock.ts"], LAND));
await step("3/7 narrate (edge-tts)", () => run("npx", ["tsx", "src/scripts/narrate-edge.ts"]));
await step("4/7 props (timing + captions)", () => run("npx", ["tsx", "src/scripts/prepare-host.ts"], LAND));
await step("5/7 stage assets", async () => {
  await rm("public", { recursive: true, force: true }).catch(() => {});
  await mkdir("public", { recursive: true });
  const props = JSON.parse(await readFile("out/props.json", "utf8"));
  for (const img of props.images) await copyFile(`out/${img}`, `public/${img}`);
  await copyFile("out/narration.mp3", "public/narration.mp3");
});
await step("6/7 render -> out/story.mp4", () =>
  run("npx", ["remotion", "render", "src/remotion/index.ts", "HostVideo", "out/story.mp4", "--props=./out/props.json", `--concurrency=${conc}`, "--log=error"]));
await step("7/7 thumbnail", () =>
  run("npx", ["remotion", "still", "src/remotion/index.ts", "Thumbnail", "out/thumbnail.jpg", "--props=./out/props.json", "--log=error"])
    .catch((e) => console.error("thumbnail failed (non-fatal):", e)));

if (process.env.NO_PUBLISH) console.log("\nNO_PUBLISH set — skipping upload.");
else await step("publish (YouTube)", () => run("npx", ["tsx", "src/scripts/publish.ts"]));

console.log("\n✅ daily host video complete");
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/make-daily.ts
git commit -m "feat: make-daily long-video orchestrator (NO_PUBLISH supported)"
```

(Full end-to-end run is exercised in Task 11.)

---

### Task 9: `make-short-host.ts` — Short orchestrator (portrait)

**Files:**
- Create: `src/scripts/make-short-host.ts`

**Interfaces:**
- Consumes: same scripts in portrait mode; renders `HostShort` → `out/short.mp4` (the path `publish-short.ts` reads).

- [ ] **Step 1: Write the orchestrator**

```ts
// src/scripts/make-short-host.ts
import { spawn } from "node:child_process";
import { readFile, copyFile, mkdir, rm } from "node:fs/promises";

// Vertical Short: same engine as make-daily but portrait + short. Renders out/short.mp4
// (publish-short.ts uploads it). Does NOT publish here.
const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} -> exit ${c}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };
const PORT = { ORIENT: "portrait" };
const GEN = { ...PORT, DOODLE_WORDS: process.env.SHORT_WORDS || "130", DOODLE_SCENES: process.env.SHORT_SCENES || "3" };
const conc = process.env.RENDER_CONCURRENCY || "4";

await step("1/6 script + doodle host (Claude)", () => run("npx", ["tsx", "src/scripts/gen-doodle-long.ts"], GEN));
await step("2/6 stock backgrounds (portrait)", () => run("npx", ["tsx", "src/scripts/gen-bg-stock.ts"], PORT));
await step("3/6 narrate (edge-tts)", () => run("npx", ["tsx", "src/scripts/narrate-edge.ts"]));
await step("4/6 props (portrait)", () => run("npx", ["tsx", "src/scripts/prepare-host.ts"], PORT));
await step("5/6 stage assets", async () => {
  await rm("public", { recursive: true, force: true }).catch(() => {});
  await mkdir("public", { recursive: true });
  const props = JSON.parse(await readFile("out/props.json", "utf8"));
  for (const img of props.images) await copyFile(`out/${img}`, `public/${img}`);
  await copyFile("out/narration.mp3", "public/narration.mp3");
});
await step("6/6 render -> out/short.mp4", () =>
  run("npx", ["remotion", "render", "src/remotion/index.ts", "HostShort", "out/short.mp4", "--props=./out/props.json", `--concurrency=${conc}`, "--log=error"]));

console.log("\n✅ doodle-host short rendered: out/short.mp4");
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/make-short-host.ts
git commit -m "feat: make-short-host portrait Short orchestrator"
```

---

### Task 10: Update `daily.yml` workflow

**Files:**
- Modify: `.github/workflows/daily.yml:73-102`

**Interfaces:**
- Consumes GitHub secrets `PEXELS_API_KEY`, `PIXABAY_API_KEY` (user adds these).

- [ ] **Step 1: Point the long step at make-daily + new env**

In the "Build + upload daily doodle video" step, change `DOODLE_WORDS` default `'330'`→`'1350'`, `DOODLE_SCENES` `"6"`→`"12"`, add the two stock keys, and change the run command. The step's `env:` block becomes:
```yaml
        env:
          SCRIPT_PROVIDER: "claude"
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          VOICE_PROVIDER: "edge"
          EDGE_VOICE: "en-US-AndrewNeural"
          DOODLE_WORDS: ${{ github.event.inputs.words || '1350' }}
          DOODLE_SCENES: "12"
          PEXELS_API_KEY: ${{ secrets.PEXELS_API_KEY }}
          PIXABAY_API_KEY: ${{ secrets.PIXABAY_API_KEY }}
          RENDER_CONCURRENCY: "2"
          PUBLISH_MODE: "approval"
          YT_CLIENT_ID: ${{ secrets.YT_CLIENT_ID }}
          YT_CLIENT_SECRET: ${{ secrets.YT_CLIENT_SECRET }}
          YT_REFRESH_TOKEN: ${{ secrets.YT_REFRESH_TOKEN }}
          DISCORD_WEBHOOK: ${{ secrets.DISCORD_WEBHOOK }}
        run: npx tsx src/scripts/make-daily.ts
```
Also update the input description default for `words` (line 11) from `"330"` to `"1350"`.

- [ ] **Step 2: Point the Short step at make-short-host + stock keys**

The "Build + upload doodle Short" step `env:` adds the stock keys, and its `run:` becomes:
```yaml
          PEXELS_API_KEY: ${{ secrets.PEXELS_API_KEY }}
          PIXABAY_API_KEY: ${{ secrets.PIXABAY_API_KEY }}
          RENDER_CONCURRENCY: "2"
```
```yaml
        run: |
          npx tsx src/scripts/make-short-host.ts
          npx tsx src/scripts/publish-short.ts
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/daily.yml
git commit -m "ci: daily.yml runs stock+doodle-host pipeline at 8-9min"
```

---

### Task 11: 1-minute local acceptance test

**Files:** none (runs the pipeline end to end at 1-min length, no upload).

- [ ] **Step 1: Run the full long pipeline locally at ~1 min, no publish**

```bash
set -a; source .env; set +a
rm -rf out public && mkdir -p out public
SCRIPT_PROVIDER=claude NO_PUBLISH=1 DOODLE_WORDS=150 DOODLE_SCENES=2 RENDER_CONCURRENCY=4 \
  npx tsx src/scripts/make-daily.ts
```
Expected: completes through "render -> out/story.mp4"; prints "NO_PUBLISH set — skipping upload."

- [ ] **Step 2: Inspect the output**

```bash
ffprobe -v error -show_entries format=duration:stream=width,height -of default=noprint_wrappers=1 out/story.mp4
ls -la out/story.mp4 out/thumbnail.jpg
```
Expected: ~60–75s duration, 1920×1080. Open `out/story.mp4` and `out/thumbnail.jpg`.

- [ ] **Step 3: User review checkpoint**

Confirm with the user: per-sentence photo changes, doodle host draws on then bobs (no jitter), captions in sync, no white background, topic differs from `state/used-topics.json`. If the doodle-over-photo look needs tuning, adjust `DoodleHost` size/opacity/placement in `HostVideo.tsx` and re-render only:
```bash
npx remotion render src/remotion/index.ts HostVideo out/story.mp4 --props=./out/props.json --concurrency=4 --log=error
```

- [ ] **Step 4: Commit any tuning**

```bash
git add -A && git commit -m "chore: tune doodle-host placement after 1-min review"
```

---

## Self-Review

**Spec coverage:**
- #1 same topic → Task 4 (used-topics read/write). ✓
- #2 length → Task 10 (`DOODLE_WORDS 1350`, `DOODLE_SCENES 12`). ✓
- #3 shaking → Task 7 (draw-on wipe + single bob; old anim classes removed in Task 4 SVG prompt). ✓
- #4 white bg → Tasks 2/5/7 (stock photos + transparent doodle). ✓
- #5 per-sentence/timing → Tasks 1/6/7 (`alignByWordCount` segments, `BgImage` per segment). ✓
- Stock source Pexels→Pixabay → Task 2. ✓
- Token plan (Claude only, no downgrade) → inherent; no Gemini wiring added. ✓
- Shorts → Task 9. ✓
- Render feasibility (`RENDER_CONCURRENCY`) → Tasks 8/9/10. ✓
- 1-min test → Task 11. ✓

**Placeholder scan:** none — every code/test step has full content.

**Type consistency:** `Word/Seg/Line` from `lib/timing.ts` (Task 1) reused by `prepare-host.ts` (Task 6) and mirrored in `HostVideo.tsx` props (Task 7). `Candidate` from `lib/stock.ts` (Task 2) used by `gen-bg-stock.ts` (Task 5). `props.json` keys (`images, segments, scenes, lines, narrationDurSec, fadeTailSec, durationInFrames, fps, audioSrc, title, channel, portrait`) written by Task 6 and read by Task 7 — match. `out/short.mp4` (Task 9) matches `publish-short.ts`. ✓

## Notes on commits

Per the user's harness rule ("commit only when asked; branch off `main` first"), execution will create a `feat/stock-bg-doodle-host` branch and **hold the actual commits until the user approves the 1-min test video** — the per-task `git commit` steps above are the intended structure, batched at approval.
