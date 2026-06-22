import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { createReadStream, existsSync } from "node:fs";

export interface UploadOptions {
  videoPath: string; title: string; description: string; tags: string[];
  categoryId?: string; publishAt?: string; thumbnailPath?: string;
  madeForKids?: boolean; containsSyntheticMedia?: boolean;
}

export async function uploadVideo(auth: OAuth2Client, opts: UploadOptions): Promise<string> {
  if (!existsSync(opts.videoPath)) throw new Error(`Video not found: ${opts.videoPath}`);
  if (opts.publishAt && isNaN(Date.parse(opts.publishAt))) throw new Error(`Invalid publishAt (expected ISO-8601 UTC): ${opts.publishAt}`);
  const youtube = google.youtube({ version: "v3", auth });

  const status: Record<string, unknown> = {
    privacyStatus: "private",                       // uploaded private; owner reviews before it goes public
    selfDeclaredMadeForKids: opts.madeForKids ?? false,
  };
  if (opts.publishAt) status.publishAt = opts.publishAt; // auto-publish at this time only if provided

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title: opts.title, description: opts.description, tags: opts.tags, categoryId: opts.categoryId ?? "24" },
      status,
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
