import { spawn } from "node:child_process";

// Script generator backend: "claude" (Claude Code, uses your Max subscription) or "gemini" (free HTTP API).
const PROVIDER = (process.env.SCRIPT_PROVIDER || "gemini").toLowerCase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function discordPing(content: string): Promise<void> {
  const hook = process.env.DISCORD_WEBHOOK;
  if (!hook) return;
  try {
    await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
  } catch {
    /* non-fatal */
  }
}

// Extract the FIRST balanced JSON object — robust to any preamble or trailing prose
// the model may add around it (the cause of the "non-whitespace after JSON" crash).
function stripJson(s: string): string {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : s;
  const start = body.indexOf("{");
  if (start < 0) return body.trim();
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return body.slice(start, i + 1);
  }
  return body.slice(start).trim();
}

// ---- Claude Code (uses your Max subscription via CLAUDE_CODE_OAUTH_TOKEN, or local login) ----
function claudeOnce(prompt: string): Promise<{ ok: boolean; text: string; auth: boolean; limit: boolean; err: string }> {
  return new Promise((resolve) => {
    // stdin = ignore so the CLI never waits on stdin (it hangs on headless/CI otherwise)
    const child = spawn("claude", ["-p", prompt, "--output-format", "text"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolve({ ok: false, text: "", auth: false, limit: false, err: String(e) }));
    child.on("close", (code) => {
      const blob = (out + " " + err).toLowerCase();
      const auth = /unauthor|authenticat|invalid api key|invalid.*token|token.*(expired|invalid)|expired|oauth|\b401\b|please run|not logged in|\/login/.test(blob);
      const limit = /(weekly|usage|session) limit|limit.*resets|rate.?limit|\b429\b|overloaded/.test(blob);
      resolve({ ok: code === 0 && out.trim().length > 0, text: out, auth, limit, err: (err || out || `exit ${code}`).slice(0, 400) });
    });
  });
}

class ClaudeLimitError extends Error {}

async function claudeGenerate(prompt: string, json: boolean): Promise<string> {
  const p = json
    ? prompt + "\n\nDo not use any tools or read/write files. Respond with ONLY a single valid JSON object — no prose, no markdown fences."
    : prompt + "\n\nDo not use any tools. Respond with only the requested text.";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await claudeOnce(p);
    if (r.ok) {
      if (!json) return r.text.trim();
      const cleaned = stripJson(r.text);
      try { JSON.parse(cleaned); return cleaned; } // validate before handing back
      catch { console.log(`Claude returned unparseable JSON (attempt ${attempt}) — retrying…`); await sleep(2000); continue; }
    }
    if (r.limit) {
      // usage/rate limit — retrying is pointless; let generate() fall back to Gemini
      throw new ClaudeLimitError(r.err.replace(/\s+/g, " ").slice(0, 200));
    }
    if (r.auth) {
      await discordPing(
        "⚠️ **Claude Code needs re-authentication** — today's video/short can't generate its script until the token is refreshed.\n" +
          "Fix: run `claude setup-token` locally, then update the `CLAUDE_CODE_OAUTH_TOKEN` GitHub secret (or paste it to your assistant). Runs will keep failing until then.",
      );
      console.error("Claude Code auth failure — pinged Discord to re-authenticate.");
      process.exit(2);
    }
    console.log(`Claude Code attempt ${attempt} failed (transient) — retrying… [${r.err.replace(/\s+/g, " ").slice(0, 200)}]`);
    await sleep(5000 * attempt);
  }
  await discordPing("⚠️ Claude Code script generation failed repeatedly (non-auth). Check the GitHub Actions logs.");
  console.error("Claude Code failed after retries.");
  process.exit(1);
}

// ---- Gemini (free HTTP API) ----
// Model chain: when a model's free-tier quota is exhausted (hard 429), move down the chain —
// flash-lite has a separate, much larger daily allowance than flash.
const GEMINI_CHAIN = [
  process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash",
  process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite",
  process.env.GEMINI_FALLBACK2_MODEL || "gemma-4-31b-it",     // separate (large) free quota
  process.env.GEMINI_FALLBACK3_MODEL || "gemini-2.0-flash-lite", // last resort, separate quota
];
let geminiModelIdx = 0; // sticky: once a model's quota is gone for the day, stay on the fallback

async function geminiGenerate(prompt: string, schema?: unknown): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.error("GEMINI_API_KEY missing"); process.exit(1); }

  while (geminiModelIdx < GEMINI_CHAIN.length) {
    const model = GEMINI_CHAIN[geminiModelIdx];
    // Gemma models don't support structured-output mode — ask for JSON in-prompt instead.
    const gemma = model.startsWith("gemma");
    const generationConfig: Record<string, unknown> = { temperature: 1.0, maxOutputTokens: 8192 };
    if (schema && !gemma) { generationConfig.responseMimeType = "application/json"; generationConfig.responseSchema = schema; }
    const text = schema && gemma ? prompt + "\n\nRespond with ONLY a single valid JSON object — no prose, no markdown fences." : prompt;
    const body = JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig });
    for (let attempt = 1; attempt <= 6; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      if (res.ok) {
        const data: any = await res.json();
        // thinking models return reasoning parts flagged thought:true — never include those
        const out = (data?.candidates?.[0]?.content?.parts ?? [])
          .filter((p: any) => !p.thought)
          .map((p: any) => p.text ?? "")
          .join("");
        return schema ? stripJson(out) : out;   // stripJson is a no-op on already-clean JSON
      }
      const errTxt = (await res.text()).slice(0, 300);
      if (res.status === 429) {
        // free-tier 429s rarely clear quickly — one short retry, then walk down the chain
        if (attempt < 2 && !/quota|plan|billing/i.test(errTxt)) { await sleep(5000); continue; }
        console.log(`Gemini ${model} rate/quota limited — switching to ${GEMINI_CHAIN[geminiModelIdx + 1] ?? "nothing"}…`);
        break;
      }
      if ([500, 502, 503, 504].includes(res.status)) { await sleep(5000 * attempt); continue; }
      console.error(`Gemini HTTP ${res.status}: ${errTxt}`); process.exit(1);
    }
    geminiModelIdx++;
  }
  console.error("All Gemini models exhausted their quota."); process.exit(1);
}

let limitNotified = false;
export async function generate(prompt: string, schema?: unknown): Promise<string> {
  if (PROVIDER === "claude") {
    try {
      return await claudeGenerate(prompt, !!schema);
    } catch (e) {
      if (e instanceof ClaudeLimitError && process.env.GEMINI_API_KEY) {
        if (!limitNotified) {
          limitNotified = true;
          console.log(`Claude usage limit hit [${e.message}] — falling back to Gemini for this run.`);
          await discordPing("ℹ️ **Claude weekly limit hit** — today's video is being written by the free Gemini fallback instead. No action needed.");
        }
        return geminiGenerate(prompt, schema);
      }
      throw e;
    }
  }
  return geminiGenerate(prompt, schema);
}
