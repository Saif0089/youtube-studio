import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig, staticFile, Easing } from "remotion";

type Word = { text: string; start: number; end: number };
type Line = { start: number; end: number; words: Word[] };
type Cue = { text: string; start: number; end: number };
type Seg = { start: number; end: number };
export type ExplainerProps = {
  fps: number;
  durationInFrames: number;
  narrationDurSec: number;
  fadeTailSec: number;
  audioSrc: string;
  musicSrc: string;
  segments?: Seg[];
  images: string[];
  captions: Cue[];
  lines: Line[];
  title: string;
  channel: string;
};

const BG = "#fbfbf7";
const INK = "#1a1a1a";
const ACCENT = "#ff5a3c";
const DIM = "#c4c4bd";

const PopImage: React.FC<{ src: string; dur: number; idx: number }> = ({ src, dur, idx }) => {
  const f = useCurrentFrame();
  // Ken Burns: slow zoom + drift. Scale stays >= 1.06 so the ±1.2% pan never exposes a frame edge.
  // Alternate zoom-in / zoom-out per image so consecutive shots don't feel identical.
  const zoomIn = idx % 2 === 0;
  const scale = interpolate(f, [0, dur], zoomIn ? [1.06, 1.13] : [1.13, 1.06], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  const panX = interpolate(f, [0, dur], idx % 2 === 0 ? [-1.2, 1.2] : [1.2, -1.2], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  // clamp the fade so [0, fade, dur-fade, dur] is ALWAYS strictly increasing (short segments crashed Remotion)
  const fade = Math.min(8, Math.floor(dur / 3));
  const opacity = fade >= 1 && dur - fade > fade
    ? interpolate(f, [0, fade, dur - fade, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  return (
    <AbsoluteFill style={{ opacity }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translateX(${panX}%)` }} />
    </AbsoluteFill>
  );
};

export const ExplainerVideo: React.FC<ExplainerProps> = (props) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;
  const n = props.images.length;
  const xfade = Math.round(0.3 * fps);
  // each image is timed to the sentence it illustrates (segments); fallback = even split
  const segs: Seg[] = props.segments && props.segments.length === n
    ? props.segments
    : props.images.map((_, i) => ({ start: (i * props.narrationDurSec) / n, end: ((i + 1) * props.narrationDurSec) / n }));

  const titleOpacity = interpolate(t, [0.3, 1.1, 3.6, 4.4], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const endStart = props.narrationDurSec - 0.2;
  const whiteOut = interpolate(t, [endStart, endStart + props.fadeTailSec], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const line = props.lines.find((l) => t >= l.start && t <= l.end) ?? null;

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      {props.images.map((src, i) => {
        const seg = segs[i];
        const start = Math.round(seg.start * fps);
        const from = i === 0 ? 0 : start;        // image appears AT its line's start (no pre-roll)
        const isLast = i === n - 1;
        const end = isLast ? props.durationInFrames : Math.round(seg.end * fps) + xfade; // hold a touch past for crossfade with the next
        const dur = Math.max(1, end - from);
        return (
          <Sequence key={i} from={Math.max(0, from)} durationInFrames={dur}>
            <PopImage src={src} dur={dur} idx={i} />
          </Sequence>
        );
      })}

      {/* title card */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: titleOpacity }}>
        <div style={{ color: INK, fontSize: 96, fontWeight: 800, fontFamily: "'Arial Black', Arial, sans-serif", textAlign: "center", lineHeight: 1.05, maxWidth: "82%", letterSpacing: -1, background: "rgba(251,251,247,0.82)", padding: "10px 30px", borderRadius: 18 }}>{props.title}</div>
      </AbsoluteFill>

      {/* word-by-word captions */}
      {line && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 84 }}>
          <div style={{ background: "rgba(255,255,255,0.92)", padding: "16px 36px", borderRadius: 16, maxWidth: "88%", boxShadow: "0 8px 26px rgba(0,0,0,0.12)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", gap: "6px 26px", fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 800, fontSize: 58, lineHeight: 1.18 }}>
              {line.words.map((w, k) => {
                const spoken = t >= w.start;
                const active = t >= w.start && t <= w.end;
                const color = active ? ACCENT : spoken ? INK : DIM;
                return (
                  <span key={k} style={{ color }}>{w.text}</span>
                );
              })}
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* watermark */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-start", padding: 44 }}>
        <div style={{ color: "rgba(0,0,0,0.30)", fontSize: 30, fontWeight: 800, fontFamily: "Arial, sans-serif" }}>{props.channel}</div>
      </AbsoluteFill>

      {/* end fade to white */}
      <AbsoluteFill style={{ backgroundColor: BG, opacity: whiteOut }} />

      <Audio src={staticFile(props.audioSrc)} />
      <Audio src={staticFile(props.musicSrc)} volume={0.22} />
    </AbsoluteFill>
  );
};
