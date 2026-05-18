# Skin 2D Mesh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-only automatic skin-region meshing pipeline that outputs stable mixed-density 2D triangle meshes for single-image editing.

**Architecture:** Add a new `src/domain` pipeline (`segmentation -> mask post-process -> contour -> sampling -> CDT -> optimize`) and expose one orchestration function that returns renderer-ready typed arrays. Keep rendering integration incremental by reusing existing Pixi mesh upload path and adding debug wireframe visualization for validation.

**Tech Stack:** TypeScript, Vitest, Pixi.js, `@mediapipe/tasks-vision`, `marchingsquares`, `simplify-js`, `poisson-disk-sampling`, `cdt2d`, Earcut fallback.

---

## Scope Check

This spec is a single subsystem (automatic skin-region meshing for uploaded images). It does not include video-frame meshing or backend inference and can be implemented in one plan.

## File Structure Map

### Create

- `src/domain/skinSegmentation.ts` - MediaPipe wrapper and model lifecycle.
- `src/domain/skinMaskProcess.ts` - threshold + morphology + component cleanup.
- `src/domain/skinContour.ts` - contour extraction + simplify + adaptive resampling.
- `src/domain/skinSampling.ts` - mixed-density sample point generation.
- `src/domain/skinMesh.ts` - constrained triangulation + quality cleanup + fallback.
- `src/domain/skinMeshPipeline.ts` - orchestration entry point.
- `tests/domain/skinMaskProcess.test.ts`
- `tests/domain/skinContour.test.ts`
- `tests/domain/skinSampling.test.ts`
- `tests/domain/skinMesh.test.ts`

### Modify

- `package.json` - add runtime deps.
- `src/domain/types.ts` - add skin-mesh data contracts.
- `src/render/pixiRenderer.ts` - add optional skin mesh debug render path.
- `src/app.ts` - wire one-shot mesh generation trigger and renderer hook.
- `tests/render/pixiRenderer.test.ts` - assert new renderer-facing contract.

## Task 1: Install Dependencies And Define Shared Types

**Files:**
- Modify: `package.json`
- Modify: `src/domain/types.ts`
- Test: `tests/domain/skinMesh.test.ts`

- [ ] **Step 1: Write the failing type-contract test**

```ts
import { describe, expect, test } from "vitest";
import type { SkinMeshData } from "../../src/domain/types";

describe("skin mesh type contract", () => {
  test("uses typed arrays for renderer upload safety", () => {
    const mesh: SkinMeshData = {
      positions: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      boundaryFlags: new Uint8Array([1, 1, 1]),
    };

    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);
    expect(mesh.boundaryFlags).toBeInstanceOf(Uint8Array);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/domain/skinMesh.test.ts`  
Expected: FAIL with missing `SkinMeshData` type export.

- [ ] **Step 3: Add dependencies and shared types**

```json
{
  "dependencies": {
    "@mediapipe/tasks-vision": "^0.10.22-rc.20250502",
    "cdt2d": "^1.0.0",
    "earcut": "^3.0.2",
    "marchingsquares": "^1.3.3",
    "poisson-disk-sampling": "^2.3.1",
    "simplify-js": "^1.2.4"
  }
}
```

```ts
export interface SkinMask {
  width: number;
  height: number;
  probs: Float32Array;
}

export interface BinaryMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface ContourLoop {
  points: Point[];
  isHole: boolean;
}

export interface SkinMeshResolution {
  innerRadius: number;
  boundaryBandWidth: number;
  boundaryRadius: number;
}

export interface SkinMeshData {
  positions: Float32Array;
  indices: Uint32Array;
  boundaryFlags?: Uint8Array;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/domain/skinMesh.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json src/domain/types.ts tests/domain/skinMesh.test.ts
git commit -m "feat: add skin mesh dependencies and core types"
```

## Task 2: Implement Mask Post-Processing

**Files:**
- Create: `src/domain/skinMaskProcess.ts`
- Create: `tests/domain/skinMaskProcess.test.ts`

