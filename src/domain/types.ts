export interface Point {
  x: number;
  y: number;
}

export interface Vector2 {
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

export interface TattooWarpDebugLine {
  source: Point;
  destination: Point;
}

export interface TattooWarpMeshData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  debugLines: TattooWarpDebugLine[];
  controlPoints: Array<{ source: Point; destination: Point }>;
  stats: {
    maxDisplacementPx: number;
    meanDisplacementPx: number;
  };
}

export interface SurfaceFieldData {
  width: number;
  height: number;
  normalRgba: Uint8ClampedArray;
  normalStats?: {
    activePixelRatio: number;
    maxNormalXY: number;
    meanNormalXY: number;
  };
}

export interface DepthFieldData {
  width: number;
  height: number;
  depth: Float32Array;
}

export interface SurfaceAxis {
  origin: Point;
  direction: Vector2;
  length: number;
}

export interface BodySurfaceAnalysisDebugState {
  source: "local-mesh" | "insufficient-mesh";
  confidence: number;
  normalStats?: SurfaceFieldData["normalStats"];
  axis?: SurfaceAxis;
  patchBounds?: Rect;
  proxy?: LocalSurfaceProxy;
  edgeTurn?: number;
  curvature?: LocalSurfaceDescriptor["curvature"];
  shading?: ShadingGeometryAssistDebug;
  warning?: string;
}

export type LocalSurfaceProxy =
  | "ellipticalCylinder"
  | "ellipsoidPatch"
  | "curvedPlane"
  | "genericEdgeTurn";

export interface ShadingGeometryAssistDebug {
  enabled: boolean;
  used: boolean;
  confidence: number;
  agreement: number;
  appliedStrength: number;
  reason: "disabled" | "low-confidence" | "geometry-conflict" | "used";
}

export interface LocalSurfaceDescriptor {
  source: "geometry" | "geometry-shading" | "insufficient";
  proxy: LocalSurfaceProxy;
  axis: SurfaceAxis;
  localBounds: Rect;
  localWidth: number;
  edgeTurn: number;
  curvature: {
    acrossAxis: number;
    alongAxis: number;
  };
  confidence: number;
  shading?: ShadingGeometryAssistDebug;
}

export interface ShadingGeometryAssistInput {
  enabled: boolean;
  sourceCanvas?: HTMLCanvasElement;
  maxAdjustmentRatio?: number;
}
