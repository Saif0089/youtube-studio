import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
const sh = promisify(execFile);

// Draw Things local HTTP API client — drives Wan 2.2 5B (text->video) entirely on-device.
// generateClip() turns a prompt into a finished 16:9 mp4: it POSTs to /sdapi/v1/txt2img,
// receives the frames, motion-interpolates 5fps -> 24fps for smoothness, and upscales to 1080p.
const API = process.env.DT_API || "http://127.0.0.1:7860";
const NEG = process.env.WAN_NEG ||
  "blurry, distorted, deformed, low quality, watermark, text, letters, extra limbs, jpeg artifacts, oversaturated";
const STYLE = process.env.WAN_STYLE || "cinematic film look, highly detailed, sharp focus, natural motion, volumetric light";

export type WanOpts = { width?: number; height?: number; steps?: number; seed?: number };

export async function generateClip(prompt: string, outMp4: string, opts: WanOpts = {}): Promise<boolean> {
  const width = opts.width ?? Number(process.env.WAN_W || 960);   // 16:9, near the proven ~590k-px quality budget
  const height = opts.height ?? Number(process.env.WAN_H || 544);
  const steps = opts.steps ?? Number(process.env.WAN_STEPS || 28); // 20 undercooks -> smeared; 28 is the quality floor
  const seed = opts.seed ?? Math.floor(Math.random() * 2_000_000_000);
  const body = JSON.stringify({
    prompt: `${prompt}. ${STYLE}. No text or letters. Modest, family-friendly.`,
    negative_prompt: NEG,
    steps, width, height, seed,
  });
  // Drive the API via curl, NOT node fetch: undici's default bodyTimeout is 300s and a single
  // on-device clip takes many minutes — fetch would abort mid-generation. curl has no such cap.
  const reqFile = `${outMp4}.req.json`;
  const respFile = `${outMp4}.resp.json`;
  let data: any;
  try {
    await writeFile(reqFile, body);
    await sh("curl", ["-sS", "-m", "3600", "-X", "POST", `${API}/sdapi/v1/txt2img`,
      "-H", "Content-Type: application/json", "-d", `@${reqFile}`, "-o", respFile], { maxBuffer: 1 << 30 });
    data = JSON.parse(await readFile(respFile, "utf8"));
  } catch (e) {
    console.error(`  DT API error: ${String(e).slice(0, 140)}`);
    await rm(reqFile, { force: true }).catch(() => {});
    await rm(respFile, { force: true }).catch(() => {});
    return false;
  }
  await rm(reqFile, { force: true }).catch(() => {});
  await rm(respFile, { force: true }).catch(() => {});

  const frames: string[] = data?.images ?? [];
  if (!frames.length) { console.error("  DT API returned no frames"); return false; }

  const dir = `${outMp4}.frames`;
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < frames.length; i++) {
    await writeFile(`${dir}/f${String(i).padStart(3, "0")}.png`, Buffer.from(frames[i].split(",").pop()!, "base64"));
  }
  const portrait = process.env.ORIENT === "portrait";
  const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080;
  // 5fps source -> 24fps motion-interpolated, upscaled/cropped to output frame
  await sh("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "5", "-i", `${dir}/f%03d.png`,
    "-vf", `minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:me_mode=bidir,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", outMp4]);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  return true;
}
