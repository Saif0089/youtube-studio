# Faceless Storytelling Engine — Design Spec

**Date:** 2026-06-22
**Status:** Draft for review
**Working name:** `youtube-studio`

## 1. Goal

A largely-autonomous system that produces, uploads, and schedules **one faceless long-form storytelling video per day** to YouTube, built to **stay monetizable under YouTube's 2026 Inauthentic-Content Policy** by leaning on original production value (own render pipeline + cloned voice + original scripts) rather than templated SaaS output.

The first channel proves the loop in **one niche (storytelling)**. The system is a **niche-agnostic engine** — additional niches/channels are added later as config presets, not new code.

## 2. Scope

**In scope (v1 — the proof channel):**
- One YouTube channel, storytelling niche, long-form (8–12 min).
- End-to-end daily pipeline: topic → script → narration → visuals → render → thumbnail → upload + schedule.
- Reuse of an existing open-source YouTube MCP for the API layer.
- Optional human "approval tap" before publish.

**Out of scope (later):**
- Multi-channel scale-out (designed for, not built in v1).
- Shorts auto-cutting / cross-posting (TikTok, IG).
- Analytics-driven topic optimization.
- A polished control-panel UI.

## 3. Decisions locked (from brainstorming)

- **Content:** faceless, for **ad revenue**.
- **Engine:** niche-agnostic; niche = swappable preset. **First niche = storytelling.**
- **Format:** **long-form (8–12 min)** primary (where ad revenue lives). Shorts later as a growth funnel.
- **Voice:** **clone the owner's own voice** (ElevenLabs) — human, authentic, automatable. Avoids the robotic-TTS quality signal.
- **Build approach:** **hybrid** — reuse a YouTube MCP for the commodity upload/schedule layer; build only the differentiated content/render glue.
- **Autonomy:** **fully automated, zero-touch.** No approval tap — the system produces *and* publishes daily on its own. Human involvement = one-time setup only. Safety net: auto-retry + a failure alert so a silent break can't quietly kill the channel.

## 4. Architecture

Four capabilities + a "brain" + a scheduler. The **MCP/services are deterministic hands; Claude is the creative brain.**

| Part | Responsibility | Build / Reuse |
|---|---|---|
| **A. YouTube layer** | OAuth, upload (resumable), set title/description/tags/category, **schedule via `publishAt`**, set custom thumbnail, AI-content disclosure flag, list channels, basic analytics | **Reuse** an existing MCP (candidates: `pauling-ai/youtube-mcp-server`, `mrchevyceleb/youtube-mcp`). Verify it supports scheduled publish + custom thumbnail + the synthetic-content disclosure flag; extend or call the Data API directly only for any gap. |
| **B. Voice** | Script text → narration audio in the owner's cloned voice | ElevenLabs API (voice clone created once; TTS per video). Thin Node wrapper. |
| **C. Visuals + render** | Story → scene beats → atmospheric AI imagery → assembled MP4 with Ken-Burns motion, captions, music bed, intro/outro | **Remotion** (own pipeline) for assembly = the moat. AI image generation per scene beat (consistent style via fixed style-prompt/seed). |
| **D. Thumbnail** | Title + key image → branded thumbnail | Remotion still or image model + text overlay. |
| **Glue (brain)** | Loads channel preset → picks topic from a queue → writes original script + metadata → orders B/C/D → calls A to upload+schedule → logs | **Claude** (Claude Code), driven by a per-channel preset + a daily prompt. Orchestration code in **TypeScript/Node**. |
| **Scheduler + worker** | Triggers and runs the full pipeline daily | **cron-job.org** (daily HTTP trigger) → **GitHub Actions** workflow runs the render + upload on a CI runner (real CPU/disk, no server to manage). |
| **State** | Channel presets, encrypted OAuth tokens, topic queue, produced-video log | Local files / small store (JSON or SQLite). |

