export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
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

export interface SkinMask {
  width: number;
  height: number;
  probabilities: Float32Array;
}

export interface BinaryMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface SkinMorphologyOptions {
  enabled?: boolean;
  kernelSize?: number;
  openIterations?: number;
  closeIterations?: number;
}

export interface SkinMaskProcessOptions {
  threshold?: number;
  morphology?: SkinMorphologyOptions;
  minComponentArea?: number;
  keepLargestComponent?: boolean;
  retainNearbyComponents?: boolean;
  nearbyComponentMinAreaRatio?: number;
  nearbyComponentMaxDistance?: number;
}

export interface SkinContourResampleOptions {
  minStep?: number;
  maxStep?: number;
}

export interface SkinContourExtractOptions {
  simplifyTolerance?: number;
  highQualitySimplify?: boolean;
  minLoopArea?: number;
  resample?: SkinContourResampleOptions;
}

export interface SkinContourLoop {
  points: Point[];
  isHole: boolean;
  area: number;
  perimeter: number;
}

export interface SkinMeshResolution {
  innerRadius: number;
  boundaryBandWidth: number;
  boundaryRadius: number;
}

export interface SkinMeshTriangulationOptions {
  useConstraintEdges?: boolean;
  allowLooseFallback?: boolean;
  minTriangleArea?: number;
}

export interface BodyMeshPipelineParams {
  threshold: number;
  morphStrength: number;
  boundaryDensity: number;
  contourSimplify: number;
  resampleMin: number;
  resampleMax: number;
  samplingInnerRadius: number;
  samplingBandRadius: number;
  samplingBoundaryRadius: number;
  useConstraintEdges: boolean;
  allowLooseFallback: boolean;
  minTriangleArea: number;
}

export interface SkinMeshData {
  positions: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  boundaryFlags?: Uint8Array;
}

export interface SurfaceFieldData {
  width: number;
  height: number;
  normalRgba: Uint8ClampedArray;
}

export interface DepthFieldData {
  width: number;
  height: number;
  depth: Float32Array;
}
