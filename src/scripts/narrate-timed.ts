import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { loadVoiceConfig } from "../config.js";

const cfg = loadVoiceConfig();
const story = JSON.parse(await readFile("out/story.json", "utf8"));
await mkdir("out", { recursive: true });

const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}/with-timestamps`, {
  method: "POST",
  headers: { "xi-api-key": cfg.apiKey, "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({
    text: story.script,
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.35, similarity_boost: 0.85, style: 0.35, use_speaker_boost: true },
  }),
});
if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
const data: any = await res.json();
await writeFile("out/narration.mp3", Buffer.from(data.audio_base64, "base64"));
const al = data.alignment ?? data.normalized_alignment ?? {};
await writeFile("out/alignment.json", JSON.stringify(al));
const ends = al.character_end_times_seconds ?? [];
console.log(`audio saved; chars=${(al.characters ?? []).length}; dur=${ends.length ? ends[ends.length - 1] : "?"}s`);
