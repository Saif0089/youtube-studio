// Split narration into "visual units" — one per sentence, merging very short fragments
// so each image has enough to illustrate. MUST stay deterministic: gen-script and
// prepare-render both call this on the SAME script string, so the counts/order match.

export function splitForVisuals(script: string): string[] {
  const raw = script
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const s of raw) {
    const wc = s.split(/\s+/).filter(Boolean).length;
    if (out.length && wc < 5) out[out.length - 1] += " " + s; // fold tiny fragments into the previous unit
    else out.push(s);
  }
  return out;
}

export const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
