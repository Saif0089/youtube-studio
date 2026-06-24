import { spawn } from "node:child_process";
import { readFile, copyFile, mkdir } from "node:fs/promises";

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit" });
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} -> exit ${code}`))));
  });

const step = async (name: string, fn: () => Promise<void>) => {
  console.log(`\n=== ${name} ===`);
  await fn();
};

const voice = (process.env.VOICE_PROVIDER || "edge").toLowerCase(); // edge (free) | eleven (clone)
const imageProvider = (process.env.IMAGE_PROVIDER || "cloudflare").toLowerCase(); // cloudflare | meshy (falls back to pollinations)
const comp = process.env.REMOTION_COMP || "ExplainerVideo";
const imgScripts: Record<string, string> = {
  meshy: "src/scripts/gen-scenes-meshy.ts",
  local: "src/scripts/gen-scenes-local.ts",
  pollinations: "src/scripts/gen-scenes-pollinations.ts",
  cloudflare: "src/scripts/gen-scenes-cf.ts",
};

await step("1. script (Gemini)", () => run("npx", ["tsx", "src/scripts/gen-script.ts"]));
await step(`2. narrate (${voice})`, () =>
  run("npx", ["tsx", voice === "eleven" ? "src/scripts/narrate-timed.ts" : "src/scripts/narrate-edge.ts"]));
await step("3. captions + props", () => run("npx", ["tsx", "src/scripts/prepare-render.ts"]));
await step(`4. images (${imageProvider})`, () => run("npx", ["tsx", imgScripts[imageProvider] ?? imgScripts.cloudflare]));
await step("5. music", () => run("npx", ["tsx", "src/scripts/build-music.ts"]));
await step("6. stage assets", async () => {
  await mkdir("public", { recursive: true });
  const props = JSON.parse(await readFile("out/props.json", "utf8"));
  for (const img of props.images) await copyFile(`out/${img}`, `public/${img}`);
  await copyFile("out/narration.mp3", "public/narration.mp3");
  await copyFile("out/music.wav", "public/music.wav");
});
await step("7. render (Remotion)", () =>
  run("npx", ["remotion", "render", "src/remotion/index.ts", comp, "out/story.mp4", "--props=./out/props.json", "--concurrency=4", "--log=error"]));
await step("7b. thumbnail", () => run("npx", ["remotion", "still", "src/remotion/index.ts", "Thumbnail", "out/thumbnail.jpg", "--props=./out/props.json"]));
await step("8. publish (YouTube)", () => run("npx", ["tsx", "src/scripts/publish.ts"]));

console.log("\n✅ daily video complete");
