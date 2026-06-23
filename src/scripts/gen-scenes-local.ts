import { spawn } from "node:child_process";

// Local FLUX via MLX (mflux). uv runs it in an isolated Python 3.12 env (auto-installs mflux).
const code = await new Promise<number>((resolve) => {
  const p = spawn("uv", ["run", "--python", "3.12", "--with", "mflux", "python", "tools/gen_local.py"], {
    stdio: "inherit",
    env: { ...process.env, MFLUX_QUANTIZE: process.env.MFLUX_QUANTIZE || "4" },
  });
  p.on("close", (c) => resolve(c ?? 1));
});
if (code !== 0) process.exit(code);