## 5. Storytelling niche preset (the first channel)

```
niche:            "storytelling"
subGenre:         "suspense / mystery short stories"   # adjustable; the proof-channel default
length:           8–12 min
voiceId:          <owner cloned voice>
narrationStyle:   calm, atmospheric, first-/third-person narrator
visualPipeline:   AI-image-per-beat (consistent cinematic style) + Remotion Ken-Burns + captions + music
structure:        cold-open hook → story (chaptered) → resolution → soft CTA
music:            licensed/royalty-free atmospheric bed (volume-ducked under narration)
postTime:         <daily slot, owner's audience timezone>
publishMode:      autoPublish   # produces AND publishes daily, zero-touch
```

**Story sourcing (originality-critical):** Claude **writes original stories** (or heavily transforms public-domain/prompt-seeded premises) — never scrapes/reuses another creator's narration or script. A topic/premise queue seeds variety; each video is distinct.

## 6. Daily data flow (per channel)

```
cron (daily)
  → launch headless Claude with the channel preset
    → pick next premise from the topic queue (or generate one)
    → write original story script + title + description + tags + chapters
    → break script into scene beats
    → B: synthesize narration (cloned voice)        → narration.mp3
    → C: generate scene images (consistent style)   → /scenes/*.png
    → C: Remotion render (images + Ken-Burns + captions + music + narration) → video.mp4
    → D: render thumbnail                            → thumb.png
    → A (YouTube MCP): upload_video(metadata, publishAt, thumbnail, aiDisclosure=true)   # auto-publish, zero-touch
    → log produced video + mark premise consumed
        (on any step failure: auto-retry → fallback → if still failing, send ONE failure alert — the only time the owner is ever involved)
```

### Zero-touch operation (what "I do nothing" actually requires)

- **Host = GitHub Actions (nothing of yours stays on):** cron-job.org fires a daily trigger that starts a GitHub Actions workflow; the render + upload run on GitHub's runners. Daily publishing never depends on your Mac being awake — true hands-off. (A small VPS or Remotion Lambda is the fallback only if CI runtime/limits ever bind.)
- **Auto OAuth refresh:** store the YouTube refresh token; access tokens renew automatically — no manual re-login, ever (unless the channel revokes access).
- **Auto-retry + fallbacks:** every step retries on transient failure; if a render/image step fails, a simpler fallback still ships the day's video rather than skipping it.
- **Failure alert (only on hard failure):** if a day genuinely can't be produced after retries, one email/push is sent. This is the *single* ongoing touchpoint — and only when something breaks. Normal operation = you do nothing.
- **Self-replenishing topic queue:** Claude generates fresh story premises as the queue drains, so it never runs out of ideas.

## 7. Compliance / policy strategy (why this survives 2026 enforcement)

- **Cloned human voice**, not stock TTS.
- **Original scripts** written per video (variation, not templated repetition).
- **Original assembled visuals** (Remotion production), not reused footage/slideshows.
- **Per-video variation** in story, imagery, structure.
- **AI-content disclosure** set on upload where required.
- **Human approval tap** = real human-in-the-loop (the behavior the policy rewards).
- Explicitly avoids the flagged pattern: templated slideshow + robotic TTS + reused clips.

> Honest caveat: this maximizes the odds of staying monetized and standing out. It does **not** guarantee ad revenue — niche, consistency, and content quality decide that.

## 8. Tech choices

- **Glue/orchestration:** TypeScript + Node (sits next to Remotion).
- **YouTube layer:** reused open-source MCP (Python or TS — language-independent; Claude talks to it over MCP).
- **Voice:** ElevenLabs (clone + TTS).
- **Render:** Remotion.
- **Image gen:** an AI image API with strong style consistency (candidates: Google Imagen / "Nano Banana", Flux, SDXL, or Midjourney API — final pick at plan time on cost/quality/consistency).
- **Schedule/host:** **cron-job.org** (daily trigger) → **GitHub Actions** workflow as the worker (render + upload). Optional **Vercel/Next.js dashboard** later for visibility + manual "run now."
- **Store:** SQLite or JSON committed to the repo / a small managed DB (chosen at plan time; must persist the topic queue, tokens, and produced log between CI runs).

