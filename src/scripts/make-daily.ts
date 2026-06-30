import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

// Daily long video (clean video-clip style): script -> stock video clips -> edge-tts ->
// timing+captions -> music -> ffmpeg compose -> thumbnail -> publish.
const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} -> exit ${c}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };
const LAND = { ORIENT: "landscape" };

await step("1/7 script (Claude)", () => run("npx", ["tsx", "src/scripts/gen-vid-script.ts"]));
await step("2/7 stock video clips", () => run("npx", ["tsx", "src/scripts/gen-bg-video.ts"], LAND));
await step("3/7 narrate (edge-tts)", () => run("npx", ["tsx", "src/scripts/narrate-edge.ts"]));
await step("4/7 timing + caption props", () => run("npx", ["tsx", "src/scripts/prepare-video.ts"], LAND));
await step("5/7 music", () => run("npx", ["tsx", "src/scripts/build-music.ts"]).catch((e) => console.error("music failed (non-fatal):", e)));
await step("6/7 compose (ffmpeg) -> out/story.mp4", () => run("npx", ["tsx", "src/scripts/compose-video.ts"], LAND));
await step("7/7 thumbnail", async () => {
  await mkdir("public", { recursive: true });
  // extract from the CLEAN footage (out/bg.mp4) so burned-in captions don't ghost behind the title
  await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", "7", "-i", "out/bg.mp4", "-frames:v", "1",
    "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720", "public/thumb-bg.jpg"]);
  await run("npx", ["remotion", "still", "src/remotion/index.ts", "Thumbnail", "out/thumbnail.jpg", "--props=./out/props.json", "--log=error"])
    .catch((e) => console.error("thumbnail failed (non-fatal):", e));
});

if (process.env.NO_PUBLISH) console.log("\nNO_PUBLISH set — skipping upload.");
else await step("publish (YouTube)", () => run("npx", ["tsx", "src/scripts/publish.ts"]));

console.log("\n✅ daily video complete");
