# youtube-studio

A faceless storytelling engine — this repo currently contains the **M1 YouTube upload layer**: a TypeScript/Node ESM module that authenticates with the YouTube Data API v3 via OAuth2 and uploads scheduled private videos.

---

## Setup (Phase 0) — Google Cloud & OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new project (e.g. `youtube-studio`).
2. Enable the **YouTube Data API v3** (APIs & Services → Library → search "YouTube Data API v3" → Enable).
3. Configure the **OAuth consent screen** (APIs & Services → OAuth consent screen):
   - Choose **External** user type.
   - Fill in app name and contact email.
   - Under **Test users**, add your own Google account (the channel you'll upload to).
   - **Important for a 24/7 automation — set Publishing status to "In production"** (OAuth consent screen → "Publish app"). While the app stays in **"Testing"**, refresh tokens **expire after 7 days**, which would break the daily engine every week. For your own account you can publish without Google's verification review — you'll just see an "unverified app" warning during consent that you can safely bypass.
4. Create an **OAuth client credential** (APIs & Services → Credentials → Create Credentials → OAuth client ID):
   - Application type: **Desktop app**.
   - Note the generated **Client ID** and **Client Secret**.
5. Copy `.env.example` to `.env` and fill in your credentials:

   ```sh
   cp .env.example .env
   ```

   `.env`:
   ```
   YT_CLIENT_ID=your-client-id.apps.googleusercontent.com
   YT_CLIENT_SECRET=your-client-secret
   YT_REFRESH_TOKEN=         # filled in next step
   ```

---

## Mint the refresh token

```sh
npm run mint-token
```

Running this **opens your browser automatically** (modern loopback flow — no copy/paste). Approve YouTube access for the channel you'll upload to. The script captures the response on a temporary `http://localhost` port and prints a line like:

```
YT_REFRESH_TOKEN=1//0g...long-token...
```

Copy that line into your `.env`.

> - If you see an **"unverified app"** warning, click **Advanced → Go to &lt;app&gt;** — it's your own app, safe to proceed.
> - If no `refresh_token` is printed, just re-run the command (it forces a fresh consent each time).

---

## Smoke test (M1 acceptance gate)

Requires a valid `YT_REFRESH_TOKEN` in `.env`.

```sh
npm run smoke-upload -- /path/to/test.mp4
```

This uploads a **private** video scheduled 24 hours from now. After running:

1. Open [YouTube Studio](https://studio.youtube.com/) and confirm the video appears under **Content → Scheduled**.
2. Verify the title, description, and scheduled publish time are correct.
3. Delete the test video.

---

## AI-content disclosure

The YouTube Data API v3 does not expose a stable field for the altered/synthetic-content (AI-generated) disclosure. Set it as a **channel-level upload default**:

> YouTube Studio → Settings → Upload defaults → toggle **"My video contains altered or synthetic content (e.g. AI-generated)"**.

This applies automatically to every upload from the channel until a per-video API field is available.

---

## Tests

```sh
npm test
```

Runs the full Vitest suite (unit tests for config loading, OAuth setup, and the upload logic). All tests should be green.
