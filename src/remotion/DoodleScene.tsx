import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";

// Renders a Claude-authored SVG doodle full-frame and animates tagged elements
// FRAME-ACCURATELY (Remotion drives the values, so motion stays in sync with the render —
// unlike CSS @keyframes, which run on wall-clock and break in headless renders).
//
// Convention the SVG author (Claude) uses — put these classes on <g>/<path>/<polygon>:
//   anim-spin  -> spins around its own centre   (wheels, gears, suns, coins)
//   anim-bob   -> gentle up/down bob            (characters, heads)
//   anim-float -> slow floaty drift up/down     (money, balloons, bubbles)
//   anim-sway  -> small rocking rotation        (trees, signs, arms)
export const DoodleScene: React.FC<{ svg: string; spinRps?: number }> = ({ svg, spinRps = 0.5 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const spin = (t * spinRps * 360) % 360;
  const bob = Math.sin(t * Math.PI * 2 * 0.8) * 7;
  const float = Math.sin(t * Math.PI * 2 * 0.45) * 12;
  const sway = Math.sin(t * Math.PI * 2 * 0.4) * 3;

  // scene entrance: subtle pop + fade so each scene "arrives" rather than cutting in flat
  const enter = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.ease) });
  const scaleIn = interpolate(frame, [0, 14], [0.95, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  const css = `
    .doodle-host svg { width: 100%; height: 100%; display: block; }
    .doodle-host .anim-spin  { transform-box: fill-box; transform-origin: center; transform: rotate(${spin}deg); }
    .doodle-host .anim-bob   { transform-box: fill-box; transform-origin: center; transform: translateY(${bob}px); }
    .doodle-host .anim-float { transform-box: fill-box; transform-origin: center; transform: translateY(${float}px); }
    .doodle-host .anim-sway  { transform-box: fill-box; transform-origin: bottom center; transform: rotate(${sway}deg); }
  `;

  return (
    <AbsoluteFill style={{ opacity: enter, transform: `scale(${scaleIn})` }}>
      <style>{css}</style>
      <div className="doodle-host" style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />
    </AbsoluteFill>
  );
};
