# Pose Geometry Body Surface MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this compact MVP task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-hour MVP that uses local MediaPipe Pose when available, falls back to mask geometry for cropped images, and replaces depth-first normal generation with a primitive-first surface field.

**Architecture:** Add focused domain modules for pose loading, region classification, primitive fitting, and pipeline orchestration. Keep renderer contracts stable by continuing to output `SurfaceFieldData.normalRgba`; do not add shader parameter textures, worker migration, or DensePose/IUV in this MVP.

**Tech Stack:** TypeScript, Vitest, MediaPipe `@mediapipe/tasks-vision`, existing skin mask/mesh pipeline, existing Pixi normal texture path.

---

## Time Box

Target implementation time: 60 minutes.

Process constraints:

- No per-task commit requirement.
- No subagent review loop.
- One final verification pass: `bun run test`, `bun run typecheck`, `bun run build`.
- Keep implementation minimal even if some classifications are conservative.

## Scope Check

This is one frontend subsystem: `pose/mask/mesh -> surface descriptor -> normal texture`.

Included:

- Local model path config.
- Pose adapter with graceful failure.
- Pose-driven coarse classifier.
- Geometry fallback classifier.
- Primitive normal texture generator.
- App integration that makes depth optional rather than primary.

Deferred:

- Web Worker migration.
- Full/Heavy model switch UI.
- New shader uniforms or curvature texture.
- DensePose/IUV.
- Downloading model assets automatically.

## File Structure Map

Create:

- `src/domain/bodyPose.ts` - local MediaPipe Pose adapter and normalized landmark contract.
- `src/domain/bodyRegionClassifier.ts` - pose-driven and geometry-driven region classification.
- `src/domain/bodySurfacePrimitive.ts` - primitive descriptor and normal texture generation.
- `src/domain/bodySurfacePipeline.ts` - orchestration and fallback summary.
- `tests/domain/bodyRegionClassifier.test.ts`
- `tests/domain/bodySurfacePrimitive.test.ts`
- `tests/domain/bodySurfacePipeline.test.ts`

Modify:

- `src/domain/types.ts` - shared body surface types.
- `src/app.ts` - call new surface pipeline in `applyBodySurfaceResult`.

Do not modify:

- `src/render/pixiRenderer.ts` unless type changes require it.
- Shader code.
- Existing skin mesh pipeline internals.

## Task 1: Add Shared Types

**Files:**
- Modify: `src/domain/types.ts`

- [ ] **Step 1: Add body surface contracts near existing surface/depth types**

```ts
export interface Vector2 {
  x: number;
  y: number;
}

export type BodyPoseLandmarkName =
  | "nose"
  | "leftShoulder"
  | "rightShoulder"
  | "leftElbow"
  | "rightElbow"
  | "leftWrist"
  | "rightWrist"
  | "leftHip"
  | "rightHip";

export interface BodyPoseLandmark {
  name: BodyPoseLandmarkName;
  point: Point;
  visibility: number;
  presence: number;
}

export interface BodyPoseEstimate {
  landmarks: BodyPoseLandmark[];
  confidence: number;
  source: "mediapipe";
}

export type BodySurfaceRegion =
  | "upperArm"
  | "forearm"
  | "torso"
  | "shoulderChest"
  | "limbLike"
  | "generic";

export interface SurfaceAxis {
  origin: Point;
  direction: Vector2;
  length: number;
}

export interface BodyRegionClassification {
  region: BodySurfaceRegion;
  side?: "left" | "right";
  source: "pose" | "geometry" | "generic";
  confidence: number;
  axis: SurfaceAxis;
  landmarksUsed: BodyPoseLandmarkName[];
}

export interface BodySurfaceDescriptor {
  model: "cylinder" | "capsule" | "ellipsoid" | "blendedEllipsoid" | "generic";
  source: "pose" | "geometry" | "generic";
  confidence: number;
  axis: SurfaceAxis;
  curvature: {
    alongAxis: number;
    acrossAxis: number;
    edgeWrap: number;
  };
  handedness?: "left" | "right";
}

export interface BodySurfaceSummary {
  region: BodySurfaceRegion | "legacy";
  source: "pose" | "geometry" | "generic" | "legacy";
  confidence: number;
  warning?: string;
}
```

