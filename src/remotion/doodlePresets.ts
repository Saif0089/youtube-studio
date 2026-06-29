// Reusable doodle animation presets. Each preset is a "motion flavor" layered on top of a
// doodle that is ALREADY drawn performing its action — the drawn pose carries the meaning,
// the preset brings it to life. Motions are deliberately MODEST + smooth (single low frequency,
// few parts) so they never read as the old "everything shaking" jitter.
//
// A rigged doodle SVG tags movable parts with these classes (see gen-doodle-long.ts):
//   .rig (whole character) .d-head .d-arm-l .d-arm-r .d-leg-l .d-leg-r .d-body .d-prop
// The renderer (HostVideo/DoodleHost) applies `rig` to the doodle wrapper and the rest to the
// matching groups, with sensible transform-origins (arms/legs pivot at the joint, head at neck).

export type Parts = { rig?: string; head?: string; armL?: string; armR?: string; legL?: string; legR?: string };
export type PresetFn = (t: number) => Parts; // t = seconds since the doodle finished drawing on

export const PRESET_NAMES = [
  "idle", "bob", "sway", "wave", "gesture", "walk",
  "bounce", "nod", "shake", "point", "think", "cheer", "worry", "toss",
  "run", "jump", "shrug", "clap", "dance", "facepalm", "look", "reach", "stretch", "count",
] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

const TAU = Math.PI * 2;
const s = (t: number, hz: number) => Math.sin(t * TAU * hz);
const up = (t: number, hz: number) => Math.abs(Math.sin(t * TAU * hz)); // 0..1 hop
const half = (t: number, hz: number) => (s(t, hz) + 1) / 2;           // 0..1 ease

export const PRESETS: Record<PresetName, PresetFn> = {
  idle:    (t) => ({ rig: `scale(${1 + 0.010 * s(t, 0.45)})`, armL: `rotate(${3 * s(t, 0.45)}deg)`, armR: `rotate(${-3 * s(t, 0.45)}deg)`, head: `translateY(${1.5 * s(t, 0.45)}px)` }),
  bob:     (t) => ({ rig: `translateY(${4 * s(t, 0.6)}px)`, head: `rotate(${2 * s(t, 0.6)}deg)` }),
  sway:    (t) => ({ rig: `rotate(${2.5 * s(t, 0.5)}deg)`, armL: `rotate(${5 * s(t, 0.5)}deg)`, armR: `rotate(${-5 * s(t, 0.5)}deg)` }),
  wave:    (t) => ({ armR: `rotate(${24 * s(t, 1.5)}deg)`, head: `rotate(${4 * s(t, 0.8)}deg)`, armL: `rotate(${3 * s(t, 0.6)}deg)` }),
  gesture: (t) => ({ armL: `rotate(${10 * s(t, 1.1)}deg)`, armR: `rotate(${-12 * s(t, 1.0)}deg)`, head: `rotate(${3 * s(t, 0.7)}deg)` }),
  walk:    (t) => ({ legL: `rotate(${15 * s(t, 1.4)}deg)`, legR: `rotate(${-15 * s(t, 1.4)}deg)`, armL: `rotate(${-12 * s(t, 1.4)}deg)`, armR: `rotate(${12 * s(t, 1.4)}deg)`, rig: `translateY(${-3 * up(t, 1.4)}px)` }),
  bounce:  (t) => ({ rig: `translateY(${-10 * up(t, 1.1)}px)`, legL: `rotate(${4 * up(t, 1.1)}deg)`, legR: `rotate(${-4 * up(t, 1.1)}deg)` }),
  nod:     (t) => ({ head: `translateY(${2.5 + 2.5 * s(t, 1.1)}px) rotate(${2 * s(t, 1.1)}deg)` }),
  shake:   (t) => ({ head: `rotate(${7 * s(t, 1.7)}deg)` }),
  point:   (t) => ({ armR: `rotate(${-28 + 5 * s(t, 1.0)}deg)`, head: `rotate(3deg)` }),
  think:   (t) => ({ head: `rotate(${7 + 2 * s(t, 0.4)}deg)`, armR: `rotate(${-22 + 3 * s(t, 0.5)}deg)` }),
  cheer:   (t) => ({ armL: `rotate(${-22 + 6 * s(t, 2)}deg)`, armR: `rotate(${22 - 6 * s(t, 2)}deg)`, rig: `translateY(${-6 * up(t, 1.6)}px)` }),
  worry:   (t) => ({ rig: `rotate(${1.5 * s(t, 0.5)}deg)`, head: `rotate(5deg) translateY(2px)`, armL: `rotate(${4 * s(t, 0.7)}deg)`, armR: `rotate(${-4 * s(t, 0.7)}deg)` }),
  toss:    (t) => ({ armR: `rotate(${-20 - 18 * half(t, 0.9)}deg)`, rig: `rotate(${-1.5 * half(t, 0.9)}deg)` }),
  run:     (t) => ({ legL: `rotate(${24 * s(t, 2.0)}deg)`, legR: `rotate(${-24 * s(t, 2.0)}deg)`, armL: `rotate(${-20 * s(t, 2.0)}deg)`, armR: `rotate(${20 * s(t, 2.0)}deg)`, rig: `translateY(${-5 * up(t, 2.0)}px)` }),
  jump:    (t) => ({ rig: `translateY(${-22 * up(t, 1.0)}px)`, legL: `rotate(${10 * up(t, 1.0)}deg)`, legR: `rotate(${-10 * up(t, 1.0)}deg)`, armL: `rotate(-24deg)`, armR: `rotate(24deg)` }),
  shrug:   (t) => ({ armL: `rotate(${18 * half(t, 0.7)}deg)`, armR: `rotate(${-18 * half(t, 0.7)}deg)`, head: `rotate(${4 * half(t, 0.7)}deg) translateY(${2 * half(t, 0.7)}px)` }),
  clap:    (t) => ({ armL: `rotate(${22 * half(t, 2.0)}deg)`, armR: `rotate(${-22 * half(t, 2.0)}deg)`, head: `rotate(${2 * s(t, 1)}deg)` }),
  dance:   (t) => ({ rig: `rotate(${4 * s(t, 1.2)}deg) translateY(${-4 * up(t, 2.4)}px)`, armL: `rotate(${18 * s(t, 2.4)}deg)`, armR: `rotate(${-18 * s(t, 2.4)}deg)`, head: `rotate(${4 * s(t, 1.2)}deg)` }),
  facepalm:(t) => ({ armR: `rotate(${-48 + 4 * s(t, 0.6)}deg)`, head: `rotate(8deg) translateY(3px)`, rig: `rotate(${-1.5 * s(t, 0.4)}deg)` }),
  look:    (t) => ({ head: `rotate(${10 * s(t, 0.5)}deg)`, rig: `rotate(${1.5 * s(t, 0.5)}deg)` }),
  reach:   (t) => ({ armR: `rotate(${-46 * half(t, 0.8)}deg)`, rig: `rotate(${-2 * half(t, 0.8)}deg)`, head: `rotate(${3 * half(t, 0.8)}deg)` }),
  stretch: (t) => ({ armL: `rotate(${-22 * half(t, 0.3)}deg)`, armR: `rotate(${22 * half(t, 0.3)}deg)`, rig: `scaleY(${1 + 0.02 * half(t, 0.3)})` }),
  count:   (t) => ({ armR: `rotate(${-26 + 7 * s(t, 1.6)}deg)`, head: `translateY(${1.5 * s(t, 1.6)}px)` }),
};

export function presetParts(name: string | undefined, t: number): Parts {
  return (PRESETS[(name as PresetName)] || PRESETS.idle)(t);
}
