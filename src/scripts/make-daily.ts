import { spawn } from "node:child_process";
import { readFile, copyFile, mkdir, rm } from "node:fs/promises";

// Daily long video: script + transparent doodle host scenes (Claude) -> per-sentence stock
// backgrounds (Pexels->Pixabay) -> edge-tts -> HostVideo render -> thumbnail -> publish.
const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} -> exit ${c}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };
const LAND = { ORIENT: "landscape" };
const conc = process.env.RENDER_CONCURRENCY || "4";

await step("1/7 script + doodle host scenes (Claude)", () => run("npx", ["tsx", "src/scripts/gen-doodle-long.ts"]));
await step("2/7 per-sentence stock backgrounds", () => run("npx", ["tsx", "src/scripts/gen-bg-stock.ts"], LAND));
await step("3/7 narrate (edge-tts)", () => run("npx", ["tsx", "src/scripts/narrate-edge.ts"]));
await step("4/7 props (timing + captions)", () => run("npx", ["tsx", "src/scripts/prepare-host.ts"], LAND));
await step("5/7 stage assets", async () => {
  await rm("public", { recursive: true, force: true }).catch(() => {});
  await mkdir("public", { recursive: true });
  const props = JSON.parse(await readFile("out/props.json", "utf8"));
  for (const img of props.images) await copyFile(`out/${img}`, `public/${img}`);
  await copyFile("out/narration.mp3", "public/narration.mp3");
});
await step("6/7 render -> out/story.mp4", () =>
  run("npx", ["remotion", "render", "src/remotion/index.ts", "HostVideo", "out/story.mp4", "--props=./out/props.json", `--concurrency=${conc}`, "--log=error"]));
await step("7/7 thumbnail", () =>
  run("npx", ["remotion", "still", "src/remotion/index.ts", "Thumbnail", "out/thumbnail.jpg", "--props=./out/props.json", "--log=error"])
    .catch((e) => console.error("thumbnail failed (non-fatal):", e)));

if (process.env.NO_PUBLISH) console.log("\nNO_PUBLISH set — skipping upload.");
else await step("publish (YouTube)", () => run("npx", ["tsx", "src/scripts/publish.ts"]));

console.log("\n✅ daily host video complete");