## Task 2: Implement Minimal Pose Adapter

**Files:**
- Create: `src/domain/bodyPose.ts`

- [ ] **Step 1: Create local-model MediaPipe adapter**

```ts
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { BodyPoseEstimate, BodyPoseLandmark, BodyPoseLandmarkName } from "./types";

export interface BodyPoseConfig {
  wasmPath: string;
  modelPath: string;
  delegate: "CPU" | "GPU";
}

export const defaultBodyPoseConfig: BodyPoseConfig = {
  wasmPath: "/models/tasks-vision/wasm",
  modelPath: "/models/pose_landmarker_lite.task",
  delegate: "CPU",
};

interface PoseLandmarkerLike {
  detect(image: TexImageSource): {
    landmarks?: Array<Array<{ x: number; y: number; visibility?: number; presence?: number }>>;
  };
}

interface BodyPoseDependencies {
  createVisionFileset(wasmPath: string): Promise<unknown>;
  createPoseLandmarker(fileset: unknown, config: BodyPoseConfig): Promise<PoseLandmarkerLike>;
}

const landmarkNames: Record<number, BodyPoseLandmarkName | undefined> = {
  0: "nose",
  11: "leftShoulder",
  12: "rightShoulder",
  13: "leftElbow",
  14: "rightElbow",
  15: "leftWrist",
  16: "rightWrist",
  23: "leftHip",
  24: "rightHip",
};

const defaultDependencies: BodyPoseDependencies = {
  createVisionFileset(wasmPath) {
    return FilesetResolver.forVisionTasks(wasmPath);
  },
  createPoseLandmarker(fileset, config) {
    return PoseLandmarker.createFromOptions(fileset as never, {
      baseOptions: {
        modelAssetPath: config.modelPath,
        delegate: config.delegate,
      },
      runningMode: "IMAGE",
      numPoses: 1,
    }) as Promise<PoseLandmarkerLike>;
  },
};

export function createBodyPoseService(
  dependencies: BodyPoseDependencies = defaultDependencies,
  config: BodyPoseConfig = defaultBodyPoseConfig,
) {
  let landmarkerPromise: Promise<PoseLandmarkerLike> | null = null;

  async function loadLandmarker(): Promise<PoseLandmarkerLike> {
    if (!landmarkerPromise) {
      landmarkerPromise = dependencies.createVisionFileset(config.wasmPath)
        .then((fileset) => dependencies.createPoseLandmarker(fileset, config))
        .catch((error) => {
          landmarkerPromise = null;
          throw error;
        });
    }
    return landmarkerPromise;
  }

  return {
    async estimatePose(image: TexImageSource): Promise<BodyPoseEstimate | null> {
      const landmarker = await loadLandmarker();
      const result = landmarker.detect(image);
      const pose = result.landmarks?.[0];
      if (!pose) {
        return null;
      }

      const landmarks: BodyPoseLandmark[] = [];
      for (const [indexText, name] of Object.entries(landmarkNames)) {
        if (!name) {
          continue;
        }
        const raw = pose[Number(indexText)];
        if (!raw) {
          continue;
        }
        landmarks.push({
          name,
          point: { x: raw.x, y: raw.y },
          visibility: raw.visibility ?? 1,
          presence: raw.presence ?? 1,
        });
      }

      const confidence = landmarks.length === 0
        ? 0
        : landmarks.reduce((sum, landmark) => sum + Math.min(landmark.visibility, landmark.presence), 0) / landmarks.length;
      return { landmarks, confidence, source: "mediapipe" };
    },
  };
}

const defaultBodyPoseService = createBodyPoseService();

export async function estimateBodyPose(image: TexImageSource): Promise<BodyPoseEstimate | null> {
  return defaultBodyPoseService.estimatePose(image);
}
```

