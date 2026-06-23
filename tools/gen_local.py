"""Local FLUX image generation on Apple Silicon via MLX (mflux).
Loads the model ONCE, then generates one drawing per prompt in out/story.json.
Free, offline, no API/credits/caps — but slower than the cloud APIs."""
import json, os
from mflux.models.flux.variants.txt2img.flux import Flux1
from mflux.models.common.config.model_config import ModelConfig

QUANT = int(os.environ.get("MFLUX_QUANTIZE", "4"))   # 4-bit fits ~18GB RAM; 8-bit needs more
STEPS = int(os.environ.get("MFLUX_STEPS", "4"))      # schnell is a 4-step model
W = int(os.environ.get("IMG_W", "1280"))
H = int(os.environ.get("IMG_H", "720"))
STYLE = (", colorful minimalist whiteboard explainer cartoon, hand-drawn thick black marker "
         "outlines with bright flat color fills (cheerful yellow, red, blue, green, orange), "
         "include a simple light flat background or setting that fits the scene when it helps, "
         "soft pastel background colors, clean and uncluttered, no text, no letters, no numbers, no shading")

story = json.load(open("out/story.json"))
prompts = story["imagePrompts"]
print(f"local FLUX: loading schnell q{QUANT} — first run downloads the model (~24GB), please wait…", flush=True)
flux = Flux1(quantize=QUANT, model_config=ModelConfig.schnell())
print(f"model loaded; generating {len(prompts)} drawings locally…", flush=True)
for i, p in enumerate(prompts):
    img = flux.generate_image(seed=i + 1, prompt=p + STYLE, num_inference_steps=STEPS, height=H, width=W)
    img.save(path=f"out/scene-{i + 1}.jpg", overwrite=True)
    if i == 0 or (i + 1) % 5 == 0:
        print(f"  …{i + 1}/{len(prompts)}", flush=True)
print(f"✅ all {len(prompts)} drawings generated (local FLUX q{QUANT})", flush=True)