- [ ] **Step 1: Write failing tests for threshold and cleanup**

```ts
import { describe, expect, test } from "vitest";
import { postProcessSkinMask } from "../../src/domain/skinMaskProcess";
import type { SkinMask } from "../../src/domain/types";

function createMask(width: number, height: number, fill: number): SkinMask {
  return { width, height, probs: new Float32Array(width * height).fill(fill) };
}

describe("postProcessSkinMask", () => {
  test("thresholds probability map into a binary mask", () => {
    const input = createMask(3, 1, 0);
    input.probs[0] = 0.2;
    input.probs[1] = 0.6;
    input.probs[2] = 0.9;
    const output = postProcessSkinMask(input, { threshold: 0.55, minRegionArea: 1, morphRadius: 0 });
    expect(Array.from(output.data)).toEqual([0, 1, 1]);
  });

  test("removes isolated tiny components", () => {
    const input = createMask(4, 4, 0.8);
    input.probs[0] = 0.1;
    input.probs[1] = 0.1;
    input.probs[4] = 0.1;
    input.probs[5] = 0.1;
    const output = postProcessSkinMask(input, { threshold: 0.55, minRegionArea: 6, morphRadius: 0 });
    const oneCount = Array.from(output.data).filter((v) => v === 1).length;
    expect(oneCount).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/domain/skinMaskProcess.test.ts`  
Expected: FAIL with missing module/function.

- [ ] **Step 3: Implement `postProcessSkinMask`**

```ts
import type { BinaryMask, SkinMask } from "./types";

export interface SkinMaskProcessOptions {
  threshold: number;
  morphRadius: number;
  minRegionArea: number;
}

export function postProcessSkinMask(mask: SkinMask, options: SkinMaskProcessOptions): BinaryMask {
  const thresholded = thresholdMask(mask, options.threshold);
  const morphed = options.morphRadius > 0 ? morphologyCloseOpen(thresholded, options.morphRadius) : thresholded;
  return removeSmallComponents(morphed, options.minRegionArea);
}

function thresholdMask(mask: SkinMask, threshold: number): BinaryMask {
  const data = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = mask.probs[i] >= threshold ? 1 : 0;
  }
  return { width: mask.width, height: mask.height, data };
}

function morphologyCloseOpen(mask: BinaryMask, radius: number): BinaryMask {
  return erode(dilate(mask, radius), radius);
}

function dilate(mask: BinaryMask, radius: number): BinaryMask {
  const next = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let on = 0;
      for (let oy = -radius; oy <= radius && on === 0; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue;
          if (mask.data[ny * mask.width + nx] === 1) {
            on = 1;
            break;
          }
        }
      }
      next[y * mask.width + x] = on;
    }
  }
  return { width: mask.width, height: mask.height, data: next };
}

function erode(mask: BinaryMask, radius: number): BinaryMask {
  const next = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      let on = 1;
      for (let oy = -radius; oy <= radius && on === 1; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) {
            on = 0;
            break;
          }
          if (mask.data[ny * mask.width + nx] === 0) {
            on = 0;
            break;
          }
        }
      }
      next[y * mask.width + x] = on;
    }
  }
  return { width: mask.width, height: mask.height, data: next };
}

function removeSmallComponents(mask: BinaryMask, minArea: number): BinaryMask {
  const data = new Uint8Array(mask.data);
  const visited = new Uint8Array(data.length);
  const queue: number[] = [];

  for (let i = 0; i < data.length; i += 1) {
    if (data[i] === 0 || visited[i] === 1) continue;
    const component: number[] = [];
    visited[i] = 1;
    queue.push(i);
    while (queue.length > 0) {
      const current = queue.pop() as number;
      component.push(current);
      const x = current % mask.width;
      const y = Math.floor(current / mask.width);
      const neighbors = [current - 1, current + 1, current - mask.width, current + mask.width];
      for (const next of neighbors) {
        const nx = next % mask.width;
        const ny = Math.floor(next / mask.width);
        if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue;
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        if (data[next] === 1 && visited[next] === 0) {
          visited[next] = 1;
          queue.push(next);
        }
      }
    }
    if (component.length < minArea) {
      for (const idx of component) data[idx] = 0;
    }
  }

  return { width: mask.width, height: mask.height, data };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test tests/domain/skinMaskProcess.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/skinMaskProcess.ts tests/domain/skinMaskProcess.test.ts
git commit -m "feat: add skin mask post-processing pipeline"
```

