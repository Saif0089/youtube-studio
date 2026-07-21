import { spawn } from "node:child_process";

// Local ComfyUI client for RealVisXL photoreal image generation.
// Talks to a ComfyUI server on 127.0.0.1:8188; auto-starts it if it isn't running.
// Recipe = the proven RealVisXL_Hyper8: 8 steps, CFG 2, euler, sgm_uniform, LoRA strength 1.0.

const SERVER = process.env.COMFY_SERVER || "127.0.0.1:8188";
const COMFY_DIR = process.env.COMFY_DIR || "/Users/ehtisham/ComfyUI";
const COMFY_PY = process.env.COMFY_PY || `${COMFY_DIR}/venv/bin/python`;
const CKPT = process.env.COMFY_CKPT || "RealVisXL_V5.0_fp16.safetensors";
const LORA = process.env.COMFY_LORA || "Hyper-SDXL-8steps-CFG-lora.safetensors";
const BASE = `http://${SERVER}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function isUp(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/system_stats`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

// Make sure a ComfyUI server is reachable; start one (detached) if needed and wait until ready.
export async function ensureServer(timeoutMs = 120000): Promise<void> {
  if (await isUp()) return;
  console.log(`ComfyUI not running — launching it from ${COMFY_DIR}…`);
  const child = spawn(COMFY_PY, ["main.py", "--listen", "127.0.0.1", "--port", "8188"], {
    cwd: COMFY_DIR,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(2500);
    if (await isUp()) {
      console.log("ComfyUI is up.");
      return;
    }
  }
  throw new Error(`ComfyUI did not become ready within ${timeoutMs / 1000}s (check ${COMFY_DIR})`);
}

function workflow(prompt: string, negative: string, width: number, height: number, seed: number) {
  return {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
    "10": {
      class_type: "LoraLoader",
      inputs: { lora_name: LORA, strength_model: 1.0, strength_clip: 1.0, model: ["4", 0], clip: ["4", 1] },
    },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["10", 1] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["10", 1] } },
    "5": { class_type: "EmptyLatentImage", inputs: { width, height, batch_size: 1 } },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed, steps: 8, cfg: 2.0, sampler_name: "euler", scheduler: "sgm_uniform", denoise: 1.0,
        model: ["10", 0], positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0],
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "realvis", images: ["8", 0] } },
  };
}

export type GenOpts = { prompt: string; negative: string; width: number; height: number; seed: number; timeoutMs?: number };

// Generate one image; returns the raw PNG bytes.
export async function generateImage(opts: GenOpts): Promise<Buffer> {
  const wf = workflow(opts.prompt, opts.negative, opts.width, opts.height, opts.seed);
  const res = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: wf }),
  });
  if (!res.ok) throw new Error(`/prompt ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { prompt_id } = (await res.json()) as { prompt_id: string };
  const timeout = opts.timeoutMs ?? 600000;
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await sleep(1500);
    const h = (await (await fetch(`${BASE}/history/${prompt_id}`)).json()) as Record<string, any>;
    const entry = h[prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error(`ComfyUI error: ${JSON.stringify(entry.status).slice(0, 300)}`);
    const imgs = entry.outputs?.["9"]?.images;
    if (!imgs || !imgs.length) throw new Error("ComfyUI finished but produced no image");
    const img = imgs[0];
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? "", type: img.type ?? "output" });
    const raw = await fetch(`${BASE}/view?${q}`);
    return Buffer.from(await raw.arrayBuffer());
  }
  throw new Error(`generation timed out after ${timeout / 1000}s`);
}
