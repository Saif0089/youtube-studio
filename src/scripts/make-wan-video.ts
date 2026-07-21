import { spawn } from "node:child_process";

// LOCAL Wan-video channel orchestrator: short script -> on-device Wan clips -> edge-tts ->
// timing/captions -> music -> ffmpeg compose. Same reusable back half as the stock pipeline;
// only the visual source (gen-wan-clips) is new. Runs entirely on your Mac, $0.
const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} -> exit ${c}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };
const LAND = { ORIENT: "landscape" };

if (!process.env.SKIP_SCRIPT) await step("1/6 script", () => run("npx", ["tsx", "src/scripts/gen-wan-script.ts"]));
await step("2/6 Wan clips (on-device — the long step)", () => run("npx", ["tsx", "src/scripts/gen-wan-clips.ts"], LAND));
await step("3/6 narrate (edge-tts)", () => run("npx", ["tsx", "src/scripts/narrate-edge.ts"]));
await step("4/6 timing + caption props", () => run("npx", ["tsx", "src/scripts/prepare-video.ts"], LAND));
await step("5/6 music", () => run("npx", ["tsx", "src/scripts/build-music.ts"]).catch((e) => console.error("music failed (non-fatal):", e)));
await step("6/6 compose -> out/story.mp4", () => run("npx", ["tsx", "src/scripts/compose-video.ts"], LAND));
console.log("\n✅ Wan video complete: out/story.mp4");
