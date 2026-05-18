import { extractSkinContours } from "./skinContour";
import { postProcessSkinMask } from "./skinMaskProcess";
import { buildSkinMesh } from "./skinMesh";
import { sampleSkinInterior } from "./skinSampling";
import type {
  BodyMeshPipelineParams,
  SkinContourExtractOptions,
  SkinMask,
  SkinMaskProcessOptions,
  SkinMeshData,
  SkinMeshResolution,
  SkinMeshTriangulationOptions,
} from "./types";

export interface SkinMeshPipelineOptions {
  maskProcess?: SkinMaskProcessOptions;
  contourExtract?: SkinContourExtractOptions;
  resolution?: SkinMeshResolution;
  triangulation?: SkinMeshTriangulationOptions;
}

const defaultMaskProcess: SkinMaskProcessOptions = {
  threshold: 0.55,
  minComponentArea: 64,
  keepLargestComponent: true,
  retainNearbyComponents: true,
  nearbyComponentMinAreaRatio: 0.12,
  nearbyComponentMaxDistance: 26,
  morphology: {
    enabled: true,
    kernelSize: 3,
    openIterations: 1,
    closeIterations: 1,
  },
};

const defaultContourExtract: SkinContourExtractOptions = {
  simplifyTolerance: 1.2,
  minLoopArea: 12,
  resample: {
    minStep: 3,
    maxStep: 10,
  },
};

const defaultResolution: SkinMeshResolution = {
  innerRadius: 14,
  boundaryBandWidth: 24,
  boundaryRadius: 8,
};

const defaultTriangulation: SkinMeshTriangulationOptions = {
  useConstraintEdges: true,
  allowLooseFallback: true,
  minTriangleArea: 1e-5,
};

export const defaultBodyMeshPipelineParams: BodyMeshPipelineParams = {
  threshold: defaultMaskProcess.threshold ?? 0.55,
  morphStrength: 1,
  boundaryDensity: 1,
  contourSimplify: defaultContourExtract.simplifyTolerance ?? 1.2,
  resampleMin: defaultContourExtract.resample?.minStep ?? 3,
  resampleMax: defaultContourExtract.resample?.maxStep ?? 10,
  samplingInnerRadius: defaultResolution.innerRadius,
  samplingBandRadius: defaultResolution.boundaryBandWidth,
  samplingBoundaryRadius: defaultResolution.boundaryRadius,
  useConstraintEdges: defaultTriangulation.useConstraintEdges ?? true,
  allowLooseFallback: defaultTriangulation.allowLooseFallback ?? true,
  minTriangleArea: defaultTriangulation.minTriangleArea ?? 1e-5,
};

export function createSkinMeshPipelineOptionsFromBodyParams(
  params: BodyMeshPipelineParams,
): SkinMeshPipelineOptions {
  const morphStrength = clamp(Math.round(params.morphStrength), 0, 3);
  const kernelSize = 3 + morphStrength * 2;
  const density = clamp(params.boundaryDensity, 0.5, 2);
  const resampleMin = clamp(params.resampleMin / density, 1, 24);
  const resampleMax = Math.max(resampleMin, clamp(params.resampleMax / density, 2, 36));

  return {
    maskProcess: {
      threshold: clamp(params.threshold, 0.05, 0.95),
      keepLargestComponent: true,
      retainNearbyComponents: true,
      nearbyComponentMinAreaRatio: 0.12,
      nearbyComponentMaxDistance: 26,
      minComponentArea: 48,
      morphology: {
        enabled: morphStrength > 0,
        kernelSize,
        openIterations: morphStrength,
        closeIterations: morphStrength,
      },
    },
    contourExtract: {
      simplifyTolerance: clamp(params.contourSimplify, 0, 8),
      minLoopArea: 12,
      resample: {
        minStep: resampleMin,
        maxStep: resampleMax,
      },
    },
    resolution: {
      innerRadius: clamp(params.samplingInnerRadius, 2, 64),
      boundaryBandWidth: clamp(params.samplingBandRadius, 1, 96),
      boundaryRadius: clamp(params.samplingBoundaryRadius, 1, 48),
    },
    triangulation: {
      useConstraintEdges: params.useConstraintEdges,
      allowLooseFallback: params.allowLooseFallback,
      minTriangleArea: clamp(params.minTriangleArea, 0, 8),
    },
  };
}

export function buildSkinMeshFromMask(
  mask: SkinMask,
  options?: SkinMeshPipelineOptions,
): SkinMeshData {
  const binaryMask = postProcessSkinMask(mask, {
    ...defaultMaskProcess,
    ...options?.maskProcess,
    morphology: {
      ...defaultMaskProcess.morphology,
      ...(options?.maskProcess?.morphology ?? {}),
    },
  });

  const loops = extractSkinContours(binaryMask, {
    ...defaultContourExtract,
    ...options?.contourExtract,
    resample: {
      ...defaultContourExtract.resample,
      ...(options?.contourExtract?.resample ?? {}),
    },
  });

  if (loops.length === 0) {
    throw new Error("Cannot build skin mesh: no valid contours extracted from mask.");
  }

  const interior = sampleSkinInterior(
    binaryMask,
    loops,
    options?.resolution ?? defaultResolution,
  );

  return buildSkinMesh(loops, interior, {
    ...defaultTriangulation,
    ...(options?.triangulation ?? {}),
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
