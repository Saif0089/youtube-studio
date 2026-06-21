# M2 — Voice (ElevenLabs Narration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a story script (long text) into a single narration `.mp3` in a chosen ElevenLabs voice, fully non-interactively — the audio input the M3 render will sync to.

**Architecture:** A small voice module wraps the **ElevenLabs Text-to-Speech API** via `fetch`. Long scripts are split into safe-sized chunks, each chunk is synthesized, and the chunk audio files are concatenated with `ffmpeg` into one mp3. The voice is a **config value** (`ELEVENLABS_VOICE_ID`) — any voice the account can use (premade to start, your own clone later) works with no code change.

**Tech Stack:** Node 20+, TypeScript, global `fetch`, `ffmpeg` (already installed), `vitest`.

## Global Constraints

- **Language/runtime:** TypeScript on Node 20+, ESM (`.js` import extensions, `NodeNext` resolution — matches M1).
- **Secrets never committed:** `ELEVENLABS_API_KEY` from env (local `.env`, later GitHub Actions secret). `.env` stays git-ignored.
- **Voice is configuration, not code:** `ELEVENLABS_VOICE_ID` is read from env. Any valid ElevenLabs voice id works (premade, community-library with commercial rights, or an own clone). Never hard-code a voice id.
- **Decouple from YouTube config:** add a separate `loadVoiceConfig()` — do NOT make the existing `loadConfig()` (YouTube) require ElevenLabs keys, or the M1 scripts would break.
- **Chunking required:** the TTS endpoint has a per-request character limit; never send a full long script in one call. Split on paragraph/sentence boundaries, never mid-word.
- **Output:** one mp3 file at a caller-specified path; concatenation via `ffmpeg`.
- **TTS endpoint:** `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}`, header `xi-api-key`, `Accept: audio/mpeg`, JSON body `{ text, model_id, voice_settings }`, response body is the mp3 bytes.

---

## Phase 0′ — Prerequisites (owner does once)

