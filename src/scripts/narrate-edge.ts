import { spawn } from "node:child_process";

// Free narration via Edge neural TTS. uv runs the python helper in an ephemeral
// env (auto-installs edge-tts) — works locally and on CI without a pip step.
const code = await new Promise<number>((resolve) => {
  const p = spawn("uv", ["run", "--with", "edge-tts", "python3", "tools/edge_narrate.py"], { stdio: "inherit" });
  p.on("close", (c) => resolve(c ?? 1));
});
if (code !== 0) process.exit(code);
