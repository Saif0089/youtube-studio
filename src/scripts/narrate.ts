import "dotenv/config";
import { readFile, mkdir } from "node:fs/promises";
import { loadVoiceConfig } from "../config.js";
import { synthesizeNarration } from "../voice/elevenlabs.js";

const story = JSON.parse(await readFile("out/story.json", "utf8"));
await mkdir("out", { recursive: true });
await synthesizeNarration(loadVoiceConfig(), story.script, "out/narration.mp3");
console.log("✅ narration -> out/narration.mp3");
