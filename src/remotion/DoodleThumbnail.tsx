import React from "react";
import { AbsoluteFill } from "remotion";

type Scene = { svg: string; start: number; end: number };
type Props = { scenes: Scene[]; title: string };

// 1280x720 thumbnail: a doodle scene full-bleed, darkened toward the bottom, with a big bold title + brand badge.
export const DoodleThumbnail: React.FC<Props> = ({ scenes, title }) => {
  const idx = Math.min(1, Math.max(0, (scenes?.length ?? 1) - 1)); // 2nd scene if available (usually a clear hero)
  const hero = scenes?.[idx]?.svg || scenes?.[0]?.svg || "";
  return (
    <AbsoluteFill style={{ backgroundColor: "#fffdf8" }}>
      <div className="doodle-host" style={{ width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: hero }} />
      <style>{`.doodle-host svg { width: 100%; height: 100%; display: block; }`}</style>
      <AbsoluteFill style={{ background: "linear-gradient(0deg, rgba(8,12,30,0.93) 4%, rgba(8,12,30,0.5) 30%, rgba(8,12,30,0) 58%)" }} />
      <AbsoluteFill style={{ justifyContent: "flex-end", padding: 60 }}>
        <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 120, lineHeight: 0.94, color: "#fff", textShadow: "0 6px 26px rgba(0,0,0,0.85)", maxWidth: "94%", textTransform: "uppercase", letterSpacing: -2 }}>
          {title}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: 38 }}>
        <div style={{ background: "#ff5a3c", color: "#fff", fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 30, padding: "8px 18px", borderRadius: 10 }}>InfotainmentStu</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
