import "dotenv/config";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { loadVoiceConfig } from "../config.js";

const cfg = loadVoiceConfig();
const story = JSON.parse(await readFile("out/story.json", "utf8"));
await mkdir("out", { recursive: true });

const reqBody = JSON.stringify({
  text: story.script,
  model_id: "eleven_multilingual_v2",
  voice_settings: { stability: 0.35, similarity_boost: 0.85, style: 0.35, use_speaker_boost: true },
});
let data: any;
for (let attempt = 1; ; attempt++) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}/with-timestamps`, {
    method: "POST",
    headers: { "xi-api-key": cfg.apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: reqBody,
  });
  if (res.ok) { data = await res.json(); break; }
  const errTxt = (await res.text()).slice(0, 300);
  if ([429, 500, 502, 503, 504].includes(res.status) && attempt <= 5) {
    const wait = 5000 * attempt;
    console.log(`ElevenLabs ${res.status} (attempt ${attempt}) — retrying in ${wait / 1000}s…`);
    await new Promise((r) => setTimeout(r, wait));
    continue;
  }
  console.error(`HTTP ${res.status}: ${errTxt}`);
  process.exit(1);
}
await writeFile("out/narration.mp3", Buffer.from(data.audio_base64, "base64"));
const al = data.alignment ?? data.normalized_alignment ?? {};
await writeFile("out/alignment.json", JSON.stringify(al));
await rm("out/words.json", { force: true }); // drop stale Edge timing so prepare-render uses this alignment
const ends = al.character_end_times_seconds ?? [];
console.log(`audio saved; chars=${(al.characters ?? []).length}; dur=${ends.length ? ends[ends.length - 1] : "?"}s`);
