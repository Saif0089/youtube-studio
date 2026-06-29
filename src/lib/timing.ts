export type Word = { w: string; start: number; end: number };
export type Seg = { start: number; end: number };
export type CaptionWord = { text: string; start: number; end: number };
export type Line = { start: number; end: number; words: CaptionWord[] };

// Assign a time segment to each ordered unit by walking the spoken-word stream:
// unit k starts at the spoken time of its first word; ends at unit k+1's start
// (last unit ends at narrationDur). unitWordCounts[k] = number of words in unit k.
export function alignByWordCount(unitWordCounts: number[], words: Word[], narrationDur: number): Seg[] {
  if (!words.length) return unitWordCounts.map(() => ({ start: 0, end: narrationDur }));
  const startIdx: number[] = [];
  let wi = 0;
  for (const c of unitWordCounts) { startIdx.push(Math.min(wi, words.length - 1)); wi += c; }
  return unitWordCounts.map((_, k) => {
    const start = words[startIdx[k]].start;
    const end = k < unitWordCounts.length - 1 ? words[startIdx[k + 1]].start : narrationDur;
    return { start, end: Math.max(end, start) };
  });
}

// Group words into caption lines: flush at maxWords or sentence-ending punctuation.
export function buildCaptionLines(words: Word[], maxWords: number): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) {
      lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur.map((x) => ({ text: x.w, start: x.start, end: x.end })) });
      cur = [];
    }
  };
  for (const wd of words) { cur.push(wd); if (cur.length >= maxWords || /[.!?]$/.test(wd.w)) flush(); }
  flush();
  return lines;
}
