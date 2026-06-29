import { spawn } from "node:child_process";
import { readFile, copyFile, mkdir, rm } from "node:fs/promises";

// Vertical Short: same engine as make-daily but portrait + short. Renders out/short.mp4
// (publish-short.ts uploads it). Does NOT publish here.
const run = (cmd: string, args: string[], env?: Record<string, string>) =>
  new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} -> exit ${c}`))));
  });
const step = async (name: string, fn: () => Promise<void>) => { console.log(`\n=== ${name} ===`); await fn(); };
const PORT = { ORIENT: "portrait" };
const GEN = { ...PORT, DOODLE_WORDS: process.env.SHORT_WORDS || "130", DOODLE_SCENES: process.env.SHORT_SCENES || "5" };
const conc = process.env.RENDER_CONCURRENCY || "4";

await step("1/6 script + doodle host (Claude)", () => run("npx", ["tsx", "src/scripts/gen-doodle-long.ts"], GEN));
await step("2/6 stock backgrounds (portrait)", () => run("npx", ["tsx", "src/scripts/gen-bg-stock.ts"], PORT));
await step("3/6 narrate (edge-tts)", () => run("npx", ["tsx", "src/scripts/narrate-edge.ts"]));
await step("4/6 props (portrait)", () => run("npx", ["tsx", "src/scripts/prepare-host.ts"], PORT));
await step("5/6 stage assets", async () => {
  await rm("public", { recursive: true, force: true }).catch(() => {});
  await mkdir("public", { recursive: true });
  const props = JSON.parse(await readFile("out/props.json", "utf8"));
  for (const img of props.images) await copyFile(`out/${img}`, `public/${img}`);
  await copyFile("out/narration.mp3", "public/narration.mp3");
});
await step("6/6 render -> out/short.mp4", () =>
  run("npx", ["remotion", "render", "src/remotion/index.ts", "HostShort", "out/short.mp4", "--props=./out/props.json", `--concurrency=${conc}`, "--log=error"]));

console.log("\n✅ doodle-host short rendered: out/short.mp4");