## Task 3: Add Region Classifier

**Files:**
- Create: `src/domain/bodyRegionClassifier.ts`
- Test: `tests/domain/bodyRegionClassifier.test.ts`

- [ ] **Step 1: Add classifier tests**

```ts
import { describe, expect, test } from "vitest";
import { classifyBodyRegion } from "../../src/domain/bodyRegionClassifier";
import type { BodyPoseEstimate, SkinMask, SkinMeshData } from "../../src/domain/types";

function fullMask(width = 100, height = 100): SkinMask {
  return { width, height, probabilities: new Float32Array(width * height).fill(1) };
}

function verticalMesh(): SkinMeshData {
  return {
    positions: new Float32Array([45, 10, 55, 10, 55, 90, 45, 90]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

const pose: BodyPoseEstimate = {
  source: "mediapipe",
  confidence: 0.9,
  landmarks: [
    { name: "leftShoulder", point: { x: 0.5, y: 0.1 }, visibility: 1, presence: 1 },
    { name: "leftElbow", point: { x: 0.5, y: 0.45 }, visibility: 1, presence: 1 },
    { name: "leftWrist", point: { x: 0.5, y: 0.85 }, visibility: 1, presence: 1 },
  ],
};

describe("classifyBodyRegion", () => {
  test("uses pose landmarks when available", () => {
    const result = classifyBodyRegion({ pose, mask: fullMask(), mesh: verticalMesh() });
    expect(result.source).toBe("pose");
    expect(["upperArm", "forearm"]).toContain(result.region);
    expect(result.confidence).toBeGreaterThan(0.45);
  });

  test("falls back to limb-like geometry for long narrow meshes", () => {
    const result = classifyBodyRegion({ pose: null, mask: fullMask(), mesh: verticalMesh() });
    expect(result.source).toBe("geometry");
    expect(result.region).toBe("limbLike");
    expect(result.confidence).toBeGreaterThan(0.45);
  });
});
```

- [ ] **Step 2: Implement classifier**

