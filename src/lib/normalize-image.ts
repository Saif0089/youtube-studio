import { writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

// Force any downloaded image to exactly 1280x720 (16:9) via cover-scale + crop,
// so every drawing matches the video frame (no squeezing / letterboxing).
export async function normalizeImage(buf: Buffer, outPath: string): Promise<void> {
  const tmp = outPath + ".raw";
  await writeFile(tmp, buf);
  const ok = await new Promise<boolean>((resolve) => {
    const p = spawn(
      "ffmpeg",
      ["-y", "-i", tmp, "-vf", "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720", "-q:v", "3", outPath],
      { stdio: "ignore" },
    );
    p.on("close", (c) => resolve(c === 0));
    p.on("error", () => resolve(false));
  });
  await rm(tmp, { force: true }).catch(() => {});
  if (!ok) await writeFile(outPath, buf); // ffmpeg missing -> keep the raw image
}