- [ ] **P.1** Create an [ElevenLabs](https://elevenlabs.io) account; copy your **API key** (Profile → API Keys).
- [ ] **P.2** Choose a `voiceId`: either pick a **premade voice** (Voices page → copy its Voice ID) to start with zero setup, OR clone your own (Voices → Add → Instant Voice Clone, ~1–3 min of clean audio) and copy that Voice ID.
- [ ] **P.3** Add to `.env`: `ELEVENLABS_API_KEY=...` and `ELEVENLABS_VOICE_ID=...`. (Add the same two keys, empty, to `.env.example` — done in Task 1.)

> Tasks 1–4 build and unit-test with mocks (no key needed). Task 5 (real TTS gate) needs P.1–P.3.

---

## File Structure

```
src/
  config.ts            # MODIFY: add loadVoiceConfig() (separate from loadConfig)
  voice/
    chunk.ts           # chunkText(text, maxChars): string[]
    elevenlabs.ts      # synthesizeChunk(...) + synthesizeNarration(...)
  scripts/
    voice-smoke.ts     # real TTS smoke (M2 gate)
test/
  voice/
    chunk.test.ts
    elevenlabs.test.ts
.env.example           # MODIFY: add ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
```

---

### Task 1: Voice config + .env.example

**Files:**
- Modify: `src/config.ts`, `.env.example`
- Test: `test/config.test.ts` (append)

**Interfaces:**
- Produces: `loadVoiceConfig(env?: NodeJS.ProcessEnv): { apiKey: string; voiceId: string }` — throws listing missing keys (`ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`). Independent of `loadConfig`.

- [ ] **Step 1: Append the failing test** to `test/config.test.ts`

```ts
import { loadVoiceConfig } from "../src/config.js";

describe("loadVoiceConfig", () => {
  it("returns voice keys when present", () => {
    expect(loadVoiceConfig({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v" }))
      .toEqual({ apiKey: "k", voiceId: "v" });
  });
  it("throws listing missing voice keys", () => {
    expect(() => loadVoiceConfig({})).toThrow(/ELEVENLABS_API_KEY.*ELEVENLABS_VOICE_ID/s);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- config`
Expected: FAIL — `loadVoiceConfig` is not exported.

- [ ] **Step 3: Append to `src/config.ts`**

```ts
export interface VoiceConfig { apiKey: string; voiceId: string; }

export function loadVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const map = { ELEVENLABS_API_KEY: env.ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID: env.ELEVENLABS_VOICE_ID };
  const missing = Object.entries(map).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  return { apiKey: map.ELEVENLABS_API_KEY!, voiceId: map.ELEVENLABS_VOICE_ID! };
}
```

- [ ] **Step 4: Append to `.env.example`**

```
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- config`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/config.ts test/config.test.ts .env.example && git commit -m "feat: ElevenLabs voice config (loadVoiceConfig)"
```

---

### Task 2: Text chunker

**Files:**
- Create: `src/voice/chunk.ts`
- Test: `test/voice/chunk.test.ts`

**Interfaces:**
- Produces: `chunkText(text: string, maxChars?: number): string[]` — default `maxChars = 2500`. Splits on paragraph then sentence boundaries; every chunk ≤ maxChars; never splits a word; drops empty chunks; a single over-long sentence is hard-wrapped at word boundaries.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { chunkText } from "../../src/voice/chunk.js";

describe("chunkText", () => {
  it("returns one chunk when text is short", () => {
    expect(chunkText("Hello world.", 100)).toEqual(["Hello world."]);
  });
  it("splits on sentence boundaries within the limit", () => {
    const out = chunkText("Aaaa. Bbbb. Cccc.", 11);
    expect(out.every((c) => c.length <= 11)).toBe(true);
    expect(out.join(" ")).toContain("Aaaa.");
    expect(out.length).toBeGreaterThan(1);
  });
  it("never emits empty chunks", () => {
    expect(chunkText("\n\n  \n", 50)).toEqual([]);
  });
  it("hard-wraps a single over-long sentence at word boundaries", () => {
    const out = chunkText("one two three four five", 9);
    expect(out.every((c) => c.length <= 9)).toBe(true);
    expect(out.join(" ").split(/\s+/)).toEqual(["one","two","three","four","five"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- chunk`
Expected: FAIL — cannot find module `chunk.js`.

- [ ] **Step 3: Implement `src/voice/chunk.ts`**

```ts
export function chunkText(text: string, maxChars = 2500): string[] {
  const pieces = text
    .split(/\n{2,}/)                        // paragraphs
    .flatMap((p) => p.match(/[^.!?]+[.!?]*\s*/g) ?? [p]) // sentences
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ""; };

  for (const piece of pieces) {
    if (piece.length > maxChars) {           // hard-wrap an over-long sentence by words
      push();
      let line = "";
      for (const word of piece.split(/\s+/)) {
        if ((line + " " + word).trim().length > maxChars) { if (line) chunks.push(line.trim()); line = word; }
        else line = (line + " " + word).trim();
      }
      if (line) chunks.push(line.trim());
      continue;
    }
    if ((cur + " " + piece).trim().length > maxChars) push();
    cur = (cur + " " + piece).trim();
  }
  push();
  return chunks;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- chunk`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/chunk.ts test/voice/chunk.test.ts && git commit -m "feat: sentence-aware text chunker for TTS"
```

---

### Task 3: Synthesize one chunk (ElevenLabs API)

**Files:**
- Create: `src/voice/elevenlabs.ts`
- Test: `test/voice/elevenlabs.test.ts`

**Interfaces:**
- Produces: `synthesizeChunk(cfg: VoiceConfig, text: string): Promise<Buffer>` — POSTs to the TTS endpoint with `xi-api-key`, returns the mp3 bytes; throws on non-OK response (including the status).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { synthesizeChunk } from "../../src/voice/elevenlabs.js";

const cfg = { apiKey: "KEY", voiceId: "VOICE" };

beforeEach(() => vi.unstubAllGlobals());

describe("synthesizeChunk", () => {
  it("POSTs to the voice endpoint with the api key and returns mp3 bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const buf = await synthesizeChunk(cfg, "hello");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf).toEqual(Buffer.from([1, 2, 3]));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/VOICE");
    expect(init.method).toBe("POST");
    expect(init.headers["xi-api-key"]).toBe("KEY");
    expect(JSON.parse(init.body).text).toBe("hello");
  });

  it("throws with the status on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad" }));
    await expect(synthesizeChunk(cfg, "x")).rejects.toThrow(/422/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- elevenlabs`
Expected: FAIL — cannot find module `elevenlabs.js`.

- [ ] **Step 3: Implement `synthesizeChunk` in `src/voice/elevenlabs.ts`**

```ts
import type { VoiceConfig } from "../config.js";

const MODEL_ID = "eleven_multilingual_v2";

export async function synthesizeChunk(cfg: VoiceConfig, text: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": cfg.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- elevenlabs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/elevenlabs.ts test/voice/elevenlabs.test.ts && git commit -m "feat: ElevenLabs single-chunk TTS"
```

---

### Task 4: Synthesize full narration (chunk → TTS → ffmpeg concat)

**Files:**
- Modify: `src/voice/elevenlabs.ts`
- Test: `test/voice/elevenlabs.test.ts` (append)

**Interfaces:**
- Consumes: `chunkText` (Task 2), `synthesizeChunk` (Task 3).
- Produces: `synthesizeNarration(cfg: VoiceConfig, text: string, outPath: string): Promise<string>` — chunks `text`, synthesizes each chunk in order, writes them to a temp dir, concatenates to `outPath` with ffmpeg, returns `outPath`. Single-chunk fast path skips concat.

- [ ] **Step 1: Append the failing test**

```ts
import { synthesizeNarration } from "../../src/voice/elevenlabs.js";
import * as elModule from "../../src/voice/elevenlabs.js";

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async () => "/tmp/voiceXXXX"),
  writeFile: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
}));
vi.mock("node:child_process", () => ({ execFile: (..._a: any[]) => {} }));
vi.mock("node:util", async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, promisify: () => vi.fn(async () => ({ stdout: "", stderr: "" })) };
});

it("synthesizes every chunk in order and concatenates to outPath", async () => {
  const spy = vi.spyOn(elModule, "synthesizeChunk").mockResolvedValue(Buffer.from([9]));
  const long = ("Sentence one. Sentence two. " .repeat(300)).trim(); // forces multiple chunks
  const out = await synthesizeNarration(cfg, long, "/out/narration.mp3");
  expect(out).toBe("/out/narration.mp3");
  expect(spy.mock.calls.length).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- elevenlabs`
Expected: FAIL — `synthesizeNarration` not exported.

- [ ] **Step 3: Append `synthesizeNarration` to `src/voice/elevenlabs.ts`**

```ts
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkText } from "./chunk.js";

const run = promisify(execFile);

export async function synthesizeNarration(cfg: VoiceConfig, text: string, outPath: string): Promise<string> {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("No text to synthesize");

  const dir = await mkdtemp(join(tmpdir(), "voice-"));
  try {
    const parts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const buf = await synthesizeChunk(cfg, chunks[i]);
      const p = join(dir, `part-${String(i).padStart(4, "0")}.mp3`);
      await writeFile(p, buf);
      parts.push(p);
    }
    if (parts.length === 1) { await writeFile(outPath, await import("node:fs/promises").then((fs) => fs.readFile(parts[0]))); return outPath; }

    const listPath = join(dir, "list.txt");
    await writeFile(listPath, parts.map((p) => `file '${p}'`).join("\n"));
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
    return outPath;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- elevenlabs`
Expected: PASS (3 tests in this file).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all green; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/voice/elevenlabs.ts test/voice/elevenlabs.test.ts && git commit -m "feat: full narration synthesis (chunk + ffmpeg concat)"
```

---

### Task 5: Real narration smoke test (M2 gate)

**Files:**
- Create: `src/scripts/voice-smoke.ts`
- Modify: `package.json` (add `"voice-smoke": "tsx src/scripts/voice-smoke.ts"`)

**Interfaces:**
- Consumes: `loadVoiceConfig`, `synthesizeNarration`.
- Produces: a real `out/voice-sample.mp3`; prints the path + byte size. Needs P.1–P.3. Not unit-tested.

- [ ] **Step 1: Add the npm script** to `package.json` scripts: `"voice-smoke": "tsx src/scripts/voice-smoke.ts"`

- [ ] **Step 2: Write `src/scripts/voice-smoke.ts`**

```ts
import "dotenv/config";
import { mkdir, stat } from "node:fs/promises";
import { loadVoiceConfig } from "../config.js";
import { synthesizeNarration } from "../voice/elevenlabs.js";

const sample = process.argv.slice(2).join(" ") ||
  "This is a test of the AvaSci storytelling voice. If you can hear this clearly, the narration pipeline works end to end.";

await mkdir("out", { recursive: true });
const outPath = "out/voice-sample.mp3";
await synthesizeNarration(loadVoiceConfig(), sample, outPath);
const { size } = await stat(outPath);
console.log(`✅ Narration written: ${outPath} (${size} bytes). Play it to check the voice.`);
```

- [ ] **Step 3: Typecheck (build-only; real run deferred to owner)**

Run: `npx tsc --noEmit`
Expected: exit 0. Do NOT run `npm run voice-smoke` without `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` in `.env`.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/voice-smoke.ts package.json && git commit -m "feat: real narration smoke test (M2 gate)"
```

- [ ] **Step 5: Owner gate** *(after Phase 0′)*: `npm run voice-smoke` → play `out/voice-sample.mp3` → confirm it's the chosen voice and clear. **M2 acceptance gate.**

---

## Self-Review (against the M2 scope)

- **Coverage:** voice config ✅ (T1), chunking ✅ (T2), single-chunk TTS ✅ (T3), full narration + concat ✅ (T4), real gate ✅ (T5). Voice-as-config (any voiceId) satisfied via `ELEVENLABS_VOICE_ID`.
- **Placeholders:** none — every step has real code/commands. The `model_id`/`voice_settings` are concrete defaults (tunable later).
- **Type consistency:** `VoiceConfig` (T1) → `synthesizeChunk(cfg,...)` (T3) → `synthesizeNarration(cfg,...)` (T4) → `voice-smoke` (T5) chain is consistent.
- **Decoupling:** `loadVoiceConfig` is separate from `loadConfig`, so M1 scripts keep working.

## Next plan after M2: M3 — Remotion storytelling template (images + Ken-Burns + captions + music + this narration → mp4).
