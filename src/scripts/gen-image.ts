import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error("GEMINI_API_KEY missing"); process.exit(1); }

const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const prompt = process.argv[2];
const outPath = process.argv[3] || "out/img.png";
if (!prompt) { console.error("usage: gen-image '<prompt>' <outPath>"); process.exit(1); }

await mkdir("out", { recursive: true });
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["IMAGE"] },
  }),
});
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  process.exit(res.status === 429 ? 42 : 2);
}
const data: any = await res.json();
const parts = data?.candidates?.[0]?.content?.parts ?? [];
const img = parts.find((p: any) => p?.inlineData?.data);
if (!img) { console.error("No image in response: " + JSON.stringify(data).slice(0, 400)); process.exit(3); }
const buf = Buffer.from(img.inlineData.data, "base64");
await writeFile(outPath, buf);
console.log(`✅ ${outPath} (${buf.length} bytes)`);
