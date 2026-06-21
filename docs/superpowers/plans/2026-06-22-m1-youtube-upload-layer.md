# M1 — YouTube Upload Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably upload a video to YouTube as *scheduled + private* (with metadata + custom thumbnail) from a **non-interactive** Node process, so the later daily CI worker can publish hands-free.

**Architecture:** A thin TypeScript module wraps the **YouTube Data API v3** via `googleapis`. Auth is **refresh-token based** (non-interactive) so it runs in GitHub Actions with no browser. A one-time local script mints the refresh token. (An off-the-shelf YouTube MCP is great for interactive use, but the CI worker needs non-interactive auth, so the worker owns a direct, testable uploader.)

**Tech Stack:** Node 20+, TypeScript, `googleapis`, `dotenv`, `vitest`, `tsx`.

## Global Constraints

- **Language/runtime:** TypeScript on Node 20+ (sits next to the Remotion pipeline). One line per file responsibility; small focused files.
- **Auth must be non-interactive at run time:** the daily worker authenticates from a stored **refresh token** only — never a browser prompt.
- **Secrets never committed:** `client_id`, `client_secret`, `refresh_token` come from env vars (local `.env`, GitHub Actions secrets in CI). `.env` is git-ignored.
- **Scheduling rule (YouTube API):** to schedule, `status.privacyStatus` MUST be `"private"` and `status.publishAt` MUST be an RFC 3339 / ISO-8601 UTC timestamp. Setting `publishAt` with any non-private status fails.
- **Compliance fields on every upload:** `status.selfDeclaredMadeForKids = false`; set the altered/synthetic-content disclosure where the API supports it (see Task 5 note — verify and fall back to a Studio channel-default if the field is unavailable).
- **Quota awareness:** `videos.insert` ≈ 1600 units; default daily quota 10,000 units. One upload/day is fine.

---

## Phase 0 — Prerequisites (owner does these once, before any task runs)

These produce the three secrets the code needs. Nothing in this plan can be *tested against the real API* until these exist, but Tasks 1–5 (scaffold + unit-tested code) can be built and unit-tested with mocks first; Task 6 (real smoke upload) needs these done.

