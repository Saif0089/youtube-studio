# youtube-studio

Automated faceless-YouTube pipeline. Generates a full video from a topic: writes a
retention-first script, sources/generates visuals, narrates with neural TTS, burns in
kinetic captions + chapter cards, ducks music under the voice, makes a thumbnail, and
uploads to YouTube. Runs daily in GitHub Actions (cloud) and can run locally for dev.

Currently powering **"InfotainmentStu"** (psychology of money & behavior).

---

## What runs where

| | Where it runs | Needs your machine? |
|---|---|---|
| **Daily channel** | GitHub Actions (`.github/workflows/daily.yml`), Ubuntu runners | No — fully cloud, on a cron. Set repo Secrets and it just runs. |
| **Local dev / experiments** | Your machine (this clone) | Yes — for iterating on the pipeline and for local AI generation. |

Cloning to a new machine does **not** disturb the running channel. The clone is for
development and for local AI image/video generation on stronger hardware.

---

## Prerequisites

- **Node ≥ 20** (`node --version`)
- **Git**
- **ffmpeg** on PATH (`ffmpeg -version`)
- **uv** (runs the Python edge-tts helper in an ephemeral env) — https://docs.astral.sh/uv/
- **Claude Code CLI** *(only if `SCRIPT_PROVIDER=claude`)* — `npm i -g @anthropic-ai/claude-code`, then run `claude` to log in. Or set `SCRIPT_PROVIDER=gemini` and skip it.

### Installing the prereqs

**Windows (PowerShell, using winget):**
```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Gyan.FFmpeg
winget install astral-sh.uv
```

**macOS (Homebrew):**
```bash
brew install node git ffmpeg uv
```

---

## Setup