## 9. Prerequisites (owner-provided — the real "start")

1. A YouTube channel for the proof project.
2. Google Cloud project + YouTube Data API v3 enabled + OAuth 2.0 client credentials (Desktop/Installed app).
3. ElevenLabs account + ~1–3 min of clean voice recording to clone.
4. An image-gen API key (provider TBD at plan time) and an ElevenLabs key.
5. A **GitHub account + repo** (the worker runs as a GitHub Actions workflow; all API keys live as encrypted GitHub Actions secrets) and a free **cron-job.org** account (daily trigger).
6. A small seed list of story premises/themes (or approve Claude generating them).

## 10. Cost estimate (one daily channel)

- ElevenLabs: ~$22/mo (Creator).
- AI images: ~a few $/video (≈$1–4) depending on count/provider.
- Remotion render: free locally (or modest cloud render cost later).
- YouTube Data API: free (within ~10k units/day; an upload ≈ 1,600 units).
- GitHub Actions + cron-job.org: free tier comfortably covers 1 video/day.
- **Total: ~$30–80/mo** for one daily long-form channel.

## 11. Build order / milestones

1. **M1 — YouTube layer proven:** stand up the reused MCP + OAuth; manually push one *scheduled, private* test upload with a custom thumbnail. Confirms the hardest external dependency first.
2. **M2 — Voice:** clone the owner's voice; script-text → narration.mp3.
3. **M3 — Render:** one Remotion storytelling template (images + Ken-Burns + captions + music + narration) → MP4.
4. **M4 — Glue:** channel preset + the daily Claude prompt that chains topic → script → B → C → D → A.
5. **M5 — Autonomy (zero-touch):** package the pipeline as a **GitHub Actions workflow** triggered daily by **cron-job.org**; persistent state (queue/tokens/log) wired up; auto OAuth refresh + auto-retry/fallbacks + failure alert + logging. **Auto-publish, no approval tap.**
6. **M6 — Prove & iterate:** run the channel ~2 weeks; tune; then it's ready to clone to a second niche.

## 12. Risks & open questions

- **Does the chosen reused MCP support `publishAt` scheduling + custom thumbnail + AI disclosure?** If not, extend it or call the Data API directly for those calls (resolve in M1).
- **Visual style consistency** across AI images within one story (mitigate with fixed style prompt/seed/reference; validate in M3).
- **GitHub Actions runtime + state:** runners are ephemeral, so the **topic queue, OAuth tokens, and produced log must persist between runs** (committed to the repo, GH artifacts/cache, or a small managed DB — decided at plan time). CI also has a job-timeout (up to ~6h) and free-minute limits; a daily render fits, but heavy growth or many channels would push us to a VPS / Remotion Lambda. Store all keys as encrypted GH Actions secrets.
- **No human-in-the-loop:** auto-publishing slightly raises policy exposure vs. an approval tap; mitigated by the originality safeguards (cloned voice, original scripts/visuals, variation, AI disclosure) + the failure alert. Even with zero daily action, glancing at the channel occasionally is wise.
- **Music licensing:** use a properly royalty-free/licensed source to avoid Content-ID strikes.
- **Sub-genre choice** for the proof channel (default: suspense/mystery; owner may prefer another).

## 13. Success criteria (v1)

- After one-time setup, a daily cron produces a finished, policy-compliant long-form story video and publishes it to YouTube **with zero owner action** — the owner is contacted only if the pipeline hard-fails.
- The channel posts daily for ~2 weeks without manual production work.
- Output is visibly more "produced" than generic faceless-SaaS output (the moat is real).