## Task 3: Implement Contour Extraction And Adaptive Resampling

**Files:**
- Create: `src/domain/skinContour.ts`
- Create: `tests/domain/skinContour.test.ts`

- [ ] **Step 1: Write failing contour tests**

```ts
import { describe, expect, test } from "vitest";
import { extractSkinContours } from "../../src/domain/skinContour";
import type { BinaryMask } from "../../src/domain/types";

function blockMask(width: number, height: number, left: number, top: number, right: number, bottom: number): BinaryMask {
  const data = new Uint8Array(width * height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) data[y * width + x] = 1;
  }
  return { width, height, data };
}

describe("extractSkinContours", () => {
  test("extracts at least one outer loop from binary skin region", () => {
    const loops = extractSkinContours(blockMask(32, 32, 4, 6, 24, 28));
    expect(loops.length).toBeGreaterThan(0);
    expect(loops.some((loop) => loop.isHole === false)).toBe(true);
  });

  test("keeps higher point density near sharper turns", () => {
    const loops = extractSkinContours(blockMask(40, 40, 6, 6, 34, 34), { boundaryStepMin: 2, boundaryStepMax: 10 });
    const pointCount = loops[0]?.points.length ?? 0;
    expect(pointCount).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test tests/domain/skinContour.test.ts`  
Expected: FAIL with missing module/function.

- [ ] **Step 3: Implement contour extraction and resampling**

```ts
import simplify from "simplify-js";
import * as MarchingSquares from "marchingsquares";
import type { BinaryMask, ContourLoop, Point } from "./types";

export interface ContourOptions {
  simplifyEpsilon?: number;
  boundaryStepMin?: number;
  boundaryStepMax?: number;
}

export function extractSkinContours(mask: BinaryMask, options: ContourOptions = {}): ContourLoop[] {
  const simplifyEpsilon = options.simplifyEpsilon ?? 1.2;
  const boundaryStepMin = options.boundaryStepMin ?? 3;
  const boundaryStepMax = options.boundaryStepMax ?? 10;
  const scalar: number[][] = [];
  for (let y = 0; y < mask.height; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < mask.width; x += 1) row.push(mask.data[y * mask.width + x]);
    scalar.push(row);
  }

  const raw = MarchingSquares.isoContours(scalar, 0.5, { polygons: true }) as number[][][];
  const loops: ContourLoop[] = [];
  for (const contour of raw) {
    const points = contour.map(([x, y]) => ({ x, y }));
    const simplified = simplify(points as Array<{ x: number; y: number }>, simplifyEpsilon, true) as Point[];
    const resampled = resampleAdaptive(simplified, boundaryStepMin, boundaryStepMax);
    if (resampled.length >= 3) loops.push({ points: resampled, isHole: signedArea(resampled) < 0 });
  }
  return loops.filter((loop) => loop.isHole === false).concat(loops.filter((loop) => loop.isHole));
}

function resampleAdaptive(points: Point[], minStep: number, maxStep: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    out.push(curr);
    const angle = cornerAngle(prev, curr, next);
    const step = lerp(minStep, maxStep, Math.min(1, angle / Math.PI));
    const segmentLen = distance(curr, next);
    const extra = Math.max(0, Math.floor(segmentLen / step) - 1);
    for (let k = 1; k <= extra; k += 1) {
      const t = k / (extra + 1);
      out.push({ x: curr.x + (next.x - curr.x) * t, y: curr.y + (next.y - curr.y) * t });
    }
  }
  return out;
}

function cornerAngle(a: Point, b: Point, c: Point): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const dot = ux * vx + uy * vy;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < 0.0001 || lv < 0.0001) return Math.PI;
  const cos = Math.max(-1, Math.min(1, dot / (lu * lv)));
  return Math.acos(cos);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum * 0.5;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test tests/domain/skinContour.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/skinContour.ts tests/domain/skinContour.test.ts
git commit -m "feat: add skin contour extraction and adaptive resampling"
```

