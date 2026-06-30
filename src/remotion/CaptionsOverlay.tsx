import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";

// Transparent overlay (no background) rendered to an alpha video, then composited over the
// stock-footage background by ffmpeg. Holds the title card, kinetic word-by-word captions,
// and the watermark — the visually engaging "edit" layer.
type CaptionWord = { text: string; start: number; end: number };
type Line = { start: number; end: number; words: CaptionWord[] };
export type OverlayProps = {
  fps: number; durationInFrames: number; narrationDurSec: number; fadeTailSec: number;
  lines: Line[]; title: string; channel: string; portrait?: boolean;
};

const ACCENT = "#ff5a3c";
const DIM = "rgba(255,255,255,0.45)";

export const CaptionsOverlay: React.FC<OverlayProps> = (props) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;
  const portrait = props.portrait ?? false;

  const titleOpacity = interpolate(t, [0.2, 0.9, 3.4, 4.2], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const titleScale = interpolate(t, [0.2, 0.9], [0.86, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.5)) });
  const line = props.lines.find((l) => t >= l.start && t <= l.end) ?? null;

  return (
    <AbsoluteFill>
      {/* bottom scrim so captions read over any footage */}
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0) 52%, rgba(0,0,0,0.58) 100%)" }} />

      {/* title card (first ~4s) */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: titleOpacity }}>
        <div style={{ transform: `scale(${titleScale})`, color: "#fff", fontSize: portrait ? 96 : 112, fontWeight: 900, fontFamily: "'Arial Black', Arial, sans-serif", textAlign: "center", lineHeight: 1.02, maxWidth: "88%", textShadow: "0 6px 32px rgba(0,0,0,0.75)", textTransform: "uppercase", letterSpacing: -1 }}>{props.title}</div>
      </AbsoluteFill>

      {/* word-by-word kinetic captions */}
      {line && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: portrait ? 430 : 96 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", gap: portrait ? "6px 16px" : "8px 22px", maxWidth: "86%", fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: portrait ? 72 : 66, lineHeight: 1.08, textTransform: "uppercase" }}>
            {line.words.map((w, k) => {
              const spoken = t >= w.start;
              const active = t >= w.start && t <= w.end;
              const pop = active
                ? interpolate(t, [w.start, w.start + 0.12], [0.78, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) })
                : 1;
              return (
                <span key={k} style={{ display: "inline-block", transform: `scale(${pop})`, color: active ? ACCENT : spoken ? "#fff" : DIM, textShadow: "0 3px 16px rgba(0,0,0,0.85)" }}>{w.text}</span>
              );
            })}
          </div>
        </AbsoluteFill>
      )}

      {/* watermark */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: 40 }}>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 30, fontWeight: 800, fontFamily: "Arial, sans-serif", textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>{props.channel}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
