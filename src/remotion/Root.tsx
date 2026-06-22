import React from "react";
import { Composition } from "remotion";
import { StoryVideo, StoryProps } from "./StoryVideo";
import defaultProps from "../../out/props.json";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="StoryVideo"
      component={StoryVideo as React.FC<Record<string, unknown>>}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={(defaultProps as unknown as StoryProps).durationInFrames}
      defaultProps={defaultProps as unknown as StoryProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: (props as unknown as StoryProps).durationInFrames,
        fps: (props as unknown as StoryProps).fps,
      })}
    />
  );
};
