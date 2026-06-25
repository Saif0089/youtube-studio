import { spawn } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";

// Daily long video, doodle engine: Claude writes the script + a doodle SVG per scene,
// Edge-TTS narrates, Remotion animates + renders to out/story.mp4, a doodle thumbnail is
// rendered, then publish.ts uploads (private for review). No image APIs. $0.
const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} -> exit ${c}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };
const LAND = { ORIENT: "landscape" };

await step("1/7 script + doodle scenes (Claude)", () => run("npx", ["tsx", "src/scripts/gen-doodle-long.ts"]));
await step("2/7 narrate (edge-tts)", () => run("npx", ["tsx", "src/scripts/narrate-edge.ts"]));
await step("3/7 props (scene timing + captions)", () => run("npx", ["tsx", "src/scripts/prepare-doodle.ts"], LAND));
await step("4/7 stage audio", async () => {
  await rm("public", { recursive: true, force: true }).catch(() => {});
  await mkdir("public", { recursive: true });
  await copyFile("out/narration.mp3", "public/narration.mp3");
});
await step("5/7 render (landscape doodle) -> out/story.mp4", () =>
  run("npx", ["remotion", "render", "src/remotion/index.ts", "DoodleLong", "out/story.mp4", "--props=./out/props.json", "--concurrency=4", "--log=error"]));
await step("6/7 thumbnail", () =>
  run("npx", ["remotion", "still", "src/remotion/index.ts", "DoodleThumbnail", "out/thumbnail.jpg", "--props=./out/props.json", "--log=error"]));
await step("7/7 publish (YouTube)", () => run("npx", ["tsx", "src/scripts/publish.ts"]));

console.log("\n✅ daily doodle video complete");
