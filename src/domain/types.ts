export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface SphereSurface {
  cx: number;
  cy: number;
  r: number;
}

export interface SphereMeshResolution {
  radialSegments: number;
  angularSegments: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}

export interface TattooTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface TattooImageAsset {
  canvas: HTMLCanvasElement;
  size: Size;
  sourceWidth: number;
  sourceHeight: number;
  hadTransparency: boolean;
}
