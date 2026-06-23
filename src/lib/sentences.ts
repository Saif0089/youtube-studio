// Split narration into "visual units" — short lines of ~TARGET words (≈4s of speech),
// so each image illustrates a tight beat AND the pacing stays snappy. Long sentences are
// broken at clause boundaries; tiny fragments fold into the previous unit.
// MUST stay deterministic: gen-script and prepare-render both call this on the SAME script,
// so counts/order match and each image lands on its exact spoken moment.

const TARGET = 9;  // words per visual unit (~4s at ~2.4 words/sec)
const MAXU = 13;   // hard cap per unit

export function splitForVisuals(script: string): string[] {
  const sentences = script.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const units: string[] = [];
  for (const sent of sentences) {
    const w = sent.split(/\s+/).filter(Boolean);
    if (w.length <= MAXU) { units.push(sent); continue; }
    let chunk: string[] = [];
    for (let i = 0; i < w.length; i++) {
      chunk.push(w[i]);
      const atClause = /[,;:]$/.test(w[i]);
      const remaining = w.length - 1 - i;
      if ((chunk.length >= TARGET && atClause) || chunk.length >= MAXU) {
        if (remaining >= 4 || chunk.length >= MAXU) { units.push(chunk.join(" ")); chunk = []; }
      }
    }
    if (chunk.length) units.push(chunk.join(" "));
  }
  // fold tiny fragments into the previous unit so no image flashes too briefly
  const out: string[] = [];
  for (const u of units) {
    if (out.length && u.split(/\s+/).filter(Boolean).length < 4) out[out.length - 1] += " " + u;
    else out.push(u);
  }
  return out;
}

export const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
