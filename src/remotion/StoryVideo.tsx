import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig, staticFile, Easing } from "remotion";

type Cue = { text: string; start: number; end: number };
export type StoryProps = {
  fps: number;
  durationInFrames: number;
  narrationDurSec: number;
  fadeTailSec: number;
  audioSrc: string;
  musicSrc: string;
  images: string[];
  captions: Cue[];
  title: string;
  channel: string;
};

const CrossfadeWrap: React.FC<{ xfade: number; dur: number; children: React.ReactNode }> = ({ xfade, dur, children }) => {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, xfade, dur - xfade, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const KenBurns: React.FC<{ src: string; index: number; dur: number }> = ({ src, index, dur }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, dur], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  const dir = index % 4;
  let scale = 1.1, tx = 0, ty = 0;
  if (dir === 0) scale = interpolate(p, [0, 1], [1.04, 1.20]);
  else if (dir === 1) { scale = 1.16; tx = interpolate(p, [0, 1], [-3.5, 3.5]); }
  else if (dir === 2) { scale = 1.16; tx = interpolate(p, [0, 1], [3.5, -3.5]); }
  else { scale = interpolate(p, [0, 1], [1.20, 1.06]); ty = interpolate(p, [0, 1], [-3, 3]); }
  return (
    <AbsoluteFill>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translate(${tx}%, ${ty}%)` }} />
    </AbsoluteFill>
  );
};

export const StoryVideo: React.FC<StoryProps> = (props) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const t = frame / fps;
  const n = props.images.length;
  const imgDurSec = props.narrationDurSec / n;
  const imgDurFrames = Math.round(imgDurSec * fps);
  const xfade = Math.round(0.8 * fps);

  const cue = props.captions.find((c) => t >= c.start && t < c.end);
  const titleOpacity = interpolate(t, [0.4, 1.3, 4.0, 4.8], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const endStart = props.narrationDurSec - 0.3;
  const blackOpacity = interpolate(t, [endStart, endStart + props.fadeTailSec], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let capOpacity = 0;
  if (cue) capOpacity = interpolate(t, [cue.start, cue.start + 0.18, cue.end - 0.12, cue.end], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {props.images.map((src, i) => {
        const start = Math.round(i * imgDurSec * fps);
        const from = i === 0 ? 0 : start - xfade;
        const isLast = i === n - 1;
        const end = isLast ? props.durationInFrames : start + imgDurFrames + xfade;
        const dur = end - from;
        return (
          <Sequence key={i} from={Math.max(0, from)} durationInFrames={dur}>
            <CrossfadeWrap xfade={xfade} dur={dur}>
              <KenBurns src={src} index={i} dur={dur} />
            </CrossfadeWrap>
          </Sequence>
        );
      })}

      {/* vignette */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,0.6) 100%)" }} />

      {/* title sequence */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: titleOpacity }}>
        <div style={{ background: "rgba(0,0,0,0.40)", padding: "28px 50px", borderRadius: 10, maxWidth: "72%" }}>
          <div style={{ color: "#fff", fontSize: 86, fontWeight: 800, fontFamily: "Georgia, 'Times New Roman', serif", textAlign: "center", lineHeight: 1.08, textShadow: "0 6px 28px rgba(0,0,0,0.7)" }}>{props.title}</div>
        </div>
      </AbsoluteFill>

      {/* synced captions */}
      {cue && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 110 }}>
          <div style={{ opacity: capOpacity, background: "rgba(0,0,0,0.55)", padding: "14px 28px", borderRadius: 8, maxWidth: "82%" }}>
            <div style={{ color: "#fff", fontSize: 48, fontWeight: 600, fontFamily: "Arial, Helvetica, sans-serif", textAlign: "center", lineHeight: 1.25, textShadow: "0 2px 10px rgba(0,0,0,0.85)" }}>{cue.text}</div>
          </div>
        </AbsoluteFill>
      )}

      {/* watermark */}
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-start", padding: 40 }}>
        <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 30, fontWeight: 700, fontFamily: "Arial, sans-serif", textShadow: "0 2px 6px rgba(0,0,0,0.7)" }}>{props.channel}</div>
      </AbsoluteFill>

      {/* end fade to black */}
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: blackOpacity }} />

      <Audio src={staticFile(props.audioSrc)} />
      <Audio src={staticFile(props.musicSrc)} volume={0.33} />
    </AbsoluteFill>
  );
};
