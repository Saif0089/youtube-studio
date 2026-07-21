import { spawn } from "node:child_process";
import { readFile, copyFile, mkdir, rm } from "node:fs/promises";

// Generates a finished video at out/story.mp4 (script -> voice -> images -> music -> render).
// Does NOT upload — the app previews first, then calls publish.ts on approval.

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} -> exit ${code}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };

const voice = (process.env.VOICE_PROVIDER || "edge").toLowerCase();
const imageProvider = (process.env.IMAGE_PROVIDER || "comfy").toLowerCase();
const comp = process.env.REMOTION_COMP || "ExplainerVideo";
const imgScripts: Record<string, string> = {
  comfy: "src/scripts/gen-scenes-comfy.ts",
  meshy: "src/scripts/gen-scenes-meshy.ts",
  local: "src/scripts/gen-scenes-local.ts",
  pollinations: "src/scripts/gen-scenes-pollinations.ts",
  cloudflare: "src/scripts/gen-scenes-cf.ts",
};
// RealVisXL photoreal provider needs photographic (not doodle) scene prompts.
if (imageProvider === "comfy") process.env.IMAGE_STYLE = process.env.IMAGE_STYLE || "photo";

await step("1/7 writing script", () => run("npx", ["tsx", "src/scripts/gen-script.ts"]));
await step(`2/7 narrating (${voice})`, () => run("npx", ["tsx", voice === "eleven" ? "src/scripts/narrate-timed.ts" : "src/scripts/narrate-edge.ts"]));
await step("3/7 captions + timing", () => run("npx", ["tsx", "src/scripts/prepare-render.ts"]));
await step(`4/7 drawings (${imageProvider})`, () => run("npx", ["tsx", imgScripts[imageProvider] ?? imgScripts.cloudflare]));
await step("5/7 music", () => run("npx", ["tsx", "src/scripts/build-music.ts"]));
await step("6/7 staging assets", async () => {
  await rm("public", { recursive: true, force: true }).catch(() => {});
  await mkdir("public", { recursive: true });
  const props = JSON.parse(await readFile("out/props.json", "utf8"));
  for (const img of props.images) await copyFile(`out/${img}`, `public/${img}`);
  await copyFile("out/narration.mp3", "public/narration.mp3");
  await copyFile("out/music.wav", "public/music.wav");
});
await step("7/7 rendering video", () =>
  run("npx", ["remotion", "render", "src/remotion/index.ts", comp, "out/story.mp4", "--props=./out/props.json", "--concurrency=4", "--log=error"]));

await step("thumbnail", () => run("npx", ["remotion", "still", "src/remotion/index.ts", "Thumbnail", "out/thumbnail.jpg", "--props=./out/props.json"]));
console.log("\n✅ video ready: out/story.mp4");
