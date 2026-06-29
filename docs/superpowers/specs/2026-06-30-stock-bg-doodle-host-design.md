# Stock-Photo Background + Doodle Host — Daily Video Redesign

Date: 2026-06-30
Status: Approved design (pending user review)
Channel: InfotainmentStu — psychology of money & behavior

## 1. Problem & Context

The daily GitHub Actions pipeline ([.github/workflows/daily.yml](../../../.github/workflows/daily.yml))
runs the **AI-drawn SVG doodle** engine: `make-daily-doodle.ts` → `gen-doodle-long.ts`.
(The `make-video.ts` / `gen-scenes-comfy.ts` / `ExplainerVideo.tsx` photo path is local-only and
depends on a ComfyUI server that cannot run on a free GitHub runner.)

Five confirmed defects, with root causes:

1. **Same topic repeats** — `gen-doodle-long.ts` never reads or writes `state/used-topics.json`.
   It has no memory of past videos. (Only the unused `gen-script.ts` has dedup.)
2. **Only ~2 min** — workflow hard-sets `DOODLE_WORDS: "330"` (~2.2 min), `DOODLE_SCENES: "6"`.
3. **"Everything shaking"** — [DoodleScene.tsx](../../../src/remotion/DoodleScene.tsx) applies continuous,
   out-of-phase sine wobbles (`bob`/`float`/`sway`) to sub-elements of a static AI-drawn SVG. There is no
   real draw-on reveal; the result is jitter on a crude drawing.
4. **Plain white background** — `BG = "#fffdf8"` plus every SVG paints a full-frame off-white `<rect>`.
5. **Not per-sentence / mistimed** — the doodle engine is per-**scene** (6 doodles for the whole video,
   ~22s each), not per-sentence. (The `ExplainerVideo` path already does correct per-sentence timing, but
   CI does not run it.)

## 2. Goals / Non-Goals