```ts
import type {
  BodyPoseEstimate,
  BodyPoseLandmark,
  BodyPoseLandmarkName,
  BodyRegionClassification,
  Point,
  SkinMask,
  SkinMeshData,
  SurfaceAxis,
  Vector2,
} from "./types";

export interface BodyRegionClassifyInput {
  pose: BodyPoseEstimate | null;
  mask: SkinMask;
  mesh: SkinMeshData;
}

export function classifyBodyRegion(input: BodyRegionClassifyInput): BodyRegionClassification {
  const poseResult = input.pose ? classifyFromPose(input.pose, input.mesh, input.mask) : null;
  if (poseResult && poseResult.confidence >= 0.65) {
    return poseResult;
  }

  const geometryResult = classifyFromGeometry(input.mesh);
  if (geometryResult.confidence >= 0.45) {
    return geometryResult;
  }

  return {
    region: "generic",
    source: "generic",
    confidence: 0.25,
    axis: geometryResult.axis,
    landmarksUsed: [],
  };
}

function classifyFromPose(
  pose: BodyPoseEstimate,
  mesh: SkinMeshData,
  mask: SkinMask,
): BodyRegionClassification | null {
  const candidates = [
    segmentCandidate(pose, "leftShoulder", "leftElbow", "upperArm", "left", mask),
    segmentCandidate(pose, "leftElbow", "leftWrist", "forearm", "left", mask),
    segmentCandidate(pose, "rightShoulder", "rightElbow", "upperArm", "right", mask),
    segmentCandidate(pose, "rightElbow", "rightWrist", "forearm", "right", mask),
  ].filter((candidate): candidate is BodyRegionClassification => Boolean(candidate));

  if (candidates.length === 0) {
    return null;
  }

  const meshAxis = computeMeshAxis(mesh);
  candidates.sort((a, b) => scorePoseCandidate(b, meshAxis) - scorePoseCandidate(a, meshAxis));
  return candidates[0];
}

function segmentCandidate(
  pose: BodyPoseEstimate,
  startName: BodyPoseLandmarkName,
  endName: BodyPoseLandmarkName,
  region: "upperArm" | "forearm",
  side: "left" | "right",
  mask: SkinMask,
): BodyRegionClassification | null {
  const start = findLandmark(pose, startName);
  const end = findLandmark(pose, endName);
  if (!start || !end) {
    return null;
  }

  const origin = { x: start.point.x * mask.width, y: start.point.y * mask.height };
  const target = { x: end.point.x * mask.width, y: end.point.y * mask.height };
  const axis = createAxis(origin, target);
  const landmarkConfidence = Math.min(start.visibility, start.presence, end.visibility, end.presence);

  return {
    region,
    side,
    source: "pose",
    confidence: Math.min(0.95, 0.35 + pose.confidence * 0.35 + landmarkConfidence * 0.25),
    axis,
    landmarksUsed: [startName, endName],
  };
}

function classifyFromGeometry(mesh: SkinMeshData): BodyRegionClassification {
  const box = meshBounds(mesh);
  const axis = computeMeshAxis(mesh);
  const longSide = Math.max(box.width, box.height);
  const shortSide = Math.max(1, Math.min(box.width, box.height));
  const aspect = longSide / shortSide;

  if (aspect >= 2.1) {
    return {
      region: "limbLike",
      source: "geometry",
      confidence: Math.min(0.8, 0.42 + (aspect - 2.1) * 0.12),
      axis,
      landmarksUsed: [],
    };
  }

  if (aspect <= 1.45 && box.width > 20 && box.height > 20) {
    return {
      region: "torso",
      source: "geometry",
      confidence: 0.5,
      axis,
      landmarksUsed: [],
    };
  }

  return {
    region: "generic",
    source: "generic",
    confidence: 0.3,
    axis,
    landmarksUsed: [],
  };
}

function scorePoseCandidate(candidate: BodyRegionClassification, meshAxis: SurfaceAxis): number {
  const alignment = Math.abs(dot(candidate.axis.direction, meshAxis.direction));
  return candidate.confidence + alignment * 0.2;
}

function computeMeshAxis(mesh: SkinMeshData): SurfaceAxis {
  const box = meshBounds(mesh);
  const horizontal = box.width >= box.height;
  return {
    origin: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    direction: horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 },
    length: Math.max(box.width, box.height),
  };
}

function meshBounds(mesh: SkinMeshData): { x: number; y: number; width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < mesh.positions.length; i += 2) {
    minX = Math.min(minX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]);
    maxX = Math.max(maxX, mesh.positions[i]);
    maxY = Math.max(maxY, mesh.positions[i + 1]);
  }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function findLandmark(pose: BodyPoseEstimate, name: BodyPoseLandmarkName): BodyPoseLandmark | null {
  return pose.landmarks.find((landmark) => landmark.name === name) ?? null;
}

function createAxis(origin: Point, target: Point): SurfaceAxis {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  return { origin, direction: { x: dx / length, y: dy / length }, length };
}

function dot(a: Vector2, b: Vector2): number {
  return a.x * b.x + a.y * b.y;
}
```

## Task 4: Add Primitive Surface Field Builder

**Files:**
- Create: `src/domain/bodySurfacePrimitive.ts`
- Test: `tests/domain/bodySurfacePrimitive.test.ts`

- [ ] **Step 1: Add primitive tests**

