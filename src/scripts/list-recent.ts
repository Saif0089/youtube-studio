import "dotenv/config";
import { google } from "googleapis";
import { loadConfig } from "../config.js";
import { getAuthorizedClient } from "../youtube/auth.js";

const yt = google.youtube({ version: "v3", auth: getAuthorizedClient(loadConfig()) });
const ch = await yt.channels.list({ part: ["contentDetails"], mine: true });
const uploads = ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
if (!uploads) { console.log("no uploads playlist found"); process.exit(0); }

const pl = await yt.playlistItems.list({ part: ["snippet", "contentDetails"], playlistId: uploads, maxResults: 10 });
const ids = (pl.data.items ?? []).map((i) => i.contentDetails?.videoId).filter(Boolean) as string[];
const vids = await yt.videos.list({ part: ["snippet", "status"], id: ids });
for (const v of vids.data.items ?? []) {
  console.log(`${v.id}  [${v.status?.privacyStatus}]  ${v.snippet?.publishedAt}  ${v.snippet?.title}`);
  console.log(`         review: https://studio.youtube.com/video/${v.id}/edit`);
}
