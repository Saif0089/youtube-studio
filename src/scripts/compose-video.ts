import { readFile, writeFile, mkdir, rm, stat, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";

// Composites the final video WITHOUT decoding video through Remotion (which is too slow on CI):
//   1) ffmpeg trims/scales each stock clip to a fixed-duration segment, concatenates -> bg.mp4
//   2) Remotion renders ONLY the transparent caption/title overlay (light, text-only) -> overlay.webm
//   3) ffmpeg overlays captions on the footage and muxes narration + music -> story.mp4
const sh = (cmd: string, args: string[]) =>
  new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.slice(0, 3).join(" ")} -> exit ${c}`))));
  });
const exists = (f: string) => stat(f).then(() => true).catch(() => false);

const portrait = process.env.ORIENT === "portrait";
const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080;
const FPS = 24;
const OUT = process.env.COMPOSE_OUT || "out/story.mp4";

const timeline: { clip: string; dur: number }[] = JSON.parse(await readFile("out/timeline.json", "utf8"));
const props = JSON.parse(await readFile("out/props.json", "utf8"));
const totalDur = (props.narrationDurSec as number) + (props.fadeTailSec as number);

// 1) normalize + concat the footage into a silent background track
await rm("out/seg", { recursive: true, force: true }).catch(() => {});
await mkdir("out/seg", { recursive: true });
const list: string[] = [];
for (let i = 0; i < timeline.length; i++) {
  const { clip, dur } = timeline[i];
  const seg = `out/seg/seg-${i}.mp4`;
  await sh("ffmpeg", [
    "-y", "-loglevel", "error", "-stream_loop", "-1", "-t", String(dur), "-i", `out/${clip}`,
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1`,
    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", seg,
  ]);
  list.push(`file 'seg-${i}.mp4'`);
}
await writeFile("out/seg/list.txt", list.join("\n"));
await sh("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "out/seg/list.txt", "-c", "copy", "out/bg.mp4"]);

// 2) render the transparent kinetic-caption overlay as an RGBA PNG sequence
// (ffmpeg can't reliably decode webm/VP8 alpha; a PNG sequence carries alpha cleanly)
const comp = portrait ? "CaptionsOverlayShort" : "CaptionsOverlay";
await rm("out/overlay", { recursive: true, force: true }).catch(() => {});
await mkdir("out/overlay", { recursive: true });
await sh("npx", ["remotion", "render", "src/remotion/index.ts", comp, "out/overlay", "--props=./out/props.json", "--sequence", "--image-format=png", "--log=error"]);

// Remotion zero-pads the frame index to the digit-width of the total frame count
// (element-0.png for a few frames, element-0000.png for thousands) — detect it.
const frames = (await readdir("out/overlay")).filter((f) => /^element-\d+\.png$/.test(f));
if (!frames.length) { console.error("overlay render produced no PNG frames"); process.exit(1); }
const padW = frames[0].match(/^element-(\d+)\.png$/)![1].length;
const overlayPattern = `out/overlay/element-%0${padW}d.png`;

// 3) overlay captions on footage + mux narration (+ music if present), trimmed to the exact length
const hasMusic = await exists("out/music.wav");
const inputs = ["-i", "out/bg.mp4", "-framerate", String(FPS), "-start_number", "0", "-i", overlayPattern, "-i", "out/narration.mp3"];
let filter = "[0:v][1:v]overlay=format=auto,format=yuv420p[v];";
if (hasMusic) {
  // duck the music under the voice (sidechain), instead of a fixed low volume
  inputs.push("-i", "out/music.wav");
  filter += "[2:a]asplit=2[voxOut][voxKey];" +
    "[3:a][voxKey]sidechaincompress=threshold=0.03:ratio=10:attack=40:release=500[md];" +
    "[voxOut][md]amix=inputs=2:normalize=0:duration=longest:weights=1 0.55[a]";
} else filter += "[2:a]anull[a]";
await sh("ffmpeg", [
  "-y", "-loglevel", "error", ...inputs, "-filter_complex", filter,
  "-map", "[v]", "-map", "[a]", "-t", String(totalDur),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", OUT,
]);
console.log(`✅ composed ${OUT} (${totalDur.toFixed(1)}s, ${timeline.length} clips${hasMusic ? " + music" : ""})`);