```ts
import { describe, expect, test } from "vitest";
import { buildBodySurfaceDescriptor, buildPrimitiveSurfaceField } from "../../src/domain/bodySurfacePrimitive";
import type { BodyRegionClassification, SkinMask } from "../../src/domain/types";

const classification: BodyRegionClassification = {
  region: "limbLike",
  source: "geometry",
  confidence: 0.7,
  axis: { origin: { x: 50, y: 50 }, direction: { x: 0, y: 1 }, length: 80 },
  landmarksUsed: [],
};

function mask(): SkinMask {
  return { width: 64, height: 64, probabilities: new Float32Array(64 * 64).fill(1) };
}

describe("body surface primitive", () => {
  test("maps limb-like regions to cylinder descriptors", () => {
    const descriptor = buildBodySurfaceDescriptor(classification);
    expect(descriptor.model).toBe("cylinder");
    expect(descriptor.curvature.acrossAxis).toBeGreaterThan(descriptor.curvature.alongAxis);
  });

  test("builds finite normal texture", () => {
    const descriptor = buildBodySurfaceDescriptor(classification);
    const surface = buildPrimitiveSurfaceField({
      descriptor,
      mask: mask(),
      stageSize: { width: 64, height: 64 },
      placementRect: { x: 0, y: 0, width: 64, height: 64 },
    });
    expect(surface.normalRgba.length).toBe(64 * 64 * 4);
    expect(Array.from(surface.normalRgba).every(Number.isFinite)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement primitive field**

```ts
import type {
  BodyRegionClassification,
  BodySurfaceDescriptor,
  Rect,
  Size,
  SkinMask,
  SurfaceFieldData,
} from "./types";

export interface PrimitiveSurfaceFieldInput {
  descriptor: BodySurfaceDescriptor;
  mask: SkinMask;
  stageSize: Size;
  placementRect: Rect;
}

export function buildBodySurfaceDescriptor(classification: BodyRegionClassification): BodySurfaceDescriptor {
  if (classification.region === "upperArm" || classification.region === "forearm" || classification.region === "limbLike") {
    return {
      model: "cylinder",
      source: classification.source,
      confidence: classification.confidence,
      axis: classification.axis,
      curvature: { alongAxis: 0.12, acrossAxis: 0.82, edgeWrap: 0.72 },
      handedness: classification.side,
    };
  }

  if (classification.region === "torso") {
    return {
      model: "ellipsoid",
      source: classification.source,
      confidence: classification.confidence,
      axis: classification.axis,
      curvature: { alongAxis: 0.24, acrossAxis: 0.38, edgeWrap: 0.32 },
      handedness: classification.side,
    };
  }

  if (classification.region === "shoulderChest") {
    return {
      model: "blendedEllipsoid",
      source: classification.source,
      confidence: classification.confidence,
      axis: classification.axis,
      curvature: { alongAxis: 0.3, acrossAxis: 0.48, edgeWrap: 0.45 },
      handedness: classification.side,
    };
  }

  return {
    model: "generic",
    source: "generic",
    confidence: Math.min(classification.confidence, 0.35),
    axis: classification.axis,
    curvature: { alongAxis: 0.16, acrossAxis: 0.24, edgeWrap: 0.2 },
  };
}

export function buildPrimitiveSurfaceField(input: PrimitiveSurfaceFieldInput): SurfaceFieldData {
  const width = Math.max(1, Math.round(input.stageSize.width));
  const height = Math.max(1, Math.round(input.stageSize.height));
  const normalRgba = new Uint8ClampedArray(width * height * 4);
  const axis = input.descriptor.axis;
  const normalAxis = { x: -axis.direction.y, y: axis.direction.x };
  const radius = Math.max(1, Math.min(input.placementRect.width, input.placementRect.height) * 0.5);
  const strength = clamp(input.descriptor.curvature.acrossAxis * input.descriptor.confidence, 0.05, 0.9);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const rgbaIndex = index * 4;
      if (!insideMask(input.mask, input.placementRect, x, y)) {
        writeNormal(normalRgba, rgbaIndex, 0, 0, 1, 0);
        continue;
      }

      const relX = x - axis.origin.x;
      const relY = y - axis.origin.y;
      const cross = clamp((relX * normalAxis.x + relY * normalAxis.y) / radius, -1, 1);
      const nx = normalAxis.x * cross * strength;
      const ny = normalAxis.y * cross * strength;
      const nz = Math.sqrt(Math.max(0.2, 1 - nx * nx - ny * ny));
      writeNormal(normalRgba, rgbaIndex, nx, ny, nz, 255);
    }
  }

  return { width, height, normalRgba };
}

