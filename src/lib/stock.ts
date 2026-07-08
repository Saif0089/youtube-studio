export type Candidate = { id: string; url: string; src: "pexels" | "pixabay" };

export function parsePexels(json: any): Candidate[] {
  const photos = Array.isArray(json?.photos) ? json.photos : [];
  return photos
    .map((p: any) => ({ id: `px-${p.id}`, url: p?.src?.large2x || p?.src?.large || p?.src?.original, src: "pexels" as const }))
    .filter((c: Candidate) => !!c.url);
}

export function parsePixabay(json: any): Candidate[] {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return hits
    .map((h: any) => ({ id: `pb-${h.id}`, url: h?.largeImageURL || h?.webformatURL, src: "pixabay" as const }))
    .filter((c: Candidate) => !!c.url);
}

// Pick the first candidate whose id isn't excluded, rotating the start by seed for variety.
export function pickCandidate<T extends { id: string }>(cands: T[], exclude: Set<string>, seed: number): T | null {
  const n = cands.length;
  if (!n) return null;
  for (let k = 0; k < n; k++) {
    const c = cands[((seed % n) + k) % n];
    if (!exclude.has(c.id)) return c;
  }
  return null;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<any | null> {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function pexelsSearch(query: string): Promise<Candidate[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const orient = process.env.ORIENT === "portrait" ? "portrait" : "landscape";
  const u = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orient}&per_page=15&size=large`;
  const j = await fetchJson(u, { Authorization: key });
  return j ? parsePexels(j) : [];
}

async function pixabaySearch(query: string): Promise<Candidate[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const orient = process.env.ORIENT === "portrait" ? "vertical" : "horizontal";
  const u = `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&orientation=${orient}&per_page=15&safesearch=true`;
  const j = await fetchJson(u);
  return j ? parsePixabay(j) : [];
}

// Search Pexels then Pixabay; broaden the query once (first 2 words) if both are empty.
// Adds the chosen id to `exclude` (per-video dedup). Returns null only if truly nothing found.
export async function searchPhoto(query: string, exclude: Set<string>, seed: number): Promise<Candidate | null> {
  const broad = query.split(/\s+/).slice(0, 2).join(" ");
  const queries = broad && broad !== query ? [query, broad] : [query];
  for (const q of queries) {
    let pick = pickCandidate(await pexelsSearch(q), exclude, seed);
    if (pick) { exclude.add(pick.id); return pick; }
    pick = pickCandidate(await pixabaySearch(q), exclude, seed);
    if (pick) { exclude.add(pick.id); return pick; }
  }
  return null;
}

export async function downloadPhoto(c: Candidate): Promise<Buffer> {
  const r = await fetch(c.url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`download ${c.src} ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---- Stock VIDEO clips (same keys; Pexels + Pixabay video APIs) ----
export type VideoClip = { id: string; url: string; src: "pexels" | "pixabay"; duration: number; words: string[] };

// Choose the .mp4 whose long-axis size is closest to ~1280 (modest download, fine at 1080p output).
function pickPexelsFile(files: any[]): string | null {
  if (!Array.isArray(files) || !files.length) return null;
  const portrait = process.env.ORIENT === "portrait";
  const mp4 = files.filter((f) => String(f.file_type || "").includes("mp4") || /\.mp4(\?|$)/.test(String(f.link || "")));
  const pool = mp4.length ? mp4 : files;
  const dim = (f: any) => (portrait ? Number(f.height) || 0 : Number(f.width) || 0);
  const sorted = [...pool].sort((a, b) => Math.abs(dim(a) - 1280) - Math.abs(dim(b) - 1280));
  return sorted[0]?.link || null;
}

export function parsePexelsVideo(json: any): VideoClip[] {
  const vids = Array.isArray(json?.videos) ? json.videos : [];
  return vids
    .map((v: any) => {
      const url = pickPexelsFile(v.video_files);
      // the page URL slug describes the content: .../video/woman-counting-dollar-bills-123/
      const slug = String(v.url ?? "").split("/video/")[1] ?? "";
      const words = slug.replace(/-\d+\/?$/, "").split("-").filter(Boolean);
      return url ? { id: `pxv-${v.id}`, url, src: "pexels" as const, duration: Number(v.duration) || 0, words } : null;
    })
    .filter(Boolean) as VideoClip[];
}

export function parsePixabayVideo(json: any): VideoClip[] {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return hits
    .map((h: any) => {
      const v = h.videos || {};
      const f = v.medium || v.large || v.small || v.tiny;
      const words = String(h.tags ?? "").toLowerCase().split(/,\s*/).flatMap((t: string) => t.split(/\s+/)).filter(Boolean);
      return f?.url ? { id: `pbv-${h.id}`, url: f.url, src: "pixabay" as const, duration: Number(h.duration) || 0, words } : null;
    })
    .filter(Boolean) as VideoClip[];
}

// Score a clip's descriptive words against the search terms (light stemming: strip plural s).
// Generic verbs/fillers are excluded — "putting cash into pocket" must match on cash/pocket,
// not win via "putting" against an unrelated clip.
const STOP = new Set(["person", "people", "hand", "hands", "close", "closeup", "video", "footage",
  "putting", "using", "holding", "into", "with", "from", "onto", "over", "young", "man", "woman"]);
const stem = (w: string) => w.toLowerCase().replace(/s$/, "");
export function scoreClip(clip: VideoClip, terms: string[]): number {
  const bag = new Set(clip.words.map(stem));
  let s = 0;
  for (const t of terms) {
    const st = stem(t);
    if (st.length < 3 || STOP.has(t.toLowerCase()) || STOP.has(st)) continue;
    if (bag.has(st)) s += 2;
    else if (clip.words.some((w) => w.toLowerCase().includes(st))) s += 1;
  }
  if (clip.duration >= 6 && clip.duration <= 45) s += 0.5;  // loopable length bonus
  return s;
}

async function pexelsVideoSearch(query: string): Promise<VideoClip[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const orient = process.env.ORIENT === "portrait" ? "portrait" : "landscape";
  const u = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orient}&per_page=20`;
  const j = await fetchJson(u, { Authorization: key });
  return j ? parsePexelsVideo(j) : [];
}

async function pixabayVideoSearch(query: string): Promise<VideoClip[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const u = `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query)}&per_page=20&safesearch=true`;
  const j = await fetchJson(u);
  return j ? parsePixabayVideo(j) : [];
}

// Search Pexels then Pixabay for a clip; broaden the query once if both empty. Dedups via `exclude`.
export async function searchVideo(query: string, exclude: Set<string>, seed: number): Promise<VideoClip | null> {
  const broad = query.split(/\s+/).slice(0, 2).join(" ");
  const queries = broad && broad !== query ? [query, broad] : [query];
  for (const q of queries) {
    let pick = pickCandidate(await pexelsVideoSearch(q), exclude, seed);
    if (pick) { exclude.add(pick.id); return pick; }
    pick = pickCandidate(await pixabayVideoSearch(q), exclude, seed);
    if (pick) { exclude.add(pick.id); return pick; }
  }
  return null;
}

// RELEVANCE-SCORED search: tries candidate queries in order, pools Pexels+Pixabay results,
// and returns the clip whose own description best matches the query terms — instead of a
// pseudo-random top hit. Falls back to the unscored search if nothing scores.
export async function searchVideoScored(queries: string[], exclude: Set<string>): Promise<{ clip: VideoClip; score: number; query: string } | null> {
  for (const q of queries) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = [...await pexelsVideoSearch(q), ...await pixabayVideoSearch(q)].filter((c) => !exclude.has(c.id));
    if (!pool.length) continue;
    const ranked = pool
      .map((clip) => ({ clip, score: scoreClip(clip, terms), query: q }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (best && best.score >= 2) {   // at least one strong term match
      exclude.add(best.clip.id);
      return best;
    }
  }
  // nothing matched well — take anything the plain search finds
  const fallback = await searchVideo(queries[0], exclude, 0);
  return fallback ? { clip: fallback, score: 0, query: queries[0] } : null;
}

export async function downloadVideo(c: VideoClip): Promise<Buffer> {
  const r = await fetch(c.url, { signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`download ${c.src} ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
