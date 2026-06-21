export function chunkText(text: string, maxChars = 2500): string[] {
  const pieces = text
    .split(/\n{2,}/) // paragraphs
    .flatMap((p) => p.match(/[^.!?]+[.!?]*\s*/g) ?? [p]) // sentences
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ""; };

  for (const piece of pieces) {
    if (piece.length > maxChars) { // hard-wrap an over-long sentence by words
      push();
      let line = "";
      for (const word of piece.split(/\s+/)) {
        if ((line + " " + word).trim().length > maxChars) { if (line) chunks.push(line.trim()); line = word; }
        else line = (line + " " + word).trim();
      }
      if (line) chunks.push(line.trim());
      continue;
    }
    if ((cur + " " + piece).trim().length > maxChars) push();
    cur = (cur + " " + piece).trim();
  }
  push();
  return chunks;
}
