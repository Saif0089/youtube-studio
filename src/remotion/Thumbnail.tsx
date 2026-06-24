import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

type ThumbProps = { images: string[]; title: string };

// 1280x720 YouTube thumbnail: a hero doodle full-bleed, darkened toward the bottom,
// with a huge bold title and a brand badge. Rendered as a single still on upload.
export const Thumbnail: React.FC<ThumbProps> = ({ images, title }) => {
  const hero = images[Math.min(images.length - 1, Math.max(0, Math.floor(images.length * 0.15)))] || images[0];
  return (
    <AbsoluteFill style={{ backgroundColor: "#0c1330" }}>
      <Img src={staticFile(hero)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <AbsoluteFill style={{ background: "linear-gradient(0deg, rgba(8,12,30,0.95) 4%, rgba(8,12,30,0.55) 34%, rgba(8,12,30,0) 62%)" }} />
      <AbsoluteFill style={{ justifyContent: "flex-end", padding: 64 }}>
        <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 132, lineHeight: 0.92, color: "#fff", textShadow: "0 6px 26px rgba(0,0,0,0.85)", maxWidth: "92%", textTransform: "uppercase", letterSpacing: -2 }}>
          {title}
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: 40 }}>
        <div style={{ background: "#ff5a3c", color: "#fff", fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: 30, padding: "8px 18px", borderRadius: 10 }}>
          InfotainmentStu
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
