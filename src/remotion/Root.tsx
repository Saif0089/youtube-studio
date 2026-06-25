import React from "react";
import { Composition } from "remotion";
import { StoryVideo, StoryProps } from "./StoryVideo";
import { ExplainerVideo, ExplainerProps } from "./ExplainerVideo";
import { ShortVideo, ShortProps } from "./ShortVideo";
import { Thumbnail } from "./Thumbnail";
import { DoodleVideo, DoodleProps } from "./DoodleVideo";
import { DoodleThumbnail } from "./DoodleThumbnail";
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
      <Composition
        id="ShortVideo"
        component={ShortVideo as React.FC<Record<string, unknown>>}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={(defaultProps as unknown as ShortProps).durationInFrames}
        defaultProps={defaultProps as unknown as ShortProps}
        calculateMetadata={({ props }) => meta(props as unknown as ShortProps)}
      />
      <Composition
        id="Thumbnail"
        component={Thumbnail as React.FC<Record<string, unknown>>}
        width={1280}
        height={720}
        fps={30}
        durationInFrames={1}
        defaultProps={defaultProps as unknown as { images: string[]; title: string }}
      />
      <Composition
        id="DoodleShort"
        component={DoodleVideo as React.FC<Record<string, unknown>>}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={(defaultProps as unknown as { durationInFrames?: number }).durationInFrames ?? 1350}
        defaultProps={defaultProps as unknown as DoodleProps}
        calculateMetadata={({ props }) => meta(props as unknown as DoodleProps)}
      />
      <Composition
        id="DoodleLong"
        component={DoodleVideo as React.FC<Record<string, unknown>>}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={(defaultProps as unknown as { durationInFrames?: number }).durationInFrames ?? 3600}
        defaultProps={defaultProps as unknown as DoodleProps}
        calculateMetadata={({ props }) => meta(props as unknown as DoodleProps)}
      />
      <Composition
        id="DoodleThumbnail"
        component={DoodleThumbnail as React.FC<Record<string, unknown>>}
        width={1280}
        height={720}
        fps={30}
        durationInFrames={1}
        defaultProps={defaultProps as unknown as { scenes: { svg: string; start: number; end: number }[]; title: string }}
      />
    </>
  );
};