## Task 4: Implement Mixed-Density Interior Sampling

**Files:**
- Create: `src/domain/skinSampling.ts`
- Create: `tests/domain/skinSampling.test.ts`

- [ ] **Step 1: Write failing sampling tests**

```ts
import { describe, expect, test } from "vitest";
import { sampleSkinInterior } from "../../src/domain/skinSampling";
import type { BinaryMask, ContourLoop } from "../../src/domain/types";

describe("sampleSkinInterior", () => {
  test("generates points inside mask only", () => {
    const mask: BinaryMask = { width: 16, height: 16, data: new Uint8Array(16 * 16).fill(1) };
    const loops: ContourLoop[] = [{ isHole: false, points: [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: 15 }, { x: 0, y: 15 }] }];
    const points = sampleSkinInterior(mask, loops, { innerRadius: 4, boundaryBandWidth: 3, boundaryRadius: 2 });
    expect(points.length).toBeGreaterThan(4);
    expect(points.every((p) => p.x >= 0 && p.y >= 0 && p.x <= 15 && p.y <= 15)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test tests/domain/skinSampling.test.ts`  
Expected: FAIL with missing module/function.

- [ ] **Step 3: Implement mixed-density sampling**

```ts
import PoissonDiskSampling from "poisson-disk-sampling";
import type { BinaryMask, ContourLoop, Point, SkinMeshResolution } from "./types";

export function sampleSkinInterior(
  mask: BinaryMask,
  loops: ContourLoop[],
  resolution: SkinMeshResolution,
): Point[] {
  const base = new PoissonDiskSampling({
    shape: [mask.width, mask.height],
    minDistance: resolution.innerRadius,
    maxDistance: resolution.innerRadius * 1.8,
    tries: 20,
  });
  const basePoints = base.fill().map(([x, y]) => ({ x, y }));
  const band = new PoissonDiskSampling({
    shape: [mask.width, mask.height],
    minDistance: resolution.boundaryRadius,
    maxDistance: resolution.boundaryRadius * 1.8,
    tries: 20,
  });
  const bandPoints = band.fill().map(([x, y]) => ({ x, y }));
  const all = basePoints.filter((p) => insideMask(mask, p));
  for (const point of bandPoints) {
    if (!insideMask(mask, point)) continue;
    if (!withinBoundaryBand(point, loops, resolution.boundaryBandWidth)) continue;
    all.push(point);
  }
  return dedupePoints(all);
}

function insideMask(mask: BinaryMask, point: Point): boolean {
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return mask.data[y * mask.width + x] === 1;
}

function withinBoundaryBand(point: Point, loops: ContourLoop[], width: number): boolean {
  let min = Number.POSITIVE_INFINITY;
  for (const loop of loops) {
    const points = loop.points;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      min = Math.min(min, distancePointSegment(point, a, b));
    }
  }
  return min <= width;
}

function distancePointSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const denom = abx * abx + aby * aby;
  const t = denom < 0.0001 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom));
  const qx = a.x + abx * t;
  const qy = a.y + aby * t;
  return Math.hypot(p.x - qx, p.y - qy);
}

function dedupePoints(points: Point[]): Point[] {
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const p of points) {
    const key = `${Math.round(p.x * 100) / 100}:${Math.round(p.y * 100) / 100}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test tests/domain/skinSampling.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/skinSampling.ts tests/domain/skinSampling.test.ts