**Goals**
- Real copyright-free **environmental/cinematic photos** as the per-sentence background (fixes #4, #5).
- **Keep the doodle character** as a per-scene on-screen **host** over the photos, with the animation
  fixed to a proper draw-on reveal + a single tasteful idle motion (fixes #3).
- **8–9 min** long videos to start, tunable toward 11 (fixes #2).
- **Topic variety** via real used-topics dedup (fixes #1).
- Keep cost sane: per-sentence images are now **free stock photos**, not AI generations.

**Non-Goals (this iteration)**
- No ComfyUI / RealVisXL path (cannot run on CI). The local `comfy.ts` / `gen-scenes-comfy.ts` files
  are left untouched but unused by CI.
- No stock **video** clips (too heavy to render 8–11 min on a free runner) — stills only.
- No change to the YouTube upload/publish layer or auth.

## 3. Decisions (locked)

- **Visual style:** real photo background (per sentence) + doodle host character (per scene) + captions.
- **Stock source:** Pexels primary, Pixabay fallback. Free API keys as GitHub secrets.
- **Text model:** everything stays on **Claude** (Max subscription via `SCRIPT_PROVIDER=claude`). No new
  text API key. Script text is cheap relative to SVGs; the big saving is that per-sentence images are
  stock, not AI.
- **Doodle policy:** **always show** the doodle host on every scene. Generation keeps retries for
  robustness, but there is no "hide the doodle" fallback.

## 4. Architecture

Three render layers, each doing what it is good at:

| Layer | Content | Cadence | Source |
|---|---|---|---|
| Background | environmental/cinematic **photo** matching the sentence | **per sentence**, word-timing aligned | Pexels → Pixabay |
| Doodle host | the channel's doodle character, **transparent** (no bg rect), on a translucent "stage" | **per scene** (~8–14) | Claude SVG |
| Captions | word-by-word highlight | per word | edge-tts timings |

Division of labor: the **photo illustrates each sentence** (the literal content); the **doodle host is the
persistent brand mascot** for the scene. A subtle dark scrim + translucent stage panel keep the doodle and
captions legible over any photo.

### 4.1 Pipeline (new long path)

Orchestrator: `make-daily.ts` (new; replaces `make-daily-doodle.ts` in the workflow). Steps:

1. **`gen-doodle-long.ts` (modified)** — Claude writes the plan + per-scene narration, **now**:
   - reads `state/used-topics.json`, passes the list to the planner as "avoid these", and appends the new
     title + writes back `used-topics.json` (slice last 300). (Fix #1.)
   - emits `out/story.json` (title, onScreenTitle, description, tags, full `script`), and
     `out/scenes.json` = `[{ narration, visual, svg }]` where `svg` is a **transparent character only**
     (new SVG prompt — see 4.4). Scene count = `DOODLE_SCENES` env (CI: 12, ≈110–120 words/scene for
     8–9 min). (Fix #2, #3 prep.)
2. **`gen-bg-stock.ts` (new)** — split `script` into per-sentence visual units with `splitForVisuals`
   (the same deterministic splitter `prepare` uses), ask Claude for ONE concrete 2–5 word **stock search
   query** per unit (batched, like `gen-script`), then fetch + download a photo per unit via
   `lib/stock.ts`, normalize to 1920×1080, write `out/bg-1.jpg … bg-N.jpg`. Write `out/bg.json` =
   `{ queries: string[] }` for debugging. (Fix #4, #5.)
3. **`narrate-edge.ts` (unchanged)** — edge-tts → `out/narration.mp3` + `out/words.json` (real word timings).
4. **`prepare-host.ts` (new; merges `prepare-render` + `prepare-doodle`)** — builds:
   - `segments[]` — per-sentence background timing, by walking the word stream and advancing by each
     unit's word count (exact algorithm already in `prepare-render.ts:45-70`).
   - `sceneSegments[]` — per-scene doodle timing, by walking the word stream advancing by each scene's
     narration word count (algorithm already in `prepare-doodle.ts:22-30`).
   - `lines[]` — word-by-word caption lines.
   - Emits `out/props.json` for the `HostVideo` composition (shape in 4.5).
5. **Render** `HostVideo` (landscape) → `out/story.mp4`.
6. **Thumbnail** — render a still (reuse a thumbnail comp; photo[0] + title overlay).
7. **`publish.ts` (unchanged)** — upload to YouTube (private for review under `PUBLISH_MODE=approval`).

### 4.2 `lib/stock.ts` (new)

Free stock photo client. Public API:

```ts
export type StockPhoto = { id: string; url: string; src: "pexels" | "pixabay" };
// Search Pexels first, then Pixabay; return best landscape candidate not in `exclude`.
export async function searchPhoto(query: string, exclude: Set<string>, seed: number): Promise<StockPhoto | null>;
// Download bytes for a chosen photo.
export async function downloadPhoto(p: StockPhoto): Promise<Buffer>;
```

- **Pexels:** `GET https://api.pexels.com/v1/search?query=…&orientation=landscape&per_page=15&size=large`,
  header `Authorization: <PEXELS_API_KEY>`. Use `photos[i].src.large2x` (≈1880px) as the download URL.
- **Pixabay:** `GET https://pixabay.com/api/?key=<PIXABAY_API_KEY>&q=…&image_type=photo&orientation=horizontal&per_page=15&safesearch=true`,
  use `hits[i].largeImageURL`.
- **Normalization:** downloaded bytes → `normalizeImage` → 1920×1080 JPG. (Raise `normalize-image.ts`'s
  landscape target from 1280×720 to 1920×1080 so backgrounds are crisp at the composition's native size.)
- **Candidate selection:** from the top results, pick the first whose `id` is not in `exclude` (per-video
  dedup so two sentences never reuse the same photo); rotate the starting index by `seed` (the unit index)
  for variety. Add the chosen `id` to `exclude`.
- **Fallbacks:** Pexels empty/non-200 → try Pixabay. Both empty → broaden the query to its first 1–2 words
  and retry once. Still nothing → return `null`; caller reuses the previous good image (never crash).
- **Licensing:** both are free for commercial/YouTube use; Pexels needs no attribution, Pixabay is CC0.
  No attribution rendered. Queries instructed to avoid logos/brands/identifiable art.

### 4.3 Stock keyword prompt (in `gen-bg-stock.ts`)

Batched (40/lines per call, like `gen-script.ts`). Instruction: for each narration line, output ONE
concrete, literal **2–5 word** visual stock-search query describing a real photographable scene — a person,
place, object, or action that matches the line. Prefer everyday money/life settings (kitchen tables,
wallets, city commutes, shopping, desks, hands, crowds). Avoid abstractions ("psychology", "behavior"),
text, charts, logos, and brand names. Return `{"queries":[…]}`, exactly one per line, in order.

### 4.4 Doodle character SVG prompt (modified in `gen-doodle-long.ts`)

Change from "full wide scene" to a **single transparent character**:
- Root `<svg … viewBox="0 0 1000 1000">`, **no background rect** (transparent).
- One clean, friendly line-art character (thick `#1d1d1d` outlines, flat fills) doing the scene's action,
  centered, well-proportioned, no text/letters/numbers.
- Keep it simple (fewer primitives) → cheaper + more cohesive over a photo.
- Drop the per-element `anim-*` classes (the old jitter source). Motion is handled by the renderer.

### 4.5 `HostVideo` composition (new `src/remotion/HostVideo.tsx`)

Merge of `ExplainerVideo` (per-sentence Ken-Burns photos) + `DoodleScene` (doodle host), 1920×1080 @ 30fps.
Props (`out/props.json`):

```ts
type HostProps = {
  fps; durationInFrames; narrationDurSec; fadeTailSec; audioSrc; musicSrc?;
  images: string[];            // bg-1.jpg … bg-N.jpg (one per sentence)
  segments: { start; end }[];  // per-sentence timing, aligned to images
  scenes: { svg: string; start; end }[]; // per-scene doodle host, transparent SVG
  lines: Line[];               // word-by-word captions
  title; channel;
};
```

Layer order (back → front):
1. **Background photos** — `PopImage` (Ken Burns zoom/pan) per `segments[i]`, with a 0.3s crossfade
   (reuse `ExplainerVideo` logic).
2. **Scrim** — a soft bottom-up dark gradient (~0→45% black) for caption/doodle legibility.
3. **Doodle host** — for each `scenes[i]`, a `Sequence` over its `[start,end)` rendering the transparent
   SVG inside a translucent rounded "stage" panel anchored bottom-left (~38% width, ~58% height). Animation:
   - **draw-on reveal:** a left→right wipe mask over the doodle group during the first ~0.6s (robust for any
     SVG — the whiteboard "being drawn" feel — instead of fragile per-path stroke animation).
   - **idle:** after reveal, ONE gentle whole-group bob (`translateY` sine, ≤6px, single phase). No
     per-element wobble. (Fix #3.)
4. **Title card** — fades in/out in the first ~4s (reuse existing).
5. **Captions** — word-by-word pill, bottom-center (reuse existing).
6. **Watermark** — channel name.
7. **End fade** to background color.
8. Narration `<Audio>`; optional music `<Audio volume={0.18}>`.

Register `HostVideo` in [Root.tsx](../../../src/remotion/Root.tsx) (landscape 1920×1080 and a portrait
1080×1920 variant `HostShort` for the Short).

### 4.6 Shorts

`make-doodle-short.ts` → `make-short-host.ts`: same engine, portrait `HostShort`, ~45–60s
(`DOODLE_WORDS≈130`, 2–3 scenes, ~12 sentences). Same stock + doodle layers. Out of scope to perfect this
iteration, but it must keep building so the daily run still produces a Short.

## 5. Workflow / config changes

[.github/workflows/daily.yml](../../../.github/workflows/daily.yml):
- Long step runs `src/scripts/make-daily.ts` (was `make-daily-doodle.ts`).
- Env: `DOODLE_WORDS: "1350"`, `DOODLE_SCENES: "12"` (was 330/6); add
  `PEXELS_API_KEY: ${{ secrets.PEXELS_API_KEY }}`, `PIXABAY_API_KEY: ${{ secrets.PIXABAY_API_KEY }}`.
- Short step runs `make-short-host.ts` + `publish-short.ts`.
- Keep `timeout-minutes: 150`; render tuned (see §6).

**New GitHub secrets (user creates):** `PEXELS_API_KEY`, `PIXABAY_API_KEY`.
**Local `.env` (for the test):** same two keys.

## 6. Render feasibility & length

8–9 min @ 30fps ≈ 14.4k–16.2k frames; ~110–130 sentence images to fetch. Mitigations to stay under the
150-min CI budget (which also builds a Short):
- Tune `remotion render --concurrency` to runner cores; consider `--jpeg-quality`/`--scale=1`.
- Photos pre-normalized to 1920×1080 (no per-frame scaling cost beyond Ken Burns transform).
- Start target at ~8–9 min; only push to 11 after a green CI timing run.
- Stock fetch: ~130 requests < Pexels 200/hr; ~40MB download — negligible.

## 7. Token / model plan

- **Claude (Max sub):** script plan + per-scene narration + per-sentence keyword batches + per-scene doodle
  SVGs. SVGs are the main consumer but are now **per-scene (~12), transparent + simpler** → cheaper each.
- **Stock photos:** free, zero tokens.
- Net: token use **per minute drops** vs today, despite 4–5× longer videos.
- No model downgrade required; quality is preserved (downgrading would hit SVG illustration first).

## 8. Testing

- **Unit:** `lib/stock.ts` candidate selection + dedup + fallback (mock fetch); keyword-count == sentence
  count guarantee in `gen-bg-stock`; segment alignment (sentences == images path) in `prepare-host`.
- **Integration / acceptance:** a **1-minute local test** — `DOODLE_WORDS≈150`, `DOODLE_SCENES=2`,
  real Pexels/Pixabay fetch, real edge-tts, real render to `out/story.mp4`. User reviews it before any
  schedule change. This exercises the exact flow CI will run.

## 9. Rollout

1. Build + unit tests green.
2. Generate the 1-min local test video; user approves look/flow.
3. User adds `PEXELS_API_KEY` + `PIXABAY_API_KEY` secrets.
4. Update `daily.yml`; trigger one manual `workflow_dispatch` run at full length; check render time + output.
5. Leave `PUBLISH_MODE=approval` (private upload) until satisfied.

## 10. Risks & mitigations

- **Doodle-over-photo looks mismatched** (flat doodle on photoreal bg). Mitigate: simple cohesive line-art
  on a translucent stage + scrim; user reviews the 1-min test and we tune placement/opacity/size.
- **Render time** blows the CI budget at 11 min. Mitigate: start 8–9 min, measure, tune concurrency/quality.
- **Stock query returns weak/irrelevant photos.** Mitigate: concrete-noun query prompt + per-video dedup +
  query broadening fallback + reuse-previous on total miss.
- **Stock API outage/rate limit.** Mitigate: Pexels→Pixabay fallback; reuse-previous never crashes a run.
```
