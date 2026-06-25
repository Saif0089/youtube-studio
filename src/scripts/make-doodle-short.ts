import { spawn } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";

// Build a vertical animated DOODLE Short: Claude writes the script + a doodle SVG per scene,
// Edge-TTS narrates, Remotion animates + syncs + renders. No image APIs. $0.
const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} -> exit ${c}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };

await step("1/5 script + doodle scenes (Claude)", () => run("npx", ["tsx", "src/scripts/gen-doodle-short.ts"]));
await step("2/5 narrate (edge-tts)", () => run("npx", ["tsx", "src/scripts/narrate-edge.ts"]));
await step("3/5 props (scene timing + captions)", () => run("npx", ["tsx", "src/scripts/prepare-doodle.ts"]));
await step("4/5 stage audio", async () => {
  await rm("public", { recursive: true, force: true }).catch(() => {});
  await mkdir("public", { recursive: true });
  await copyFile("out/narration.mp3", "public/narration.mp3");
});
await step("5/5 render (vertical doodle)", () =>
  run("npx", ["remotion", "render", "src/remotion/index.ts", "DoodleShort", "out/short.mp4", "--props=./out/props.json", "--concurrency=4", "--log=error"]));

console.log("\n✅ doodle short rendered: out/short.mp4");
