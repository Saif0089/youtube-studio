import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig, staticFile, Easing } from "remotion";
import { presetParts } from "./doodlePresets";

type CaptionWord = { text: string; start: number; end: number };
type Line = { start: number; end: number; words: CaptionWord[] };
type Seg = { start: number; end: number };
type Doodle = { svg: string; preset: string; start: number; end: number };

export type HostProps = {
  fps: number; durationInFrames: number; narrationDurSec: number; fadeTailSec: number;
  audioSrc: string; musicSrc?: string;
  images: string[]; segments: Seg[]; doodles: Doodle[]; lines: Line[];
  title: string; channel: string; portrait?: boolean;
};

const ACCENT = "#ff5a3c";
const DIM = "#e9e9e2";
const END = "#0e0e0e";

// Background photo with a slow Ken Burns move, timed to its sentence.
const BgImage: React.FC<{ src: string; dur: number; idx: number }> = ({ src, dur, idx }) => {
  const f = useCurrentFrame();
  const zoomIn = idx % 2 === 0;
  const scale = interpolate(f, [0, dur], zoomIn ? [1.06, 1.14] : [1.14, 1.06], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  const panX = interpolate(f, [0, dur], idx % 2 === 0 ? [-1.2, 1.2] : [1.2, -1.2], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
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

// Joint pivots for each rigged part (relative to the part's own bounding box).
const PART_SEL: Record<string, string> = { head: ".d-head", armL: ".d-arm-l", armR: ".d-arm-r", legL: ".d-leg-l", legR: ".d-leg-r" };
const PART_ORIGIN: Record<string, string> = { head: "50% 100%", armL: "50% 0%", armR: "50% 0%", legL: "50% 0%", legR: "50% 0%" };

// Doodle host: hand-draws itself on (left->right wipe + pop), then performs its action via a
// reusable preset that animates the tagged parts. Each instance's CSS is scoped by index.
const DoodleHost: React.FC<{ svg: string; preset: string; dur: number; portrait: boolean; idx: number }> = ({ svg, preset, dur, portrait, idx }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const revealFrames = Math.min(Math.round(0.5 * fps), Math.max(1, Math.floor(dur / 2)));
  const reveal = interpolate(f, [0, revealFrames], [100, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }); // % clipped from right
  const pop = interpolate(f, [0, revealFrames], [0.94, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.4)) });
  const t = Math.max(0, (f - revealFrames) / fps);
  const parts = presetParts(preset, t);
  const cls = `dh-${idx}`;
  const partCss = (Object.keys(PART_SEL) as (keyof typeof PART_SEL & string)[])
    .filter((k) => (parts as Record<string, string | undefined>)[k])
    .map((k) => `.${cls} ${PART_SEL[k]}{transform-box:fill-box;transform-origin:${PART_ORIGIN[k]};transform:${(parts as Record<string, string>)[k]}}`)
    .join("");
  const size = portrait ? "64%" : "34%";
  const rig = parts.rig ? `${parts.rig} scale(${pop})` : `scale(${pop})`;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: portrait ? 40 : 64, paddingBottom: portrait ? 540 : 150 }}>
      <style>{`.${cls} svg{width:100%;height:100%;display:block;overflow:visible}${partCss}`}</style>
      <div style={{ width: size, aspectRatio: "1 / 1", background: "rgba(255,253,248,0.86)", borderRadius: 28, boxShadow: "0 10px 30px rgba(0,0,0,0.22)", padding: 18 }}>
        <div className={cls} style={{ width: "100%", height: "100%", clipPath: `inset(0 ${reveal}% 0 0)`, transform: rig, transformOrigin: "50% 100%" }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </AbsoluteFill>
  );
};

export const HostVideo: React.FC<HostProps> = (props) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;
  const portrait = props.portrait ?? false;
  const n = props.images.length;
  const xfade = Math.round(0.3 * fps);

  const segs: Seg[] = props.segments && props.segments.length === n
    ? props.segments
    : props.images.map((_, i) => ({ start: (i * props.narrationDurSec) / n, end: ((i + 1) * props.narrationDurSec) / n }));

  const titleOpacity = portrait ? 1 : interpolate(t, [0.3, 1.1, 3.8, 4.6], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const endStart = props.narrationDurSec - 0.2;
  const whiteOut = interpolate(t, [endStart, endStart + props.fadeTailSec], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const line = props.lines.find((l) => t >= l.start && t <= l.end) ?? null;

  return (
    <AbsoluteFill style={{ backgroundColor: END }}>
      {/* per-sentence background photos */}
      {props.images.map((src, i) => {
        const seg = segs[i];
        const start = Math.round(seg.start * fps);
        const from = i === 0 ? 0 : start;
        const isLast = i === n - 1;
        const end = isLast ? props.durationInFrames : Math.round(seg.end * fps) + xfade;
        const dur = Math.max(1, end - from);
        return (
          <Sequence key={`bg-${i}`} from={Math.max(0, from)} durationInFrames={dur}>
            <BgImage src={src} dur={dur} idx={i} />
          </Sequence>
        );
      })}

      {/* legibility scrim */}
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.20) 62%, rgba(0,0,0,0.52) 100%)" }} />

      {/* doodle host — one per sentence, changes with each photo, performs its action */}
      {props.doodles.map((d, i) => {
        const from = Math.round(d.start * fps);
        const isLast = i === props.doodles.length - 1;
        const end = isLast ? props.durationInFrames : Math.round(d.end * fps);
        const dur = Math.max(1, end - from);
        return (
          <Sequence key={`dh-${i}`} from={Math.max(0, from)} durationInFrames={dur}>
            <DoodleHost svg={d.svg} preset={d.preset} dur={dur} portrait={portrait} idx={i} />
          </Sequence>
        );
      })}

      {/* title card */}
      <AbsoluteFill style={{ justifyContent: portrait ? "flex-start" : "center", alignItems: "center", paddingTop: portrait ? 120 : 0, opacity: titleOpacity }}>
        <div style={{ color: "#fff", fontSize: portrait ? 80 : 96, fontWeight: 900, fontFamily: "'Arial Black', Arial, sans-serif", textAlign: "center", lineHeight: 1.04, maxWidth: "86%", textShadow: "0 4px 24px rgba(0,0,0,0.6)", padding: "10px 30px" }}>{props.title}</div>
      </AbsoluteFill>

      {/* word-by-word captions */}
      {line && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: portrait ? 360 : 70 }}>
          <div style={{ background: "rgba(0,0,0,0.55)", padding: "16px 34px", borderRadius: 16, maxWidth: "90%" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "baseline", gap: "6px 22px", fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 800, fontSize: portrait ? 60 : 52, lineHeight: 1.15 }}>
              {line.words.map((w, k) => {
                const spoken = t >= w.start;
                const active = t >= w.start && t <= w.end;
                return <span key={k} style={{ color: active ? ACCENT : spoken ? "#fff" : DIM }}>{w.text}</span>;
              })}
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* watermark */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: 36 }}>
        <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 30, fontWeight: 800, fontFamily: "Arial, sans-serif", textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>{props.channel}</div>
      </AbsoluteFill>

      {/* end fade */}
      <AbsoluteFill style={{ backgroundColor: END, opacity: whiteOut }} />

      <Audio src={staticFile(props.audioSrc)} />
      {props.musicSrc ? <Audio src={staticFile(props.musicSrc)} volume={0.18} /> : null}
    </AbsoluteFill>
  );
};
