import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

// Records THIS job's topic into state/used-topics.json (+ updates last-run.txt), race-safe so the
// parallel long + short jobs both persist without clobbering each other. On each attempt it resets
// to the freshest origin/main and re-appends, so whoever pushes second still keeps both topics.
// out/ is gitignored, so out/story.json (holding the title) survives `git reset --hard`.
const title: string = JSON.parse(await readFile("out/story.json", "utf8")).title;
if (!title) { console.log("no title to persist"); process.exit(0); }

const git = (...a: string[]) => execFileSync("git", a, { stdio: "inherit" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try { git("config", "user.name", "infotainmentstu-bot"); git("config", "user.email", "bot@users.noreply.github.com"); } catch {}

for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    git("fetch", "origin", "main");
    git("reset", "--hard", "origin/main");
    let used: string[] = [];
    try { used = JSON.parse(await readFile("state/used-topics.json", "utf8")); } catch {}
    if (!used.includes(title)) used.push(title);
    await writeFile("state/used-topics.json", JSON.stringify(used.slice(-400), null, 1) + "\n");
    await writeFile("state/last-run.txt", new Date().toISOString().slice(0, 10) + "\n");
    git("add", "state/used-topics.json", "state/last-run.txt");
    try { git("commit", "-m", "chore: record topic + run marker [skip ci]"); }
    catch { console.log("nothing new to commit"); process.exit(0); }
    git("push", "origin", "main");
    console.log(`✅ persisted topic: ${title}`);
    process.exit(0);
  } catch {
    console.log(`persist attempt ${attempt} lost the race — retrying…`);
    await sleep(1500 + Math.floor(Math.random() * 3000));
  }
}
console.log("persist failed after retries (non-fatal — the video already uploaded)");
