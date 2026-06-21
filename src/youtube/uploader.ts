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
