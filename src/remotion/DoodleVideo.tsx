import React from "react";
import { AbsoluteFill, Audio, Sequence, useVideoConfig, useCurrentFrame, staticFile, interpolate } from "remotion";
import { DoodleScene } from "./DoodleScene";

const BG = "#fffdf8";
const INK = "#1a1a1a";
const ACCENT = "#ff5a3c";
const DIM = "#c4c4bd";

type Word = { text: string; start: number; end: number };
type Line = { start: number; end: number; words: Word[] };
type Scene = { svg: string; start: number; end: number };

export type DoodleProps = {
  fps: number;
  durationInFrames: number;
  narrationDurSec: number;
  fadeTailSec: number;
  audioSrc: string;
  musicSrc?: string;
  scenes: Scene[];
  lines: Line[];
  title: string;
  channel: string;
  portrait?: boolean;
};

export const DoodleVideo: React.FC<DoodleProps> = (props) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;
  const portrait = props.portrait ?? true;

  const line = props.lines.find((l) => t >= l.start && t <= l.end) ?? null;
  const endStart = props.narrationDurSec - 0.2;
  const whiteOut = interpolate(t, [endStart, endStart + props.fadeTailSec], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // Shorts keep the title up the whole time; long videos show it as a title card that fades.
  const titleOpacity = portrait ? 1 : interpolate(t, [0.3, 1.1, 3.6, 4.4], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      {/* animated doodle scenes, each timed to the narration */}
      {props.scenes.map((s, i) => {
        const from = Math.round(s.start * fps);
        const isLast = i === props.scenes.length - 1;
        const end = isLast ? props.durationInFrames : Math.round(s.end * fps);
        const dur = Math.max(1, end - from);
        return (
          <Sequence key={i} from={Math.max(0, from)} durationInFrames={dur}>
            <DoodleScene svg={s.svg} />
          </Sequence>
        );
      })}

      {/* on-screen title (persistent on Shorts, fading title card on long videos) */}
      <AbsoluteFill style={{ justifyContent: portrait ? "flex-start" : "center", alignItems: "center", paddingTop: portrait ? 130 : 0, opacity: titleOpacity }}>
        <div style={{ color: INK, fontSize: portrait ? 78 : 92, fontWeight: 900, fontFamily: "'Arial Black', Arial, sans-serif", textAlign: "center", maxWidth: "88%", lineHeight: 1.02, background: portrait ? "none" : "rgba(251,251,247,0.82)", padding: portrait ? 0 : "12px 32px", borderRadius: 18, textShadow: "0 2px 0 rgba(255,255,255,0.9)" }}>{props.title}</div>
      </AbsoluteFill>

      {/* word-by-word captions */}
      {line && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: portrait ? 560 : 90 }}>
          <div style={{ background: "rgba(255,255,255,0.92)", padding: "16px 32px", borderRadius: 18, maxWidth: "90%", boxShadow: "0 8px 26px rgba(0,0,0,0.12)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", gap: "6px 20px", fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 800, fontSize: portrait ? 64 : 54, lineHeight: 1.15 }}>
              {line.words.map((w, k) => {
                const spoken = t >= w.start;
                const active = t >= w.start && t <= w.end;
                return <span key={k} style={{ color: active ? ACCENT : spoken ? INK : DIM }}>{w.text}</span>;
              })}
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* watermark */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: 36 }}>
        <div style={{ color: "rgba(0,0,0,0.28)", fontSize: 30, fontWeight: 800, fontFamily: "Arial, sans-serif" }}>{props.channel}</div>
      </AbsoluteFill>

      <AbsoluteFill style={{ backgroundColor: BG, opacity: whiteOut }} />

      <Audio src={staticFile(props.audioSrc)} />
      {props.musicSrc ? <Audio src={staticFile(props.musicSrc)} volume={0.18} /> : null}
    </AbsoluteFill>
  );
};
