import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// AI thumbnail BACKGROUND via Gemini image models (free tier). The bold title text is added
// by the existing Remotion Thumbnail composition on top. On any failure this exits 0 and the
// frame-grab background that make-daily already produced stays in place.
const run = promisify(execFile);
const key = process.env.GEMINI_API_KEY;
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const MODELS = ["gemini-2.5-flash-image", "gemini-3.1-flash-image"];

const prompt = `YouTube thumbnail background image, 16:9, for a video titled "${story.title}" about money psychology.
One single dramatic focal subject related to the topic (e.g. a wallet, cash, a shopping cart, a brain made of coins), cinematic lighting, bold saturated colors, high contrast, shallow depth of field, slightly exaggerated/stylized like top finance YouTubers.
ABSOLUTELY NO TEXT, no letters, no numbers, no watermarks. Family-friendly and modest: any people fully and modestly dressed. Leave the left third visually calmer for a title overlay.`;

if (!key) { console.log("no GEMINI_API_KEY — keeping frame-grab thumbnail"); process.exit(0); }

let done = false;
for (const model of MODELS) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
    });
    if (!res.ok) { console.log(`thumb ${model}: HTTP ${res.status} — trying next`); continue; }
    const data: any = await res.json();
    const img = (data?.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data);
    if (!img) { console.log(`thumb ${model}: no image part`); continue; }
    await writeFile("out/thumb-ai-raw.png", Buffer.from(img.inlineData.data, "base64"));
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", "out/thumb-ai-raw.png",
      "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720", "public/thumb-bg.jpg"]);
    console.log(`✅ AI thumbnail background (${model})`);
    done = true;
    break;
  } catch (e) {
    console.log(`thumb ${model} failed: ${String(e).slice(0, 120)}`);
  }
}
if (!done) console.log("AI thumbnail unavailable — keeping frame-grab background");
