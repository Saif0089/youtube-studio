# Kids Story Studio — Zero-Dollar 3D Animated Story Channel

Date: 2026-07-03
Status: Approved direction (pending user spec review)
Target repo: `~/Documents/LocalProject/kids-studio` (new; borrows uploader/Discord code from youtube-studio)

## 1. Goal

A new YouTube kids' channel: **3D-animated story episodes** (~7 min, ages 4–8, one every 2–3 days),
produced end-to-end for **$0 marginal cost** on the user's Mac (M3 Pro, 18 GB, Blender 5.0.1).
Stories are written by the user via **ChatGPT** (free web) and dropped into a queue; everything
downstream is automated.

**Explicit quality decision:** the user chose *real 3D character animation* over the AI-illustrated
"living storybook" look, understanding the 3D look at $0 is simpler/toonier than their Pixar-style
reference image. That reference (cozy purple night bedroom, glowing lamps, stars, warm bloom) is the
**art-direction target** for palette, lighting, and mood in every set.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Production model | Fixed cast + fixed sets, recombined per episode (the CoComelon playbook at $0) |
| Story engine | **Literally ChatGPT** (user pastes structured episodes into a queue; no API cost) |
| Format | Ages 4–8, ~7 min, every 2–3 days |
| Cast | 2–3 cartoon **kid characters**, custom-made in **VRoid Studio** (free, commercial-ok, built-in mouth blendshapes, modest clothing by design — see modesty note) |
| Engine | **Blender** — authoring via **Blender MCP** (interactive, quality-first), per-episode assembly via scripted Blender + Eevee |
| Runs on | The user's Mac (CI runners cannot do 3D); overnight renders |
| Publishing | New YouTube channel, uploads marked **made-for-kids** (COPPA); Discord pings on done/fail |

**Modesty (firm requirement):** all characters fully and modestly dressed; no immodest content in
any scene, texture, or generated asset. Carries over from the user's standing rule.

## 3. Architecture — two phases

### Phase A: Studio Setup (one-time, interactive, MCP-driven)

Quality is won here. Claude drives the user's running Blender through the Blender MCP (build →
screenshot → iterate), with **user approval gates**:

1. **Cast** — user designs 2–3 kids in VRoid Studio (~30–60 min, guided); export VRM → import to
   Blender (VRM addon). Toon-shaded materials, eye/face polish. **Gate: cast portrait renders.**
2. **Sets** — 5 reusable environments (bedroom, home/kitchen, park, forest, school street) from CC0
   packs (Kenney, Quaternius, Poly Haven HDRIs/props), art-directed to the reference mood: warm key
   lights, bloom, AO, saturated night-purples/golds where fitting. **Gate: beauty-shot per set.**
3. **Motion library** — ~25 Mixamo clips (walk, run, jump, wave, sit, hug, laugh, point, look…)
   retargeted once to the cast rigs; saved as a Blender action library. Known risk: Mixamo→VRoid
   bone-mapping fixes are fiddly (one-time pain).
4. **Lip-sync rig** — Rhubarb (free) phonemes mapped to VRM mouth blendshapes (A/I/U/E/O).
5. **Final gate** — a 20-second test scene (two kids talking + walking in the park, lip-synced,
   full lighting) rendered end-to-end. **User approves the look before any episode is produced.**

### Phase B: Episode Factory (recurring, scripted, unattended)

```
stories/queue/*.json
  → validate episode JSON (schema check; malformed → skip + Discord warn)
  → edge-tts voices (narrator + per-character child voices, e.g. en-US-AnaNeural)
  → Rhubarb per dialogue line → mouth keyframes
  → Blender assembler (Python): load set, place cast, apply actions from library,
    keyframe lip-sync, simple camera cuts per scene beat
  → Eevee render 1080p24 (~2–4 h overnight)
  → ffmpeg: mux narration + dialogue + gentle music bed
  → upload (made-for-kids) → Discord ✅ with link   |   any failure → Discord 🔴
```

No LLM runs at render time — the factory is deterministic.

**Trigger:** `npm run episode` (manual), plus an optional launchd schedule (e.g. 11 pm every 2nd
night) once the user trusts it. Guard: skip if the queue is empty or an episode rendered today.

## 4. The ChatGPT story queue

- Deliverable includes a **master prompt** file. The user pastes it into ChatGPT; ChatGPT returns a
  complete structured episode JSON: `title, moral, characters used, scenes[] {set, cast on stage,
  actions (from the motion library's named list), dialogue[] {speaker, line}, narration}`.
- The master prompt embeds the exact allowed sets/characters/action names so ChatGPT can only
  stage what the studio owns.
- User saves each response to `stories/queue/<name>.json`. Factory consumes oldest-first, moves to
  `stories/done/`, and **Discord-pings when the queue drops below 2**.
- Fallback: none required — if the queue is empty the factory simply doesn't run.

## 5. Components (new repo `kids-studio`)

| Unit | Responsibility |
|---|---|
| `studio/` (.blend files) | cast.blend, sets/*.blend, actions library — Phase A output |
| `src/validate-episode.ts` | schema-check queue JSON |
| `src/voices.ts` | edge-tts narration + per-character lines with timing |
| `src/lipsync.ts` | run Rhubarb per line → viseme timeline JSON |
| `assembler.py` | Blender-side: build the episode scene from JSON + timelines |
| `src/render.ts` | drive `blender -b assembler.py` (scripted; GUI optional), Eevee settings |
| `src/compose.ts` | ffmpeg mux (dialogue, narration, music bed, level balance) |
| `src/publish.ts` | reuse youtube-studio uploader; `selfDeclaredMadeForKids: true` |
| `src/episode.ts` | orchestrator: queue → validate → voices → lipsync → render → compose → publish |

## 6. Compliance & channel notes (honest)

- **Made-for-kids** designation is legally required (COPPA): comments disabled, personalized ads
  off → **lower RPM** than a normal channel. Monetization also requires passing YPP originality
  review; fixed-cast original stories position it on the right side of that.
- New channel needs its own OAuth refresh token (mint with existing `mint-refresh-token`).

## 7. Risks

1. **Look ceiling** — charming indie show, not CoComelon; mitigated by the Phase A gates (user
   sees and approves the exact look early, iterates via MCP before committing).
2. **Retarget/lip-sync fiddliness** — one-time Phase A cost; budgeted for iteration.
3. **Render time** — 2–4 h/episode on the M3 Pro overnight; cadence (every 2–3 days) has slack.
4. **Mac must be on** for renders/uploads (it's the compute).
5. **Blender MCP availability** — authoring sessions need Blender open with the addon connected.

## 8. Milestones

1. Repo scaffold + master prompt + episode schema.
2. Cast built & approved (gate 1).
3. Sets built & approved (gate 2).
4. Motion library + lip-sync working (gate: single-character demo).
5. 20-sec test scene approved (gate 3 — the go/no-go for the whole look).
6. Factory end-to-end on one real ChatGPT story → private upload reviewed.
7. Channel live; queue workflow begins; publishing flipped public when user says so.
