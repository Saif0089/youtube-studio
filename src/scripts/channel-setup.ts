import "dotenv/config";
import { createReadStream } from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "../config.js";
import { getAuthorizedClient } from "../youtube/auth.js";

const youtube = google.youtube({ version: "v3", auth: getAuthorizedClient(loadConfig()) });

const description =
  "InfotainmentStu explains the fascinating science of being human — why you think, feel, and behave the way you do. Clear, surprising psychology and science explainers, simply told.\n\nNew video every day. Subscribe and stay curious.";
const keywords =
  'psychology science "psychology facts" "human behavior" "the real reason" "why we" brain neuroscience "science explained" explainer educational facts learning';

// 1) get channel id + current branding
const list = await youtube.channels.list({ part: ["id", "snippet", "brandingSettings"], mine: true } as any);
const ch = list.data.items?.[0];
if (!ch?.id) { console.error("No channel found for this account."); process.exit(1); }
console.log(`channel: ${ch.snippet?.title ?? ch.id}`);

// 2) upload banner
const ins = await youtube.channelBanners.insert({ media: { body: createReadStream("out/brand/banner.jpg") } } as any);
const bannerExternalUrl = ins.data.url;
console.log(`banner uploaded: ${bannerExternalUrl ? "ok" : "NO URL"}`);

// 3) update branding (description + keywords + banner), preserving existing fields
const brandingSettings: any = {
  channel: { ...(ch.brandingSettings?.channel ?? {}), description, keywords },
  image: { ...(ch.brandingSettings?.image ?? {}), bannerExternalUrl },
};
await youtube.channels.update({ part: ["brandingSettings"], requestBody: { id: ch.id, brandingSettings } } as any);
console.log("✅ channel description + keywords + banner updated");
