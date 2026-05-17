import type { SphereSurface } from "./domain/types";

export const stageSize = {
  width: 900,
  height: 620,
} as const;

export const sphere: SphereSurface = {
  cx: 450,
  cy: 310,
  r: 205,
};

export const meshResolution = {
  radialSegments: 18,
  angularSegments: 72,
} as const;