```bash
git clone https://github.com/Saif0089/youtube-studio.git
cd youtube-studio
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Then open `.env` and fill in the values. **Secrets are not in git** — copy the real values
from your other machine's `.env`, or from the GitHub repo Secrets (Settings → Secrets and
variables → Actions). See `.env.example` for what each var is and where to get it.

Minimum to generate a video locally without publishing:
`SCRIPT_PROVIDER` (+ `GEMINI_API_KEY` if gemini), `PEXELS_API_KEY`, `PIXABAY_API_KEY`.

Verify the toolchain:
```bash
npm test                    # unit tests (Vitest)
npx tsc --noEmit            # typecheck
```

---

## Run it locally

Build a full long video **without uploading** (writes `out/story.mp4`):

```bash
NO_PUBLISH=1 npx tsx src/scripts/make-daily.ts        # macOS/Linux
```
```powershell
$env:NO_PUBLISH=1; npx tsx src/scripts/make-daily.ts   # Windows PowerShell
```

Pipeline (`src/scripts/make-daily.ts`):
`gen-vid-script` → `gen-bg-video` (visuals) → `narrate-edge` → `prepare-video`
→ `build-music` → `compose-video` → thumbnail → `publish` (skipped with `NO_PUBLISH`).

Outputs land in `out/` (gitignored). To upload, drop `NO_PUBLISH`, set the `YT_*` vars and
`PUBLISH_MODE` (`approval` = private for review, `auto` = schedule public ~2h out).

---

## Visual sources (how each shot is filled)

Default is **v7 "AI storyboard"**: each ~sentence beat gets 2–3 shots (~2.3s cuts). Per
shot the ladder is: **Gemini-generated image** (Ken Burns) → **vision-verified stock video**
(Pexels/Pixabay) → **matched stock photo** → **punch-text graphic card**. Switch image
engines with `IMAGE_PROVIDER`. All free.

---

## Local AI generation (the "more powerful machine" path)

### Images — ComfyUI (Windows / Linux / Mac)
`src/lib/comfy.ts` + `src/scripts/gen-scenes-comfy.ts` already drive a local **ComfyUI**
server (port 8188) for RealVisXL photoreal images. Point `COMFY_DIR` / `COMFY_PY` at your
install. **On Windows the venv python is `...\venv\Scripts\python.exe`**, not `bin/python` —
set `COMFY_PY` explicitly in `.env`.

### Video — status & the Windows plan
Local **video** was prototyped with **Wan 2.2** (`src/lib/wan.ts`, `gen-wan-*.ts`,
`make-wan-video.ts`). On an 18 GB Mac only the small **5B** model fit, at ~10 min/clip, and
quality/stability were below par → **not viable on that hardware.** A stronger GPU changes
this.

**Important:** `wan.ts` talks to **Draw Things**, which is **macOS-only**. On **Windows**,
the right stack is **ComfyUI + Wan 2.2 14B** (your stronger GPU can run the 14B — a different
quality league). ComfyUI uses a node-graph `/prompt` API, *not* the A1111-style
`/sdapi/v1/txt2img` endpoint `wan.ts` uses, so the concrete next task on Windows is:

1. Install ComfyUI + Wan 2.2 14B (GGUF or fp8) with its VAE + text encoder.
2. Build/export a Wan **text-to-video workflow JSON** in the ComfyUI UI.
3. Add `src/lib/wan-comfy.ts` that POSTs that workflow to `/prompt` and polls `/history` for
   the frames — mirroring the existing image client in `comfy.ts`. Point `gen-wan-clips.ts`
   at it instead of `wan.ts`.

Everything downstream (storyboard → clips → narrate → captions → music → compose) is already
built and reused as-is; only the clip *source* needs the ComfyUI adapter.

---

## YouTube publishing setup (one-time)

1. [Google Cloud Console](https://console.cloud.google.com/) → new project.
2. Enable **YouTube Data API v3**.
3. **OAuth consent screen** → External. Add your channel's Google account as a test user.
   **Set Publishing status to "In production"** (click "Publish app") — while in *Testing*,
   refresh tokens **expire after 7 days** and break the daily engine weekly. For your own
   account you can publish without Google's review; just bypass the "unverified app" warning.
4. **Credentials** → Create OAuth client ID → **Desktop app**. Note the Client ID + Secret.
5. Put them in `.env` (`YT_CLIENT_ID`, `YT_CLIENT_SECRET`), then mint the refresh token:
   ```bash
   npm run mint-token        # opens a browser (loopback flow), prints YT_REFRESH_TOKEN=...
   ```
   Copy the printed line into `.env`. Re-run if no `refresh_token` is printed.
6. Smoke test: `npm run smoke-upload -- /path/to/test.mp4` (uploads a private test video).

**AI-content disclosure:** the API has no per-video field for it. Set it channel-wide in
YouTube Studio → Settings → Upload defaults → toggle *"altered or synthetic content."*

---

## Project layout

```
src/scripts/   pipeline steps + orchestrators (make-daily.ts = production long video)
src/lib/       shared: llm.ts (Claude/Gemini + image/vision), stock.ts (Pexels/Pixabay),
               wan.ts (Draw Things video), comfy.ts (ComfyUI images), timing, sentences…
src/remotion/  CaptionsOverlay.tsx — transparent kinetic-caption / chapter-card overlay
tools/         edge_narrate.py — free Edge-TTS narration (run via uv)
.github/workflows/daily.yml   the cloud cron that ships the daily video
state/         topic-dedup history (committed); out/ & public/ are gitignored build outputs
```

## Gotchas
- **Node `fetch` has a 300 s body timeout** (undici). Long local generations must use `curl`
  or a Python helper, not `fetch` — see `wan.ts`.
- **Draw Things is macOS-only.** Use ComfyUI on Windows/Linux.
- **Claude Max weekly limit** looks like an auth error but isn't; the code auto-falls back to
  free Gemini (`GEMINI_API_KEY`). See `src/lib/llm.ts`.
- Prefer setting `COMFY_DIR` / `COMFY_PY` explicitly in `.env` on Windows.

## Tests
```bash
npm test          # Vitest suite — should be all green
```
