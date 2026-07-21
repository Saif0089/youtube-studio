# CLAUDE.md — youtube-studio

Operational context for Claude Code working in this repo. Read `README.md` for full setup.

## What this is
Automated faceless-YouTube pipeline (Node ESM + `tsx`, Remotion, ffmpeg, edge-tts via `uv`).
The daily channel runs in **GitHub Actions** (`.github/workflows/daily.yml`); this repo is
cloned locally for **development** and **local AI generation**. A local clone never affects
the running cloud channel.

## Key commands
- `NO_PUBLISH=1 npx tsx src/scripts/make-daily.ts` — build a full long video, no upload (main dev loop)
- `npm test` — Vitest; `npx tsc --noEmit` — typecheck. Run both before committing.
- Individual steps live in `src/scripts/` (`gen-vid-script`, `gen-bg-video`, `narrate-edge`,
  `prepare-video`, `build-music`, `compose-video`, `publish`).

## Architecture (data flow)
`gen-vid-script` writes `out/story.json` (title, sections, script). `gen-bg-video` storyboards
it into `out/clip-N.mp4` + `out/shots.json` + `out/beats.json`. `narrate-edge` →
`out/narration.mp3` + `out/words.json` (word timings). `prepare-video` → `out/props.json`
(captions/cards/graphics) + `out/timeline.json`. `compose-video` stitches clips, renders the
Remotion caption overlay as a transparent PNG sequence, and muxes narration + ducked music.
Swapping a visual *source* = produce the same `clip-N.mp4` + `shots.json` + `beats.json`; the
back half is reused unchanged.

## Conventions
- TypeScript, Node ESM, run via `tsx`. Imports use `.js` extensions (ESM resolution).
- Env-driven config; sensible defaults in code. New knobs → also add to `.env.example`.
- Match surrounding style: terse, purposeful comments explaining *why*.
- Commit only when asked. Branch off `main`. `out/`, `public/`, `.env` are gitignored.

## Providers / fallbacks (`src/lib/llm.ts`)
- Script: `SCRIPT_PROVIDER=claude` (Claude Code CLI, your Max sub) or `gemini` (free HTTP).
- Claude weekly-limit errors auto-fall back to free Gemini — don't mistake a limit for auth.
- Images: Gemini image gen; vision verifies stock picks. Stock: Pexels→Pixabay (`stock.ts`).

## Local AI generation
- **Images:** `comfy.ts` drives local **ComfyUI** (port 8188), RealVisXL. Works on Windows.
  Windows venv python = `...\venv\Scripts\python.exe` (set `COMFY_PY`).
- **Video:** `wan.ts` drives **Draw Things** (macOS-only) + Wan 2.2. Prototyped; 5B on 18 GB
  was not viable. **On Windows: use ComfyUI + Wan 2.2 14B.** ComfyUI's API is node-graph
  `/prompt` (not A1111 `/sdapi/v1/txt2img`), so add a `wan-comfy.ts` adapter and point
  `gen-wan-clips.ts` at it. See README "Local AI generation" for the step list.

## Gotchas
- **Node `fetch` = 300 s body timeout** (undici). Long generations must use `curl`/Python, not
  `fetch` (see `wan.ts`). This bit the Wan work.
- Draw Things is macOS-only; ComfyUI is the cross-platform path.
- Windows: prefer explicit `COMFY_DIR`/`COMFY_PY` in `.env`; watch `\` vs `/` in any new paths.

## Status
- Production channel (v7 AI-storyboard visuals) is healthy and shipping daily.
- Parked: local Wan video (needs stronger GPU + ComfyUI adapter on Windows); a kids' 3D
  story-channel experiment (`docs/superpowers/…`, blocked on character quality).
