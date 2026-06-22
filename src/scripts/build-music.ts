import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const run = promisify(execFile);
const props = JSON.parse(await readFile("out/props.json", "utf8"));
const ND = props.narrationDurSec as number;
const MDUR = Math.round((ND + 3) * 1000) / 1000;
const MFOUT = Math.round((ND - 0.5) * 1000) / 1000;

const sine = (f: number) => ["-f", "lavfi", "-i", `sine=frequency=${f}:duration=${MDUR}`];
const args = [
  "-y",
  ...sine(110), ...sine(164.81), ...sine(220), ...sine(261.63), ...sine(329.63), ...sine(55),
  "-filter_complex",
  `[0]volume=0.30[a0];[1]volume=0.26[a1];[2]volume=0.30[a2];[3]volume=0.22[a3];[4]volume=0.14[a4];[5]volume=0.30[a5];` +
    `[a0][a1][a2][a3][a4][a5]amix=inputs=6:normalize=0[mx];` +
    `[mx]tremolo=f=0.1:d=0.45,aecho=0.8:0.85:600|1100:0.3|0.2,lowpass=f=2600,loudnorm=I=-20:TP=-1.5,` +
    `afade=t=in:st=0:d=3,afade=t=out:st=${MFOUT}:d=3.5[music]`,
  "-map", "[music]", "-c:a", "pcm_s16le", "out/music.wav",
];
await run("ffmpeg", args);
console.log("music ok");
