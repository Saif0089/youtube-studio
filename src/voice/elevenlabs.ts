import type { VoiceConfig } from "../config.js";
import { writeFile, mkdtemp, rm, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkText } from "./chunk.js";

const run = promisify(execFile);
const MODEL_ID = "eleven_multilingual_v2";

export async function synthesizeChunk(cfg: VoiceConfig, text: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": cfg.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function synthesizeNarration(cfg: VoiceConfig, text: string, outPath: string): Promise<string> {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("No text to synthesize");
  const dir = await mkdtemp(join(tmpdir(), "voice-"));
  try {
    const parts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const buf = await synthesizeChunk(cfg, chunks[i]);
      const p = join(dir, `part-${String(i).padStart(4, "0")}.mp3`);
      await writeFile(p, buf);
      parts.push(p);
    }
    if (parts.length === 1) { await writeFile(outPath, await readFile(parts[0])); return outPath; }
    const listPath = join(dir, "list.txt");
    await writeFile(listPath, parts.map((p) => `file '${p}'`).join("\n"));
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
    return outPath;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
