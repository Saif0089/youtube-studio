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
export type VideoClip = { id: string; url: string; src: "pexels" | "pixabay"; duration: number };

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
      return url ? { id: `pxv-${v.id}`, url, src: "pexels" as const, duration: Number(v.duration) || 0 } : null;
    })
    .filter(Boolean) as VideoClip[];
}

export function parsePixabayVideo(json: any): VideoClip[] {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return hits
    .map((h: any) => {
      const v = h.videos || {};
      const f = v.medium || v.large || v.small || v.tiny;
      return f?.url ? { id: `pbv-${h.id}`, url: f.url, src: "pixabay" as const, duration: Number(h.duration) || 0 } : null;
    })
    .filter(Boolean) as VideoClip[];
}

async function pexelsVideoSearch(query: string): Promise<VideoClip[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  const orient = process.env.ORIENT === "portrait" ? "portrait" : "landscape";
  const u = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orient}&per_page=12`;
  const j = await fetchJson(u, { Authorization: key });
  return j ? parsePexelsVideo(j) : [];
}

async function pixabayVideoSearch(query: string): Promise<VideoClip[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const u = `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query)}&per_page=12&safesearch=true`;
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

export async function downloadVideo(c: VideoClip): Promise<Buffer> {
  const r = await fetch(c.url, { signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`download ${c.src} ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