function insideMask(mask: SkinMask, placementRect: Rect, x: number, y: number): boolean {
  if (placementRect.width <= 0 || placementRect.height <= 0) {
    return false;
  }
  const u = (x + 0.5 - placementRect.x) / placementRect.width;
  const v = (y + 0.5 - placementRect.y) / placementRect.height;
  if (u < 0 || v < 0 || u > 1 || v > 1) {
    return false;
  }
  const mx = Math.min(mask.width - 1, Math.max(0, Math.floor(u * mask.width)));
  const my = Math.min(mask.height - 1, Math.max(0, Math.floor(v * mask.height)));
  return mask.probabilities[my * mask.width + mx] >= 0.4;
}

function writeNormal(target: Uint8ClampedArray, index: number, x: number, y: number, z: number, alpha: number): void {
  const length = Math.max(1e-6, Math.hypot(x, y, z));
  target[index] = encode(x / length);
  target[index + 1] = encode(y / length);
  target[index + 2] = encode(z / length);
  target[index + 3] = alpha;
}

function encode(value: number): number {
  return Math.round((clamp(value, -1, 1) * 0.5 + 0.5) * 255);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
```

## Task 5: Add Surface Pipeline

**Files:**
- Create: `src/domain/bodySurfacePipeline.ts`
- Test: `tests/domain/bodySurfacePipeline.test.ts`

- [ ] **Step 1: Add pipeline fallback tests**

```ts
import { describe, expect, test } from "vitest";
import { buildBodySurfaceFromInputs } from "../../src/domain/bodySurfacePipeline";
import type { SkinMask, SkinMeshData } from "../../src/domain/types";

function mask(): SkinMask {
  return { width: 64, height: 64, probabilities: new Float32Array(64 * 64).fill(1) };
}

function mesh(): SkinMeshData {
  return {
    positions: new Float32Array([28, 4, 36, 4, 36, 60, 28, 60]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

describe("buildBodySurfaceFromInputs", () => {
  test("uses geometry fallback when pose is null", () => {
    const result = buildBodySurfaceFromInputs({
      pose: null,
      mask: mask(),
      mesh: mesh(),
      stageSize: { width: 64, height: 64 },
      placementRect: { x: 0, y: 0, width: 64, height: 64 },
    });
    expect(result.summary.source).toBe("geometry");
    expect(result.surfaceField.normalRgba.length).toBe(64 * 64 * 4);
  });
});
```

- [ ] **Step 2: Implement pipeline**

```ts
import { classifyBodyRegion } from "./bodyRegionClassifier";
import { buildBodySurfaceDescriptor, buildPrimitiveSurfaceField } from "./bodySurfacePrimitive";
import type {
  BodyPoseEstimate,
  BodySurfaceSummary,
  Rect,
  Size,
  SkinMask,
  SkinMeshData,
  SurfaceFieldData,
} from "./types";

export interface BodySurfaceInput {
  pose: BodyPoseEstimate | null;
  mask: SkinMask;
  mesh: SkinMeshData;
  stageSize: Size;
  placementRect: Rect;
}

export interface BodySurfacePipelineResult {
  surfaceField: SurfaceFieldData;
  mesh: SkinMeshData;
  summary: BodySurfaceSummary;
}

export function buildBodySurfaceFromInputs(input: BodySurfaceInput): BodySurfacePipelineResult {
  const classification = classifyBodyRegion({
    pose: input.pose,
    mask: input.mask,
    mesh: input.mesh,
  });
  const descriptor = buildBodySurfaceDescriptor(classification);
  const surfaceField = buildPrimitiveSurfaceField({
    descriptor,
    mask: input.mask,
    stageSize: input.stageSize,
    placementRect: input.placementRect,
  });

  return {
    surfaceField,
    mesh: input.mesh,
    summary: {
      region: classification.region,
      source: classification.source,
      confidence: classification.confidence,
    },
  };
}
```

## Task 6: Wire App Flow

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Import pose and surface pipeline**

Add:

```ts
import { estimateBodyPose } from "./domain/bodyPose";
import { buildBodySurfaceFromInputs } from "./domain/bodySurfacePipeline";
```

- [ ] **Step 2: Replace depth-first surface generation inside `applyBodySurfaceResult`**

Replace the depth estimate and `buildSurfaceFieldFromSkinMask` block with:

```ts
  let surfaceField = buildSurfaceFieldFromSkinMask({
    mask: result.preview.mask,
    stageSize,
    placementRect,
    options: {
      depthBlendWeight: 0,
      normalStrength: 1.65,
      blurPasses: 2,
    },
  });
  let surfaceSummary: { source: "pose" | "geometry" | "generic" | "legacy"; confidence: number; region: string; warning?: string } = {
    source: "legacy",
    confidence: 0.2,
    region: "legacy",
  };

  try {
    const pose = await estimateBodyPose(result.sourceCanvas);
    const primitiveResult = buildBodySurfaceFromInputs({
      pose,
      mask: result.preview.mask,
      mesh: mappedMesh,
      stageSize,
      placementRect,
    });
    surfaceField = primitiveResult.surfaceField;
    surfaceSummary = primitiveResult.summary;
  } catch (error) {
    surfaceSummary = {
      source: "legacy",
      confidence: 0.2,
      region: "legacy",
      warning: getErrorMessage(error),
    };
  }
```

Then update the function return to:

```ts
  return {
    source: surfaceSummary.source,
    qualityScore: surfaceSummary.confidence,
    warning: surfaceSummary.warning ?? surfaceSummary.region,
  };
```

- [ ] **Step 3: Adjust status text type expectations**

If TypeScript rejects the existing `"onnx" | "luma"` return type, change the return type of `applyBodySurfaceResult` to:

```ts
Promise<{ source: "pose" | "geometry" | "generic" | "legacy"; qualityScore: number; warning?: string }>
```

Change status assignment to:

```ts
        elements.statusLabel.textContent =
          surfaceSummary.source === "legacy"
            ? `applied body surface (legacy fallback: ${surfaceSummary.warning ?? "mask"})`
            : `applied body surface (${surfaceSummary.source}: ${surfaceSummary.warning ?? "body"}, confidence ${Math.round(surfaceSummary.qualityScore * 100)}%)`;
```

## Task 7: Verify

**Files:**
- No new files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
bun run test tests/domain/bodyRegionClassifier.test.ts tests/domain/bodySurfacePrimitive.test.ts tests/domain/bodySurfacePipeline.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
bun run test
bun run typecheck
bun run build
```

Expected: all PASS.

- [ ] **Step 3: If local Pose assets are missing, verify graceful fallback**

Run the app and upload a body image. Expected behavior:

- If `/models/pose_landmarker_lite.task` is missing, app does not crash.
- Status uses `legacy fallback` or geometry-derived surface.
- Tattoo dragging remains realtime.

## Self-Review

Spec coverage:

- No user body-part input: covered by Task 3 and Task 5.
- Local MediaPipe Pose: covered by Task 2.
- Cropped image fallback: covered by Task 3 geometry fallback.
- Primitive-first surface: covered by Task 4 and Task 5.
- Renderer stability: covered by keeping `SurfaceFieldData.normalRgba`.
- Backend-free execution: covered by local model path and app fallback.

Intentional MVP gaps:

- No worker migration.
- No true curvature texture.
- No DensePose/IUV.
- No automatic model asset download.

Placeholder scan:

- No unresolved placeholders.

Type consistency:

- `BodyPoseEstimate`, `BodyRegionClassification`, `BodySurfaceDescriptor`, and `BodySurfaceSummary` are defined before use.
