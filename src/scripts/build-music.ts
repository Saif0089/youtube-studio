import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";

// Real background music: curated Kevin MacLeod tracks (CC BY 4.0 — the credit line is written
// to out/music.json and publish.ts appends it to the video description). Downloaded at runtime
// (cached per run); falls back to the old synthesized pad if the download fails.
const run = promisify(execFile);
const props = JSON.parse(await readFile("out/props.json", "utf8"));
const story = JSON.parse(await readFile("out/story.json", "utf8"));
const ND = props.narrationDurSec as number;
const D = Math.ceil(ND + 3);

const TRACKS = [
  { title: "Wholesome", file: "Wholesome.mp3" },
  { title: "Carefree", file: "Carefree.mp3" },
  { title: "Life of Riley", file: "Life%20of%20Riley.mp3" },
  { title: "Sneaky Snitch", file: "Sneaky%20Snitch.mp3" },
  { title: "Vibing Over Venus", file: "Vibing%20Over%20Venus.mp3" },
];
const BASE = "https://incompetech.com/music/royalty-free/mp3-royaltyfree/";

async function synthFallback(): Promise<void> {
  const MFOUT = Math.round((ND - 0.5) * 1000) / 1000;
  const sine = (f: number) => ["-f", "lavfi", "-i", `sine=frequency=${f}:duration=${D}`];
  await run("ffmpeg", ["-y",
    ...sine(110), ...sine(164.81), ...sine(220), ...sine(261.63), ...sine(329.63), ...sine(55),
    "-filter_complex",
    `[0]volume=0.30[a0];[1]volume=0.26[a1];[2]volume=0.30[a2];[3]volume=0.22[a3];[4]volume=0.14[a4];[5]volume=0.30[a5];` +
      `[a0][a1][a2][a3][a4][a5]amix=inputs=6:normalize=0[mx];` +
      `[mx]tremolo=f=0.1:d=0.45,aecho=0.8:0.85:600|1100:0.3|0.2,lowpass=f=2600,loudnorm=I=-20:TP=-1.5,` +
      `afade=t=in:st=0:d=3,afade=t=out:st=${MFOUT}:d=3.5[music]`,
    "-map", "[music]", "-c:a", "pcm_s16le", "out/music.wav"]);
  await writeFile("out/music.json", JSON.stringify({ credit: null }));
  console.log("music ok (synth fallback)");
}

const seed = [...String(story.title ?? "")].reduce((a, c) => a + c.charCodeAt(0), 0);
const track = TRACKS[seed % TRACKS.length];
try {
  await mkdir("out/music-cache", { recursive: true });
  const cached = `out/music-cache/${track.file}`;
  const have = await stat(cached).then((s) => s.size > 100_000).catch(() => false);
  if (!have) {
    await run("curl", ["-sL", "-m", "60", "-o", cached, BASE + track.file]);
    const ok = await stat(cached).then((s) => s.size > 100_000).catch(() => false);
    if (!ok) throw new Error("download too small");
  }
  await run("ffmpeg", ["-y", "-loglevel", "error", "-stream_loop", "-1", "-t", String(D), "-i", cached,
    "-filter_complex", `loudnorm=I=-23:TP=-2,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, D - 4)}:d=4[out]`,
    "-map", "[out]", "-c:a", "pcm_s16le", "out/music.wav"]);
  await writeFile("out/music.json", JSON.stringify({
    credit: `Music: "${track.title}" by Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0`,
  }));
  console.log(`music ok: ${track.title} (Kevin MacLeod, CC BY 4.0)`);
} catch (e) {
  console.log(`music download failed (${String(e).slice(0, 120)}) — synth fallback`);
  await synthFallback();
}
