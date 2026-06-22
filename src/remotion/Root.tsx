import React from "react";
import { Composition } from "remotion";
import { StoryVideo, StoryProps } from "./StoryVideo";
import { ExplainerVideo, ExplainerProps } from "./ExplainerVideo";
import defaultProps from "../../out/props.json";

const meta = (p: { durationInFrames: number; fps: number }) => ({ durationInFrames: p.durationInFrames, fps: p.fps });

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ExplainerVideo"
        component={ExplainerVideo as React.FC<Record<string, unknown>>}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={(defaultProps as unknown as ExplainerProps).durationInFrames}
        defaultProps={defaultProps as unknown as ExplainerProps}
        calculateMetadata={({ props }) => meta(props as unknown as ExplainerProps)}
      />
      <Composition
        id="StoryVideo"
        component={StoryVideo as React.FC<Record<string, unknown>>}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={(defaultProps as unknown as StoryProps).durationInFrames}
        defaultProps={defaultProps as unknown as StoryProps}
        calculateMetadata={({ props }) => meta(props as unknown as StoryProps)}
      />
    </>
  );
};