- [ ] **P0.1** Have a YouTube channel for the project (the account that will own the videos).
- [ ] **P0.2** In [Google Cloud Console](https://console.cloud.google.com/): create a project → "APIs & Services" → "Enable APIs" → enable **YouTube Data API v3**.
- [ ] **P0.3** "APIs & Services" → "OAuth consent screen": configure (External), add your Google account as a **Test user** (so the refresh token doesn't expire in 7 days, also publish the app later or keep it in testing with yourself as a test user).
- [ ] **P0.4** "Credentials" → "Create Credentials" → **OAuth client ID** → type **Desktop app**. Save the **Client ID** and **Client secret**.
- [ ] **P0.5** Add the scope `https://www.googleapis.com/auth/youtube.upload` (and `…/auth/youtube` for thumbnails) to the consent screen.

> The **refresh token** itself is produced by running the script built in **Task 4** (`mint-refresh-token`). After that, all three secrets exist.

---

## File Structure

```
youtube-studio/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  .env.example
  src/
    config.ts                  # load + validate env secrets
    youtube/
      auth.ts                  # getAuthorizedClient(): non-interactive OAuth2 client from refresh token
      uploader.ts              # uploadVideo(): videos.insert + thumbnails.set -> videoId
    scripts/
      mint-refresh-token.ts    # one-time, interactive: mint + print the refresh token
      smoke-upload.ts          # manual: upload a real test video, scheduled+private
  test/
    config.test.ts
    youtube/
      auth.test.ts
      uploader.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: an installable TS project with `npm test` (vitest) and `npx tsx <script>` working.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "youtube-studio",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "mint-token": "tsx src/scripts/mint-refresh-token.ts",
    "smoke-upload": "tsx src/scripts/smoke-upload.ts"
  },
  "dependencies": {
    "googleapis": "^144.0.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.7.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", globals: true } });
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules
dist
.env
*.local
/tmp-smoke
```

- [ ] **Step 5: Create `.env.example`**

```
YT_CLIENT_ID=
YT_CLIENT_SECRET=
YT_REFRESH_TOKEN=
```

- [ ] **Step 6: Install and verify**

Run: `npm install && npx tsc --noEmit`
Expected: install succeeds; `tsc` exits 0 (no files yet to error on).

- [ ] **Step 7: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold youtube-studio TS project"
```

---

### Task 2: Config loader

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: env vars `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`.
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): { clientId: string; clientSecret: string; refreshToken: string }` — throws `Error` listing every missing key.

- [ ] **Step 1: Write the failing test**

```ts
// test/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("returns the three secrets when all present", () => {
    const cfg = loadConfig({ YT_CLIENT_ID: "a", YT_CLIENT_SECRET: "b", YT_REFRESH_TOKEN: "c" });
    expect(cfg).toEqual({ clientId: "a", clientSecret: "b", refreshToken: "c" });
  });
  it("throws listing all missing keys", () => {
    expect(() => loadConfig({})).toThrow(/YT_CLIENT_ID.*YT_CLIENT_SECRET.*YT_REFRESH_TOKEN/s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- config`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config.ts
export interface Config { clientId: string; clientSecret: string; refreshToken: string; }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const map = {
    YT_CLIENT_ID: env.YT_CLIENT_ID,
    YT_CLIENT_SECRET: env.YT_CLIENT_SECRET,
    YT_REFRESH_TOKEN: env.YT_REFRESH_TOKEN,
  };
  const missing = Object.entries(map).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  return { clientId: map.YT_CLIENT_ID!, clientSecret: map.YT_CLIENT_SECRET!, refreshToken: map.YT_REFRESH_TOKEN! };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- config`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts && git commit -m "feat: env config loader with validation"
```

---

### Task 3: Non-interactive auth client

**Files:**
- Create: `src/youtube/auth.ts`
- Test: `test/youtube/auth.test.ts`

**Interfaces:**
- Consumes: `Config` from Task 2; `google.auth.OAuth2` from `googleapis`.
- Produces: `getAuthorizedClient(cfg: Config): OAuth2Client` — an OAuth2 client with `credentials.refresh_token` set, usable directly by `google.youtube({ auth })`.

- [ ] **Step 1: Write the failing test**

```ts
// test/youtube/auth.test.ts
import { describe, it, expect, vi } from "vitest";

const setCredentials = vi.fn();
vi.mock("googleapis", () => ({
  google: { auth: { OAuth2: vi.fn().mockImplementation(() => ({ setCredentials })) } },
}));

import { getAuthorizedClient } from "../../src/youtube/auth.js";
import { google } from "googleapis";

describe("getAuthorizedClient", () => {
  it("constructs OAuth2 with client id/secret and sets the refresh token", () => {
    getAuthorizedClient({ clientId: "id", clientSecret: "secret", refreshToken: "rt" });
    expect((google.auth.OAuth2 as any)).toHaveBeenCalledWith("id", "secret");
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: "rt" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- auth`
Expected: FAIL — cannot find module `auth.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/youtube/auth.ts
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { Config } from "../config.js";

export function getAuthorizedClient(cfg: Config): OAuth2Client {
  const client = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
  client.setCredentials({ refresh_token: cfg.refreshToken });
  return client as OAuth2Client;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/youtube/auth.ts test/youtube/auth.test.ts && git commit -m "feat: non-interactive YouTube OAuth client from refresh token"
```

---

### Task 4: One-time refresh-token minting script

**Files:**
- Create: `src/scripts/mint-refresh-token.ts`

**Interfaces:**
- Consumes: `YT_CLIENT_ID`, `YT_CLIENT_SECRET` from `.env`.
- Produces: prints a `refresh_token` string to stdout (owner pastes it into `.env` as `YT_REFRESH_TOKEN` and later into GitHub secrets). Not unit-tested (interactive, one-shot); verified manually in this task.

- [ ] **Step 1: Write the script**

```ts
// src/scripts/mint-refresh-token.ts
import "dotenv/config";
import { google } from "googleapis";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube"];

const clientId = process.env.YT_CLIENT_ID, clientSecret = process.env.YT_CLIENT_SECRET;
if (!clientId || !clientSecret) { console.error("Set YT_CLIENT_ID and YT_CLIENT_SECRET in .env first."); process.exit(1); }

// "Desktop app" clients support the OOB/loopback flow; we use manual copy/paste of the code.
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");
const url = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

console.log("\n1) Open this URL, approve, and copy the code:\n\n" + url + "\n");
const rl = readline.createInterface({ input, output });
const code = (await rl.question("2) Paste the code here: ")).trim();
await rl.close();

const { tokens } = await oauth2.getToken(code);
if (!tokens.refresh_token) { console.error("No refresh_token returned. Re-run; ensure prompt=consent and a fresh grant."); process.exit(1); }
console.log("\n✅ YT_REFRESH_TOKEN=" + tokens.refresh_token + "\n\nPaste this into .env and (later) GitHub Actions secrets.");
```

- [ ] **Step 2: Manual run + verify** *(requires Phase 0 done)*

Run: copy `.env.example` to `.env`, fill `YT_CLIENT_ID`/`YT_CLIENT_SECRET`, then `npm run mint-token`
Expected: prints an auth URL; after pasting the code, prints `YT_REFRESH_TOKEN=...`. Paste that into `.env`.

> Note: if Google shows only a redirect-based flow (OOB deprecation), use the loopback variant — set redirect to `http://localhost:53682`, run a tiny local listener, or use the Google "OAuth Playground" with your own client to mint the token. Document whichever worked in the repo README.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/mint-refresh-token.ts && git commit -m "feat: one-time refresh-token minting script"
```

---

### Task 5: Uploader module

**Files:**
- Create: `src/youtube/uploader.ts`
- Test: `test/youtube/uploader.test.ts`

**Interfaces:**
- Consumes: `OAuth2Client` from Task 3; `google.youtube` from `googleapis`; Node `fs`.
- Produces:
  `uploadVideo(auth: OAuth2Client, opts: UploadOptions): Promise<string>` returning the new **videoId**, where
  ```ts
  interface UploadOptions {
    videoPath: string;            // local mp4
    title: string;
    description: string;
    tags: string[];
    categoryId?: string;          // default "24" (Entertainment)
    publishAt: string;            // ISO-8601 UTC; forces privacyStatus="private"
    thumbnailPath?: string;       // optional custom thumbnail
    madeForKids?: boolean;        // default false
    containsSyntheticMedia?: boolean; // AI disclosure intent; default true
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// test/youtube/uploader.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insert = vi.fn().mockResolvedValue({ data: { id: "VID123" } });
const setThumb = vi.fn().mockResolvedValue({});
vi.mock("googleapis", () => ({
  google: { youtube: vi.fn(() => ({ videos: { insert }, thumbnails: { set: setThumb } })) },
}));
vi.mock("node:fs", () => ({ createReadStream: vi.fn(() => "STREAM"), existsSync: vi.fn(() => true) }));

import { uploadVideo } from "../../src/youtube/uploader.js";

beforeEach(() => { insert.mockClear(); setThumb.mockClear(); });

const baseOpts = {
  videoPath: "/x/video.mp4", title: "T", description: "D", tags: ["a"],
  publishAt: "2026-07-01T15:00:00Z",
};

describe("uploadVideo", () => {
  it("inserts as private with publishAt, madeForKids=false, and returns videoId", async () => {
    const id = await uploadVideo({} as any, baseOpts as any);
    expect(id).toBe("VID123");
    const arg = insert.mock.calls[0][0];
    expect(arg.part).toContain("status");
    expect(arg.requestBody.status.privacyStatus).toBe("private");
    expect(arg.requestBody.status.publishAt).toBe("2026-07-01T15:00:00Z");
    expect(arg.requestBody.status.selfDeclaredMadeForKids).toBe(false);
    expect(arg.requestBody.snippet.title).toBe("T");
  });
  it("sets a custom thumbnail when provided", async () => {
    await uploadVideo({} as any, { ...baseOpts, thumbnailPath: "/x/thumb.png" } as any);
    expect(setThumb).toHaveBeenCalledWith(expect.objectContaining({ videoId: "VID123" }));
  });
  it("does not set a thumbnail when not provided", async () => {
    await uploadVideo({} as any, baseOpts as any);
    expect(setThumb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- uploader`
Expected: FAIL — cannot find module `uploader.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/youtube/uploader.ts
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { createReadStream, existsSync } from "node:fs";

export interface UploadOptions {
  videoPath: string; title: string; description: string; tags: string[];
  categoryId?: string; publishAt: string; thumbnailPath?: string;
  madeForKids?: boolean; containsSyntheticMedia?: boolean;
}

export async function uploadVideo(auth: OAuth2Client, opts: UploadOptions): Promise<string> {
  if (!existsSync(opts.videoPath)) throw new Error(`Video not found: ${opts.videoPath}`);
  const youtube = google.youtube({ version: "v3", auth });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title: opts.title, description: opts.description, tags: opts.tags, categoryId: opts.categoryId ?? "24" },
      status: {
        privacyStatus: "private",            // required for scheduling
        publishAt: opts.publishAt,           // ISO-8601 UTC
        selfDeclaredMadeForKids: opts.madeForKids ?? false,
      },
    },
    media: { body: createReadStream(opts.videoPath) as any },
  });

  const videoId = res.data.id;
  if (!videoId) throw new Error("Upload returned no video id");

  if (opts.thumbnailPath) {
    await youtube.thumbnails.set({ videoId, media: { body: createReadStream(opts.thumbnailPath) as any } });
  }
  return videoId;
}
```

> **AI-disclosure note (verify, don't assume):** the YouTube Data API does not (as of writing) expose a stable field to set the "altered/synthetic content" disclosure on `videos.insert`. `containsSyntheticMedia` is carried in `UploadOptions` for intent; during Task 6, check the live API for a status field (e.g. an `altered content` flag) and wire it if present. If absent, set the disclosure as a **channel upload default in YouTube Studio** and record that in the README as a known manual-once step.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- uploader`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/youtube/uploader.ts test/youtube/uploader.test.ts && git commit -m "feat: YouTube uploader (scheduled private + thumbnail)"
```

---

### Task 6: Real scheduled-upload smoke test

**Files:**
- Create: `src/scripts/smoke-upload.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 2), `getAuthorizedClient` (Task 3), `uploadVideo` (Task 5).
- Produces: a real *private + scheduled* video on the channel; prints its `videoId` + Studio URL. This is the milestone's acceptance gate.

- [ ] **Step 1: Write the smoke script**

```ts
// src/scripts/smoke-upload.ts
import "dotenv/config";
import { loadConfig } from "../config.js";
import { getAuthorizedClient } from "../youtube/auth.js";
import { uploadVideo } from "../youtube/uploader.js";

const videoPath = process.argv[2];
if (!videoPath) { console.error("Usage: npm run smoke-upload -- <path-to-test.mp4> [path-to-thumb.png]"); process.exit(1); }
const thumbnailPath = process.argv[3];

const publishAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +24h
const auth = getAuthorizedClient(loadConfig());
const id = await uploadVideo(auth, {
  videoPath, thumbnailPath,
  title: `Smoke test ${new Date().toISOString()}`,
  description: "Automated smoke test upload. Safe to delete.",
  tags: ["test"], publishAt,
});
console.log(`✅ Uploaded videoId=${id}\n   scheduled for ${publishAt}\n   https://studio.youtube.com/video/${id}/edit`);
```

- [ ] **Step 2: Prepare a tiny test asset**

Run: `mkdir -p tmp-smoke && ffmpeg -f lavfi -i color=c=navy:s=1280x720:d=3 -vf "drawtext=text='smoke':fontcolor=white:fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2" tmp-smoke/test.mp4`
Expected: a 3-second `tmp-smoke/test.mp4` exists. (If `ffmpeg` is absent, use any small mp4.)

- [ ] **Step 3: Run the real upload** *(requires Phase 0 + Task 4 token in `.env`)*

Run: `npm run smoke-upload -- tmp-smoke/test.mp4`
Expected: prints `✅ Uploaded videoId=...` and a Studio URL.

- [ ] **Step 4: Verify in YouTube Studio**

Open the printed Studio URL.
Expected: the video exists, is **Private**, and shows **Scheduled** for ~24h out. Delete it after confirming. **This is the M1 acceptance gate.**

- [ ] **Step 5: Commit**

```bash
git add src/scripts/smoke-upload.ts && git commit -m "feat: real scheduled-upload smoke test (M1 gate)"
```

---

## Self-Review (done against the spec, M1 scope)

- **Spec coverage (M1 only):** YouTube layer = upload ✅ (Task 5), schedule via `publishAt` ✅ (Task 5 + constraint), custom thumbnail ✅ (Task 5), non-interactive/refresh-token auth for CI ✅ (Tasks 3–4), AI-disclosure ⚠️ flagged honestly (Task 5 note — verify-or-Studio-default). `list_channels`/analytics are **out of M1 scope** (not needed to prove upload; deferred to a later plan or the reused MCP for interactive use).
- **Placeholder scan:** no TBD/TODO; the one honest unknown (API disclosure field) has a concrete fallback, not a placeholder.
- **Type consistency:** `Config` (Task 2) → `getAuthorizedClient(cfg)` (Task 3) → `uploadVideo(auth, opts)` (Task 5) → `smoke-upload` (Task 6) chain matches across tasks.

## Next plans (after M1's gate passes)
- **M2** — Voice (ElevenLabs clone + `synthesizeNarration(text) → mp3`).
- **M3** — Remotion storytelling template (`renderStory({beats, audio, captions, music}) → mp4`).
- **M4** — Glue (Claude prompt + preset: topic → script → voice → images → render → upload).
- **M5** — Autonomy (GitHub Actions workflow + cron-job.org trigger + persistent state + retries + failure alert).
- **M6** — Run 2 weeks, tune, then clone the preset for niche #2.
