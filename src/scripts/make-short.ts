import { spawn } from "node:child_process";
import { readFile, copyFile, mkdir, rm } from "node:fs/promises";

// Builds a vertical 9:16 YouTube Short (self-contained money-psych hook) and uploads it.
const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} -> exit ${c}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };

const voice = (process.env.VOICE_PROVIDER || "edge").toLowerCase();
const imageProvider = (process.env.IMAGE_PROVIDER || "meshy").toLowerCase();
const imgScripts: Record<string, string> = {
  meshy: "src/scripts/gen-scenes-meshy.ts",
  local: "src/scripts/gen-scenes-local.ts",
  pollinations: "src/scripts/gen-scenes-pollinations.ts",
  cloudflare: "src/scripts/gen-scenes-cf.ts",
};
const PORTRAIT = { ORIENT: "portrait" };

await step("1/8 short script", () => run("npx", ["tsx", "src/scripts/gen-short.ts"]));
await step(`2/8 narrate (${voice})`, () => run("npx", ["tsx", voice === "eleven" ? "src/scripts/narrate-timed.ts" : "src/scripts/narrate-edge.ts"]));
await step("3/8 captions + timing", () => run("npx", ["tsx", "src/scripts/prepare-render.ts"]));
await step(`4/8 drawings (${imageProvider}, 9:16)`, () => run("npx", ["tsx", imgScripts[imageProvider] ?? imgScripts.cloudflare], PORTRAIT));
await step("5/8 music", () => run("npx", ["tsx", "src/scripts/build-music.ts"]));
await step("6/8 staging", async () => {
  await rm("public", { recursive: true, force: true }).catch(() => {});
  await mkdir("public", { recursive: true });
  const props = JSON.parse(await readFile("out/props.json", "utf8"));
  for (const img of props.images) await copyFile(`out/${img}`, `public/${img}`);
  await copyFile("out/narration.mp3", "public/narration.mp3");
  await copyFile("out/music.wav", "public/music.wav");
});
await step("7/8 render (vertical)", () =>
  run("npx", ["remotion", "render", "src/remotion/index.ts", "ShortVideo", "out/short.mp4", "--props=./out/props.json", "--concurrency=4", "--log=error"]));
await step("8/8 publish Short", () => run("npx", ["tsx", "src/scripts/publish-short.ts"]));

console.log("\n✅ short complete: out/short.mp4");
