import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig, staticFile, Easing } from "remotion";

type Word = { text: string; start: number; end: number };
type Line = { start: number; end: number; words: Word[] };
type Seg = { start: number; end: number };
export type ShortProps = {
  fps: number;
  durationInFrames: number;
  narrationDurSec: number;
  fadeTailSec: number;
  audioSrc: string;
  musicSrc: string;
  segments?: Seg[];
  images: string[];
  lines: Line[];
  title: string;
  channel: string;
};

const BG = "#fbfbf7";
const INK = "#1a1a1a";
const ACCENT = "#ff5a3c";
const DIM = "#c4c4bd";

const PopImage: React.FC<{ src: string; dur: number }> = ({ src, dur }) => {
  const f = useCurrentFrame();
  const scale = interpolate(f, [0, dur], [1.0, 1.07], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  const opacity = interpolate(f, [0, 7, dur - 7, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} />
    </AbsoluteFill>
  );
};

export const ShortVideo: React.FC<ShortProps> = (props) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;
  const n = props.images.length;
  const xfade = Math.round(0.25 * fps);
  const segs: Seg[] = props.segments && props.segments.length === n
    ? props.segments
    : props.images.map((_, i) => ({ start: (i * props.narrationDurSec) / n, end: ((i + 1) * props.narrationDurSec) / n }));

  const titleOpacity = interpolate(t, [0.2, 0.9, 2.6, 3.3], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const endStart = props.narrationDurSec - 0.2;
  const whiteOut = interpolate(t, [endStart, endStart + props.fadeTailSec], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const line = props.lines.find((l) => t >= l.start && t <= l.end) ?? null;

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      {props.images.map((src, i) => {
        const seg = segs[i];
        const start = Math.round(seg.start * fps);
        const from = i === 0 ? 0 : start;
        const isLast = i === n - 1;
        const end = isLast ? props.durationInFrames : Math.round(seg.end * fps) + xfade;
        const dur = Math.max(1, end - from);
        return (
          <Sequence key={i} from={Math.max(0, from)} durationInFrames={dur}>
            <PopImage src={src} dur={dur} />
          </Sequence>
        );
      })}

      {/* title at top */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 180, opacity: titleOpacity }}>
        <div style={{ color: INK, fontSize: 96, fontWeight: 800, fontFamily: "'Arial Black', Arial, sans-serif", textAlign: "center", lineHeight: 1.05, maxWidth: "86%", background: "rgba(251,251,247,0.85)", padding: "14px 28px", borderRadius: 18 }}>{props.title}</div>
      </AbsoluteFill>

      {/* word-by-word captions, raised above the Shorts UI */}
      {line && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 560 }}>
          <div style={{ background: "rgba(255,255,255,0.92)", padding: "18px 30px", borderRadius: 18, maxWidth: "92%", boxShadow: "0 8px 26px rgba(0,0,0,0.14)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", gap: "6px 22px", fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 800, fontSize: 72, lineHeight: 1.16 }}>
              {line.words.map((w, k) => {
                const spoken = t >= w.start;
                const active = t >= w.start && t <= w.end;
                return <span key={k} style={{ color: active ? ACCENT : spoken ? INK : DIM }}>{w.text}</span>;
              })}
            </div>
          </div>
        </AbsoluteFill>
      )}

      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-start", padding: 44 }}>
        <div style={{ color: "rgba(0,0,0,0.32)", fontSize: 34, fontWeight: 800, fontFamily: "Arial, sans-serif" }}>{props.channel}</div>
      </AbsoluteFill>

      <AbsoluteFill style={{ backgroundColor: BG, opacity: whiteOut }} />
      <Audio src={staticFile(props.audioSrc)} />
      <Audio src={staticFile(props.musicSrc)} volume={0.22} />
    </AbsoluteFill>
  );
};