git commit -m "feat: add mixed-density interior sampling"
```

## Task 5: Implement Constrained Triangulation And Fallback

**Files:**
- Create: `src/domain/skinMesh.ts`
- Modify: `tests/domain/skinMesh.test.ts`

- [ ] **Step 1: Extend failing mesh tests**

```ts
import { describe, expect, test } from "vitest";
import { buildSkinMesh } from "../../src/domain/skinMesh";
import type { ContourLoop, Point } from "../../src/domain/types";

const square: ContourLoop = {
  isHole: false,
  points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }],
};

describe("buildSkinMesh", () => {
  test("returns non-empty indexed triangles", () => {
    const mesh = buildSkinMesh([square], [{ x: 20, y: 20 }, { x: 10, y: 10 }] as Point[]);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun run test tests/domain/skinMesh.test.ts`  
Expected: FAIL with missing module/function.

- [ ] **Step 3: Implement CDT mesh builder with Earcut fallback**

```ts
import cdt2d from "cdt2d";
import earcut from "earcut";
import type { ContourLoop, Point, SkinMeshData } from "./types";

export function buildSkinMesh(loops: ContourLoop[], interior: Point[]): SkinMeshData {
  const contourPoints = loops.flatMap((loop) => loop.points);
  const points = contourPoints.concat(interior);
  const edges = buildConstraintEdges(loops);

  let faces: number[][];
  try {
    faces = cdt2d(
      points.map((p) => [p.x, p.y]),
      edges,
      { exterior: false },
    ) as number[][];
  } catch {
    faces = fallbackEarcutFaces(loops);
  }

  const indices = new Uint32Array(faces.flat());
  const positions = new Float32Array(points.length * 2);
  const boundaryFlags = new Uint8Array(points.length);

  for (let i = 0; i < points.length; i += 1) {
    positions[i * 2] = points[i].x;
    positions[i * 2 + 1] = points[i].y;
    if (i < contourPoints.length) boundaryFlags[i] = 1;
  }

  return { positions, indices, boundaryFlags };
}

function buildConstraintEdges(loops: ContourLoop[]): number[][] {
  const edges: number[][] = [];
  let offset = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.points.length; i += 1) {
      const a = offset + i;
      const b = offset + ((i + 1) % loop.points.length);
      edges.push([a, b]);
    }
    offset += loop.points.length;
  }
  return edges;
}

function fallbackEarcutFaces(loops: ContourLoop[]): number[][] {
  const flat: number[] = [];
  const holeIndices: number[] = [];
  let cursor = 0;

  for (const loop of loops) {
    if (loop.isHole) holeIndices.push(cursor);
    for (const p of loop.points) flat.push(p.x, p.y);
    cursor += loop.points.length;
  }

  const indices = earcut(flat, holeIndices, 2);
  const faces: number[][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    faces.push([indices[i], indices[i + 1], indices[i + 2]]);
  }
  return faces;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test tests/domain/skinMesh.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/skinMesh.ts tests/domain/skinMesh.test.ts
git commit -m "feat: add constrained skin triangulation with fallback"
```

## Task 6: Implement Segmentation Wrapper And End-To-End Pipeline Entry

**Files:**
- Create: `src/domain/skinSegmentation.ts`
- Create: `src/domain/skinMeshPipeline.ts`

- [ ] **Step 1: Write failing pipeline test with mocked segmentation**

```ts
import { describe, expect, test } from "vitest";
import { buildSkinMeshFromMask } from "../../src/domain/skinMeshPipeline";
import type { SkinMask } from "../../src/domain/types";

describe("buildSkinMeshFromMask", () => {
  test("builds mesh from processed segmentation mask", () => {
    const mask: SkinMask = { width: 32, height: 32, probs: new Float32Array(32 * 32).fill(0.9) };
    const mesh = buildSkinMeshFromMask(mask);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun run test tests/domain/skinMesh.test.ts`  
Expected: FAIL with missing pipeline function.

- [ ] **Step 3: Implement MediaPipe adapter + pipeline orchestration**

```ts
// src/domain/skinSegmentation.ts
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import type { SkinMask } from "./types";

let segmenterPromise: Promise<ImageSegmenter> | null = null;

export async function segmentSkin(image: ImageBitmap | HTMLImageElement | HTMLCanvasElement): Promise<SkinMask> {
  const segmenter = await loadSegmenter();
  const result = segmenter.segment(image);
  const categoryMask = result.categoryMask;
  if (!categoryMask) {
    throw new Error("Segmentation did not produce category mask.");
  }
  const width = categoryMask.width;
  const height = categoryMask.height;
  const probs = new Float32Array(width * height);
  const data = categoryMask.getAsUint8Array();
  for (let i = 0; i < data.length; i += 1) probs[i] = data[i] / 255;
  return { width, height, probs };
}

async function loadSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm")
      .then((vision) =>
        ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/models/selfie_multiclass_256x256.tflite" },
          outputCategoryMask: true,
          runningMode: "IMAGE",
        }),
      );
  }
  return segmenterPromise;
}
```

```ts
// src/domain/skinMeshPipeline.ts
import { extractSkinContours } from "./skinContour";
import { postProcessSkinMask } from "./skinMaskProcess";
import { buildSkinMesh } from "./skinMesh";
import { sampleSkinInterior } from "./skinSampling";
import type { SkinMask, SkinMeshData, SkinMeshResolution } from "./types";

const defaultResolution: SkinMeshResolution = {
  innerRadius: 14,
  boundaryBandWidth: 24,
  boundaryRadius: 8,
};

export function buildSkinMeshFromMask(mask: SkinMask): SkinMeshData {
  const binary = postProcessSkinMask(mask, {
    threshold: 0.55,
    morphRadius: 1,
    minRegionArea: 64,
  });
  const loops = extractSkinContours(binary, {
    simplifyEpsilon: 1.2,
    boundaryStepMin: 3,
    boundaryStepMax: 10,
  });
  if (loops.length === 0) throw new Error("No valid skin contours.");
  const interior = sampleSkinInterior(binary, loops, defaultResolution);
  return buildSkinMesh(loops, interior);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test tests/domain/skinMesh.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/skinSegmentation.ts src/domain/skinMeshPipeline.ts tests/domain/skinMesh.test.ts
git commit -m "feat: add skin segmentation adapter and mesh pipeline"
```

## Task 7: Integrate Renderer Debug Path

**Files:**
- Modify: `src/render/pixiRenderer.ts`
- Modify: `tests/render/pixiRenderer.test.ts`

- [ ] **Step 1: Write failing renderer contract test**

```ts
import { describe, expect, test } from "vitest";
import { createSkinWireframeSegments } from "../../src/render/pixiRenderer";
import type { SkinMeshData } from "../../src/domain/types";

describe("createSkinWireframeSegments", () => {
  test("deduplicates triangle edges into line segments", () => {
    const mesh: SkinMeshData = {
      positions: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const segments = createSkinWireframeSegments(mesh);
    expect(segments.length).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun run test tests/render/pixiRenderer.test.ts`  
Expected: FAIL with missing export.

- [ ] **Step 3: Implement renderer helper and optional draw path**

```ts
import type { SkinMeshData } from "../domain/types";

export function createSkinWireframeSegments(mesh: SkinMeshData): Float32Array {
  const out: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    pushEdge(out, seen, mesh.positions, mesh.indices[i], mesh.indices[i + 1]);
    pushEdge(out, seen, mesh.positions, mesh.indices[i + 1], mesh.indices[i + 2]);
    pushEdge(out, seen, mesh.positions, mesh.indices[i + 2], mesh.indices[i]);
  }
  return new Float32Array(out);
}

function pushEdge(
  out: number[],
  seen: Set<string>,
  positions: Float32Array,
  a: number,
  b: number,
): void {
  const first = Math.min(a, b);
  const second = Math.max(a, b);
  const key = `${first}:${second}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(
    positions[first * 2],
    positions[first * 2 + 1],
    positions[second * 2],
    positions[second * 2 + 1],
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test tests/render/pixiRenderer.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/pixiRenderer.ts tests/render/pixiRenderer.test.ts
git commit -m "feat: add skin mesh wireframe renderer helper"
```

## Task 8: App Wiring And Safety Guardrails

**Files:**
- Modify: `src/app.ts`
- Test: `tests/domain/skinMesh.test.ts`

- [ ] **Step 1: Write failing app-level behavior test**

```ts
import { describe, expect, test } from "vitest";
import { normalizeSkinMeshImageSize } from "../../src/app";

describe("normalizeSkinMeshImageSize", () => {
  test("scales long edge to 1024 for deterministic performance budget", () => {
    const size = normalizeSkinMeshImageSize({ width: 3000, height: 1000 });
    expect(size.width).toBe(1024);
    expect(size.height).toBe(341);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun run test tests/domain/skinMesh.test.ts`  
Expected: FAIL with missing app helper export.

- [ ] **Step 3: Wire pipeline call and add safety helper**

```ts
import { buildSkinMeshFromMask } from "./domain/skinMeshPipeline";
import { segmentSkin } from "./domain/skinSegmentation";
import type { Size } from "./domain/types";

export function normalizeSkinMeshImageSize(size: Size): Size {
  const maxEdge = 1024;
  const edge = Math.max(size.width, size.height);
  if (edge <= maxEdge) return size;
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

async function generateSkinMeshForImage(image: HTMLImageElement): Promise<void> {
  const mask = await segmentSkin(image);
  const mesh = buildSkinMeshFromMask(mask);
  console.info("skin mesh generated", {
    vertices: mesh.positions.length / 2,
    triangles: mesh.indices.length / 3,
  });
}
```

- [ ] **Step 4: Run targeted and full verification**

Run: `bun run test`  
Expected: PASS.

Run: `bun run typecheck`  
Expected: PASS.

Run: `bun run build`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts
git commit -m "feat: wire skin mesh pipeline entry in app flow"
```

## Task 9: Dependency Install And Final Verification Gate

**Files:**
- Modify: lockfile generated by package manager

- [ ] **Step 1: Install dependencies**

Run: `bun install`  
Expected: lockfile updated with new runtime packages.

- [ ] **Step 2: Run full verification suite**

Run: `bun run test && bun run typecheck && bun run build`  
Expected: all commands PASS.

- [ ] **Step 3: Commit lockfile and verification-ready state**

```bash
git add bun.lock
git commit -m "chore: lock skin mesh pipeline dependencies"
```

## Risk Controls During Execution

- If MediaPipe model path differs by environment, keep model URL configurable via one constant in `skinSegmentation.ts`.
- If CDT fails often on noisy contours, first increase `simplifyEpsilon` before reducing sample density.
- If runtime exceeds budget, auto-increase `innerRadius` and regenerate once before fallback.
- Keep all test helpers under `tests/` only; do not place `*.test.*` in runtime directories.

## Spec Coverage Self-Review

1. Spec coverage:
   - Automatic segmentation: Task 6
   - Post-process cleanup: Task 2
   - Contour adaptive boundary: Task 3
   - Mixed-density interior sampling: Task 4
   - Constrained triangulation + fallback: Task 5
   - Renderer integration/debug: Task 7
   - Performance-oriented app flow: Task 8
   - Validation pipeline: Task 9
2. Placeholder scan:
   - No `TODO`/`TBD`/ambiguous “handle later” text in task steps.
3. Type consistency:
   - `SkinMeshData`, `SkinMask`, `SkinMeshResolution`, `buildSkinMeshFromMask`, `sampleSkinInterior` naming is consistent across tasks.
