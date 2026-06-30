import { spawn } from "node:child_process";

// Vertical Short (clean video-clip style): same engine as make-daily but portrait + short.
// Renders out/short.mp4 (publish-short.ts uploads it). Does NOT publish here.
const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} -> exit ${c}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };
const PORT = { ORIENT: "portrait" };
const GEN = { VIDEO_WORDS: process.env.SHORT_WORDS || "130", VIDEO_SCENES: process.env.SHORT_SCENES || "4" };
const PORT_OUT = { ...PORT, COMPOSE_OUT: "out/short.mp4" };

await step("1/6 script (Claude)", () => run("npx", ["tsx", "src/scripts/gen-vid-script.ts"], GEN));
await step("2/6 stock video clips (portrait)", () => run("npx", ["tsx", "src/scripts/gen-bg-video.ts"], PORT));
await step("3/6 narrate (edge-tts)", () => run("npx", ["tsx", "src/scripts/narrate-edge.ts"]));
await step("4/6 timing + caption props", () => run("npx", ["tsx", "src/scripts/prepare-video.ts"], PORT));
await step("5/6 music", () => run("npx", ["tsx", "src/scripts/build-music.ts"]).catch((e) => console.error("music failed (non-fatal):", e)));
await step("6/6 compose (ffmpeg) -> out/short.mp4", () => run("npx", ["tsx", "src/scripts/compose-video.ts"], PORT_OUT));

console.log("\n✅ short rendered: out/short.mp4");
