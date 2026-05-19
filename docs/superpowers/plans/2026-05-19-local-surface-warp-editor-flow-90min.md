# Local Surface Warp Editor Flow 90-Minute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a 90-minute MVP that fixes body/tattoo edit-remove-retry flows and introduces geometry-first local surface descriptors with an optional shading geometry assist switch.

**Architecture:** Keep the existing Pixi/Fabric render path stable for this slice, but route local surface analysis through new descriptor and shading-assist domain modules. Store source canvases and edit state for body/tattoo assets so the UI can reopen modals without requiring file re-selection. Shading assist only changes surface descriptor/debug output and does not affect tattoo color blending.

**Tech Stack:** TypeScript, Vite, Vitest, Pixi.js, Fabric, Cropper.js, existing skin mask/mesh pipeline.

---

## Time Box And Scope

**Maximum development time:** 90 minutes.

This plan intentionally does not implement the full Pixi mesh UV remap from the design spec. That renderer change is larger than the time box. The MVP prepares the data and workflow foundations, then keeps the existing normal texture renderer as a temporary execution path fed by the new descriptor.

**Stop after Task 5 if 90 minutes is reached.** Do not start renderer UV remap work in this session.

## File Structure

- Modify `src/domain/types.ts`
  - Add local surface descriptor and shading debug types.
  - Expand `BodySurfaceAnalysisDebugState` to include proxy/shading fields while preserving current debug fields.
- Create `src/domain/shadingGeometryAssist.ts`
  - Extract low-frequency luminance from the body source canvas.
  - Estimate local shading gradient and confidence.
  - Return bounded assist debug and curvature multiplier.
- Create `src/domain/localSurfaceDescriptor.ts`
  - Compute tattoo-local geometry descriptor from mask, mesh, placement rect, tattoo bounds, and optional shading assist.
  - Keep geometry deterministic when assist is disabled.
- Modify `src/domain/localMeshSurface.ts`
  - Use `resolveLocalSurfaceDescriptor` to choose local bounds, axis, curvature strength, and debug fields.
  - Keep existing `SurfaceFieldData` output to avoid renderer rewrite in this time box.
- Modify `src/appMarkup.ts`
  - Add Body/Tattoo action buttons and `光影曲面辅助` checkbox.
- Modify `src/app.ts`
  - Track new asset lifecycle state.
  - Wire edit/remove actions and shading assist state.
- Modify `src/appUploadWorkflow.ts`
  - Store tattoo source canvas, file name, crop rect, selected mode.
  - Add edit/remove functions.
  - Clear file input value after processing so same-file upload works.
- Modify `src/appBodyUploadWorkflow.ts`
  - Store body source canvas/file name.
  - Add edit/remove body functions.
- Modify `src/editor/uploadConfirmModal.ts`
  - Accept initial crop/mode and return cropRect.
- Tests:
  - Create `tests/domain/localSurfaceDescriptor.test.ts`
  - Create `tests/domain/shadingGeometryAssist.test.ts`
  - Modify `tests/appUploadQueue.test.ts`
  - Modify `tests/appBodyUploadWorkflow.test.ts`
  - Modify `tests/app.test.ts`

---

### Task 1: Add Local Surface Descriptor Types

**Files:**
- Modify: `src/domain/types.ts`
- Test: `tests/domain/localSurfaceDescriptor.test.ts`

- [ ] **Step 1: Write the failing descriptor type smoke test**

Create `tests/domain/localSurfaceDescriptor.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { resolveLocalSurfaceDescriptor } from "../../src/domain/localSurfaceDescriptor";
import type { SkinMask, SkinMeshData } from "../../src/domain/types";

function fullMask(width = 120, height = 120): SkinMask {
  return { width, height, probabilities: new Float32Array(width * height).fill(1) };
}

function verticalMesh(): SkinMeshData {
  return {
    positions: new Float32Array([
      50, 10, 70, 10,
      48, 60, 72, 60,
      50, 110, 70, 110,
    ]),
    indices: new Uint32Array([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]),
  };
}

describe("resolveLocalSurfaceDescriptor", () => {
  test("classifies a narrow local patch as an elliptical cylinder", () => {
    const descriptor = resolveLocalSurfaceDescriptor({
      mask: fullMask(),
      mesh: verticalMesh(),
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      stageSize: { width: 120, height: 120 },
      tattooBounds: { x: 45, y: 32, width: 30, height: 48 },
    });

    expect(descriptor.source).toBe("geometry");
    expect(descriptor.proxy).toBe("ellipticalCylinder");
    expect(descriptor.axis.direction.y).toBe(1);
    expect(descriptor.curvature.acrossAxis).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/domain/localSurfaceDescriptor.test.ts`

Expected: FAIL with module not found for `src/domain/localSurfaceDescriptor`.

- [ ] **Step 3: Add descriptor types**

Modify `src/domain/types.ts` by appending:

```ts
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
```

Update `BodySurfaceAnalysisDebugState` to:

```ts
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
```

- [ ] **Step 4: Add minimal descriptor implementation**

Create `src/domain/localSurfaceDescriptor.ts`:

```ts
import type {
  LocalSurfaceDescriptor,
  Point,
  Rect,
  ShadingGeometryAssistInput,
  Size,
  SkinMask,
  SkinMeshData,
  SurfaceAxis,
} from "./types";

export interface LocalSurfaceDescriptorInput {
  mask: SkinMask;
  mesh: SkinMeshData;
  placementRect: Rect;
  tattooBounds: Rect;
  stageSize: Size;
  shadingAssist?: ShadingGeometryAssistInput;
}

export function resolveLocalSurfaceDescriptor(input: LocalSurfaceDescriptorInput): LocalSurfaceDescriptor {
  const padding = Math.max(input.tattooBounds.width, input.tattooBounds.height) * 0.75;
  const searchBounds = expandRect(input.tattooBounds, padding);
  const vertices = collectVerticesInRect(input.mesh, searchBounds);

  if (vertices.length < 3) {
    return createInsufficientDescriptor(searchBounds);
  }

  const localBounds = boundsOfPoints(vertices);
  const axis = createLocalAxis(localBounds);
  const localWidth = Math.max(1, Math.min(localBounds.width, localBounds.height));
  const aspect = Math.max(localBounds.width, localBounds.height) / localWidth;
  const proxy = aspect >= 1.45 ? "ellipticalCylinder" : "curvedPlane";
  const edgeTurn = estimateEdgeTurn(input.tattooBounds, localBounds);
  const acrossAxis = clamp(0.22 + edgeTurn * 0.42 + (proxy === "ellipticalCylinder" ? 0.12 : 0), 0.08, 0.86);

  // WHY: 2D mask/mesh 只能稳定给出局部宽度与边界距离，不能证明真实人体曲率。
  // TRADE-OFF: 先输出保守 proxy descriptor，后续 renderer 可用同一接口替换为 UV/mesh remap。
  return {
    source: "geometry",
    proxy,
    axis,
    localBounds,
    localWidth,
    edgeTurn,
    curvature: {
      acrossAxis,
      alongAxis: proxy === "ellipticalCylinder" ? 0.04 : 0.1,
    },
    confidence: clamp(0.48 + edgeTurn * 0.24 + Math.min(aspect, 3) * 0.06, 0, 1),
  };
}

function collectVerticesInRect(mesh: SkinMeshData, rect: Rect): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < mesh.positions.length; index += 2) {
    const point = { x: mesh.positions[index], y: mesh.positions[index + 1] };
    if (pointInsideRect(point, rect)) {
      points.push(point);
    }
  }
  return points;
}

function createInsufficientDescriptor(bounds: Rect): LocalSurfaceDescriptor {
  return {
    source: "insufficient",
    proxy: "genericEdgeTurn",
    axis: createLocalAxis(bounds),
    localBounds: bounds,
    localWidth: Math.max(1, Math.min(bounds.width, bounds.height)),
    edgeTurn: 0,
    curvature: { acrossAxis: 0, alongAxis: 0 },
    confidence: 0,
  };
}

function expandRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function boundsOfPoints(points: Point[]): Rect {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function createLocalAxis(bounds: Rect): SurfaceAxis {
  const isVertical = bounds.height >= bounds.width;
  return {
    origin: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    direction: isVertical ? { x: 0, y: 1 } : { x: 1, y: 0 },
    length: isVertical ? bounds.height : bounds.width,
  };
}

function estimateEdgeTurn(tattooBounds: Rect, localBounds: Rect): number {
  const center = {
    x: tattooBounds.x + tattooBounds.width / 2,
    y: tattooBounds.y + tattooBounds.height / 2,
  };
  const left = center.x - localBounds.x;
  const right = localBounds.x + localBounds.width - center.x;
  const top = center.y - localBounds.y;
  const bottom = localBounds.y + localBounds.height - center.y;
  const edgeDistance = Math.max(0, Math.min(left, right, top, bottom));
  const radius = Math.max(1, Math.min(localBounds.width, localBounds.height) * 0.5);
  return 1 - clamp(edgeDistance / radius, 0, 1);
}

function pointInsideRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test tests/domain/localSurfaceDescriptor.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/types.ts src/domain/localSurfaceDescriptor.ts tests/domain/localSurfaceDescriptor.test.ts
git commit -m "feat: add local surface descriptor"
```

---

### Task 2: Add Shading Geometry Assist Domain Module

**Files:**
- Create: `src/domain/shadingGeometryAssist.ts`
- Modify: `src/domain/localSurfaceDescriptor.ts`
- Test: `tests/domain/shadingGeometryAssist.test.ts`

- [ ] **Step 1: Write failing shading assist tests**

Create `tests/domain/shadingGeometryAssist.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { resolveShadingGeometryAssist } from "../../src/domain/shadingGeometryAssist";

describe("resolveShadingGeometryAssist", () => {
  test("returns disabled debug when the switch is off", () => {
    const result = resolveShadingGeometryAssist({
      enabled: false,
      sourceCanvas: createGradientCanvas(),
      localBounds: { x: 0, y: 0, width: 20, height: 10 },
      crossAxis: { x: 1, y: 0 },
    });

    expect(result.debug).toEqual({
      enabled: false,
      used: false,
      confidence: 0,
      agreement: 0,
      appliedStrength: 0,
      reason: "disabled",
    });
    expect(result.curvatureMultiplier).toBe(1);
  });

  test("applies bounded curvature assist when shading aligns with geometry", () => {
    const result = resolveShadingGeometryAssist({
      enabled: true,
      sourceCanvas: createGradientCanvas(),
      localBounds: { x: 0, y: 0, width: 20, height: 10 },
      crossAxis: { x: 1, y: 0 },
      maxAdjustmentRatio: 0.25,
    });

    expect(result.debug.used).toBe(true);
    expect(result.debug.reason).toBe("used");
    expect(result.curvatureMultiplier).toBeGreaterThan(1);
    expect(result.curvatureMultiplier).toBeLessThanOrEqual(1.25);
  });
});

function createGradientCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 20;
  canvas.height = 10;
  vi.spyOn(canvas, "getContext").mockReturnValue({
    getImageData: vi.fn(() => {
      const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const index = (y * canvas.width + x) * 4;
          const value = Math.round((x / (canvas.width - 1)) * 255);
          data[index] = value;
          data[index + 1] = value;
          data[index + 2] = value;
          data[index + 3] = 255;
        }
      }
      return { width: canvas.width, height: canvas.height, data } as ImageData;
    }),
  } as unknown as CanvasRenderingContext2D);
  return canvas;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/domain/shadingGeometryAssist.test.ts`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement shading assist**

Create `src/domain/shadingGeometryAssist.ts`:

```ts
import type { Rect, ShadingGeometryAssistDebug, Vector2 } from "./types";

export interface ResolveShadingGeometryAssistInput {
  enabled: boolean;
  sourceCanvas?: HTMLCanvasElement;
  localBounds: Rect;
  crossAxis: Vector2;
  maxAdjustmentRatio?: number;
}

export interface ShadingGeometryAssistResult {
  curvatureMultiplier: number;
  debug: ShadingGeometryAssistDebug;
}

export function resolveShadingGeometryAssist(
  input: ResolveShadingGeometryAssistInput,
): ShadingGeometryAssistResult {
  if (!input.enabled || !input.sourceCanvas) {
    return disabledResult("disabled");
  }

  const context = input.sourceCanvas.getContext("2d");
  if (!context) {
    return disabledResult("low-confidence");
  }

  const bounds = clampBounds(input.localBounds, input.sourceCanvas.width, input.sourceCanvas.height);
  if (bounds.width < 4 || bounds.height < 4) {
    return disabledResult("low-confidence");
  }

  const image = context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
  const gradient = estimateLuminanceGradient(image.data, bounds.width, bounds.height);
  const gradientLength = Math.hypot(gradient.x, gradient.y);
  const confidence = clamp(gradientLength / 80, 0, 1);
  const crossLength = Math.hypot(input.crossAxis.x, input.crossAxis.y) || 1;
  const agreement = Math.abs((gradient.x * input.crossAxis.x + gradient.y * input.crossAxis.y) / (gradientLength * crossLength || 1));

  if (confidence < 0.18) {
    return disabledResult("low-confidence", confidence, agreement);
  }

  if (agreement < 0.35) {
    return disabledResult("geometry-conflict", confidence, agreement);
  }

  const maxAdjustmentRatio = clamp(input.maxAdjustmentRatio ?? 0.25, 0, 0.3);
  const appliedStrength = maxAdjustmentRatio * confidence * agreement;

  // WHY: 单张图光影无法唯一反推出真实法线，只能作为与几何方向一致时的弱投票。
  // TRADE-OFF: 有效照片上的提升会被限制，但能避免纹理/阴影把曲面方向带偏。
  return {
    curvatureMultiplier: 1 + appliedStrength,
    debug: {
      enabled: true,
      used: true,
      confidence,
      agreement,
      appliedStrength,
      reason: "used",
    },
  };
}

function estimateLuminanceGradient(data: Uint8ClampedArray, width: number, height: number): Vector2 {
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  let halfWidthSamples = 0;
  let halfHeightSamples = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const luminance = readLuminance(data, y * width + x);
      if (x < width / 2) {
        left += luminance;
        halfWidthSamples += 1;
      } else {
        right += luminance;
      }
      if (y < height / 2) {
        top += luminance;
        halfHeightSamples += 1;
      } else {
        bottom += luminance;
      }
    }
  }

  return {
    x: right / Math.max(1, width * height - halfWidthSamples) - left / Math.max(1, halfWidthSamples),
    y: bottom / Math.max(1, width * height - halfHeightSamples) - top / Math.max(1, halfHeightSamples),
  };
}

function readLuminance(data: Uint8ClampedArray, pixelIndex: number): number {
  const index = pixelIndex * 4;
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

function clampBounds(rect: Rect, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const x = clamp(Math.floor(rect.x), 0, Math.max(0, width - 1));
  const y = clamp(Math.floor(rect.y), 0, Math.max(0, height - 1));
  const right = clamp(Math.ceil(rect.x + rect.width), x + 1, width);
  const bottom = clamp(Math.ceil(rect.y + rect.height), y + 1, height);
  return { x, y, width: right - x, height: bottom - y };
}

function disabledResult(
  reason: ShadingGeometryAssistDebug["reason"],
  confidence = 0,
  agreement = 0,
): ShadingGeometryAssistResult {
  return {
    curvatureMultiplier: 1,
    debug: {
      enabled: reason !== "disabled",
      used: false,
      confidence,
      agreement,
      appliedStrength: 0,
      reason,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
```

- [ ] **Step 4: Wire shading assist into descriptor**

Modify `src/domain/localSurfaceDescriptor.ts`:

```ts
import { resolveShadingGeometryAssist } from "./shadingGeometryAssist";
```

Inside `resolveLocalSurfaceDescriptor`, before returning the geometry descriptor:

```ts
  const normalAxis = { x: -axis.direction.y, y: axis.direction.x };
  const shading = resolveShadingGeometryAssist({
    enabled: Boolean(input.shadingAssist?.enabled),
    sourceCanvas: input.shadingAssist?.sourceCanvas,
    localBounds,
    crossAxis: normalAxis,
    maxAdjustmentRatio: input.shadingAssist?.maxAdjustmentRatio,
  });
  const assistedAcrossAxis = clamp(acrossAxis * shading.curvatureMultiplier, 0.08, 0.86);
```

Then return:

```ts
    source: shading.debug.used ? "geometry-shading" : "geometry",
    curvature: {
      acrossAxis: assistedAcrossAxis,
      alongAxis: proxy === "ellipticalCylinder" ? 0.04 : 0.1,
    },
    shading: shading.debug,
```

- [ ] **Step 5: Run tests**

Run: `bun run test tests/domain/shadingGeometryAssist.test.ts tests/domain/localSurfaceDescriptor.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/shadingGeometryAssist.ts src/domain/localSurfaceDescriptor.ts tests/domain/shadingGeometryAssist.test.ts tests/domain/localSurfaceDescriptor.test.ts
git commit -m "feat: add shading geometry assist"
```

---

### Task 3: Route Local Mesh Surface Through Descriptor

**Files:**
- Modify: `src/domain/localMeshSurface.ts`
- Modify: `tests/domain/localMeshSurface.test.ts`

- [ ] **Step 1: Extend local mesh surface tests**

Append to `tests/domain/localMeshSurface.test.ts`:

```ts
  test("exposes proxy and shading debug from local descriptor", () => {
    const result = buildLocalMeshSurface({
      mask: fullMask(),
      mesh: mesh(),
      stageSize: { width: 120, height: 120 },
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      tattooBounds: { x: 35, y: 20, width: 54, height: 80 },
      shadingAssist: { enabled: false },
    });

    expect(result.debug.source).toBe("local-mesh");
    expect(result.debug.proxy).toBeDefined();
    expect(result.debug.shading?.reason).toBe("disabled");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/domain/localMeshSurface.test.ts`

Expected: FAIL because `LocalMeshSurfaceInput` has no `shadingAssist` and debug lacks proxy/shading.

- [ ] **Step 3: Update `LocalMeshSurfaceInput` and implementation**

Modify imports in `src/domain/localMeshSurface.ts`:

```ts
import { resolveLocalSurfaceDescriptor } from "./localSurfaceDescriptor";
import type {
  BodySurfaceAnalysisDebugState,
  Point,
  Rect,
  ShadingGeometryAssistInput,
  Size,
  SkinMask,
  SkinMeshData,
  SurfaceAxis,
  SurfaceFieldData,
} from "./types";
```

Add to `LocalMeshSurfaceInput`:

```ts
  shadingAssist?: ShadingGeometryAssistInput;
```

Replace descriptor setup in `buildLocalMeshSurface` with:

```ts
  const descriptor = resolveLocalSurfaceDescriptor({
    mask: input.mask,
    mesh: input.mesh,
    placementRect: input.placementRect,
    stageSize: input.stageSize,
    tattooBounds: input.tattooBounds,
    shadingAssist: input.shadingAssist,
  });

  if (descriptor.source === "insufficient") {
    const surfaceField = createFlatSurface(input.stageSize);
    return {
      surfaceField,
      debug: {
        source: "insufficient-mesh",
        confidence: 0,
        patchBounds: descriptor.localBounds,
        proxy: descriptor.proxy,
        edgeTurn: descriptor.edgeTurn,
        curvature: descriptor.curvature,
        shading: descriptor.shading,
        normalStats: surfaceField.normalStats,
        warning: "insufficient local mesh",
      },
    };
  }

  const surfaceField = buildNormalField({
    mask: input.mask,
    stageSize: input.stageSize,
    placementRect: input.placementRect,
    tattooBounds: input.tattooBounds,
    localBounds: descriptor.localBounds,
    axis: descriptor.axis,
    acrossAxisCurvature: descriptor.curvature.acrossAxis,
  });
```

Update return debug:

```ts
      confidence: descriptor.confidence,
      axis: descriptor.axis,
      patchBounds: descriptor.localBounds,
      proxy: descriptor.proxy,
      edgeTurn: descriptor.edgeTurn,
      curvature: descriptor.curvature,
      shading: descriptor.shading,
      normalStats: surfaceField.normalStats,
```

Add `acrossAxisCurvature` to `buildNormalField` input and replace:

```ts
const strength = clamp(0.31 + (1 - edgeRatio) * 0.3, 0.2, safeNormalXYLimit);
```

with:

```ts
const strength = clamp(input.acrossAxisCurvature + (1 - edgeRatio) * 0.16, 0.12, safeNormalXYLimit);
```

Do not delete helper functions unless TypeScript reports them unused.

- [ ] **Step 4: Run tests**

Run: `bun run test tests/domain/localMeshSurface.test.ts tests/domain/localSurfaceDescriptor.test.ts tests/domain/shadingGeometryAssist.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/localMeshSurface.ts tests/domain/localMeshSurface.test.ts
git commit -m "feat: route local surface through descriptor"
```

---

### Task 4: Add Tattoo Edit, Remove, And Same-File Retry

**Files:**
- Modify: `src/editor/uploadConfirmModal.ts`
- Modify: `src/appUploadWorkflow.ts`
- Modify: `src/appMarkup.ts`
- Modify: `src/app.ts`
- Modify: `tests/appUploadQueue.test.ts`

- [ ] **Step 1: Extend modal result and input**

Modify `src/editor/uploadConfirmModal.ts`:

```ts
export interface UploadConfirmResult {
  canvas: HTMLCanvasElement;
  mode: UploadProcessingMode;
  cropRect: CropRect;
  fallbackFrom?: UploadProcessingMode;
}

export interface UploadConfirmModalInput {
  fileName: string;
  initialMode: UploadProcessingMode;
  options: ProcessedTattooOption[];
  initialCropRect?: CropRect;
  cropCanvas?: (source: HTMLCanvasElement, crop: CropRect) => HTMLCanvasElement;
}
```

Change `renderSelectedOption()` initial crop call to:

```ts
    renderSelectedOption(input.initialCropRect);
```

In Apply, return:

```ts
        close({ canvas, mode, cropRect, fallbackFrom });
```

- [ ] **Step 2: Write failing workflow tests for same-file retry and remove**

Append to `tests/appUploadQueue.test.ts` inside `describe("installUploadWorkflow", ...)`:

```ts
  test("clears file input value after handling so the same file can be selected again", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const tattooUploadInput = document.createElement("input");
    const statusLabel = document.createElement("div");
    const confirmedCanvas = createCanvasStub(320, 240);

    installImageDecodeStubs(320, 240);
    installCanvasDocumentStub();
    openUploadConfirmModal.mockResolvedValue({ canvas: confirmedCanvas, mode: "original", cropRect: { x: 0, y: 0, width: 320, height: 240 } });

    installUploadWorkflow({
      state: createWorkflowState(),
      elements: { tattooUploadInput, statusLabel, editTattooButton: document.createElement("button"), removeTattooButton: document.createElement("button") },
      fabric: createFabricStub(),
      initialTransform: transform,
      renderTattoo: vi.fn(),
      syncPanelFromTransform: vi.fn(),
    });

    setInputFiles(tattooUploadInput, [new File(["image"], "same.png", { type: "image/png" })]);
    tattooUploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(statusLabel.textContent).toBe("applied tattoo (original)"));

    expect(tattooUploadInput.value).toBe("");
  });

  test("remove tattoo clears fabric, state, and render output", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const tattooUploadInput = document.createElement("input");
    const editTattooButton = document.createElement("button");
    const removeTattooButton = document.createElement("button");
    const statusLabel = document.createElement("div");
    const fabric = createFabricStub();
    const state = createWorkflowState();
    const renderTattoo = vi.fn();

    installUploadWorkflow({
      state,
      elements: { tattooUploadInput, statusLabel, editTattooButton, removeTattooButton },
      fabric,
      initialTransform: transform,
      renderTattoo,
      syncPanelFromTransform: vi.fn(),
    });

    removeTattooButton.click();

    expect(fabric.clearTattoo).toHaveBeenCalled();
    expect(state.tattooAsset).toBeNull();
    expect(renderTattoo).toHaveBeenCalled();
    expect(statusLabel.textContent).toBe("Upload tattoo to enable transform controls");
  });
```

- [ ] **Step 3: Update app markup**

Modify tattoo upload block in `src/appMarkup.ts`:

```html
          <div class="action-row">
            <button id="editTattoo" type="button" disabled>Edit crop</button>
            <button id="removeTattoo" type="button" disabled>Remove</button>
          </div>
```

Place it immediately after the tattoo file-drop label.

- [ ] **Step 4: Update workflow types and handlers**

Modify `UploadWorkflowState.tattooAsset` in `src/appUploadWorkflow.ts`:

```ts
  tattooAsset: {
    texture: Texture;
    size: Size;
    dataUrl: string;
    sourceCanvas: HTMLCanvasElement;
    fileName: string;
    selectedMode: UploadProcessingMode;
    cropRect: CropRect;
  } | null;
```

Modify `UploadWorkflowElements`:

```ts
  editTattooButton: HTMLButtonElement;
  removeTattooButton: HTMLButtonElement;
```

Add handlers in `installUploadWorkflow`:

```ts
  input.elements.editTattooButton.addEventListener("click", () => {
    if (!input.state.tattooAsset) {
      return;
    }
    const asset = input.state.tattooAsset;
    void updateTattooFromSource(asset.fileName, asset.sourceCanvas, input, latestUploadRequestId + 1, isCurrentRequest, runCurrentFabricUpdate, {
      initialMode: asset.selectedMode,
      initialCropRect: asset.cropRect,
    });
  });

  input.elements.removeTattooButton.addEventListener("click", () => {
    clearCurrentTattoo(input, latestUploadRequestId + 1, () => true);
    latestUploadRequestId += 1;
    input.elements.tattooUploadInput.value = "";
  });
```

In upload `change`, after reading file:

```ts
    input.elements.tattooUploadInput.value = "";
```

Refactor `updateUploadedTattoo` into two functions:

```ts
async function updateUploadedTattoo(...) {
  const originalCanvas = await fileToCanvas(uploadedFile);
  const normalizedCanvas = normalizeTattooCanvas(originalCanvas, tattooUploadMaxEdge);
  await updateTattooFromSource(uploadedFile.name, normalizedCanvas, input, requestId, isCurrentRequest, runCurrentFabricUpdate);
}
```

Add:

```ts
async function updateTattooFromSource(
  fileName: string,
  sourceCanvas: HTMLCanvasElement,
  input: UploadWorkflowInput,
  requestId: number,
  isCurrentRequest: IsCurrentRequest,
  runCurrentFabricUpdate: RunCurrentFabricUpdate,
  editState?: { initialMode: UploadProcessingMode; initialCropRect: CropRect },
): Promise<void> {
  const startTransformRevision = input.state.transformRevision;
  input.elements.statusLabel.textContent = "processing tattoo upload...";
  const processedOptions = createProcessedOptionsFromCanvas(sourceCanvas);
  const confirmed = await openUploadConfirmModal({
    fileName,
    initialMode: editState?.initialMode ?? getInitialUploadMode(processedOptions.options),
    initialCropRect: editState?.initialCropRect,
    options: processedOptions.options,
  });

  if (!isCurrentRequest(requestId)) {
    return;
  }

  if (!confirmed) {
    input.elements.statusLabel.textContent = "tattoo upload cancelled";
    return;
  }

  const canvas = confirmed.canvas;
  const dataUrl = canvas.toDataURL("image/png");
  let committedTransform: TattooTransform | null = null;

  const didUpdateFabric = await runCurrentFabricUpdate(
    requestId,
    (shouldCommit) => input.fabric.setImage(
      dataUrl,
      getUploadCommitTransform(input.state, startTransformRevision),
      shouldCommit,
      () => {
        const nextTransform = getUploadCommitTransform(input.state, startTransformRevision);
        committedTransform = nextTransform;
        return nextTransform;
      },
    ),
  );

  if (!didUpdateFabric || !committedTransform) {
    return;
  }

  input.state.tattooAsset = {
    texture: Texture.from(canvas),
    dataUrl,
    size: { width: canvas.width, height: canvas.height },
    sourceCanvas,
    fileName,
    selectedMode: confirmed.mode,
    cropRect: confirmed.cropRect,
  };
  input.state.tattooTransform = committedTransform;

  if (!isCurrentRequest(requestId)) {
    return;
  }

  input.elements.statusLabel.textContent = confirmed.fallbackFrom
    ? `applied tattoo (${confirmed.fallbackFrom} -> ${confirmed.mode} fallback)`
    : `applied tattoo (${confirmed.mode})`;
  input.syncPanelFromTransform();
  input.renderTattoo();
}
```

Replace `createProcessedOptions(file)` with:

```ts
function createProcessedOptionsFromCanvas(normalizedCanvas: HTMLCanvasElement): ProcessedUploadOptions {
  return {
    options: [
      { mode: "original", label: "Original", canvas: normalizedCanvas },
      { mode: "line-art", label: "Line Art Cleanup", canvas: createLineArtCanvas(normalizedCanvas) },
    ],
  };
}
```

When setting `input.state.tattooAsset`, include:

```ts
      sourceCanvas,
      fileName,
      selectedMode: confirmed.mode,
      cropRect: confirmed.cropRect,
```

- [ ] **Step 5: Wire app elements**

Modify `AppElements` in `src/app.ts`:

```ts
  editTattooButton: HTMLButtonElement;
  removeTattooButton: HTMLButtonElement;
```

Add in `getAppElements()`:

```ts
    editTattooButton: getElement<HTMLButtonElement>("editTattoo"),
    removeTattooButton: getElement<HTMLButtonElement>("removeTattoo"),
```

Pass to `installUploadWorkflow`.

In `syncPanelFromTransform`, add:

```ts
  elements.editTattooButton.disabled = state.tattooAsset === null;
  elements.removeTattooButton.disabled = state.tattooAsset === null;
```

Update initial state `tattooAsset` typing only; no default tattoo asset is needed.

- [ ] **Step 6: Run focused tests**

Run: `bun run test tests/appUploadQueue.test.ts tests/editor/uploadConfirmModal.test.ts tests/app.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/editor/uploadConfirmModal.ts src/appUploadWorkflow.ts src/appMarkup.ts src/app.ts tests/appUploadQueue.test.ts tests/editor/uploadConfirmModal.test.ts tests/app.test.ts
git commit -m "feat: add tattoo edit and remove flow"
```

---

### Task 5: Add Body Edit, Remove, And Shading Assist Toggle

**Files:**
- Modify: `src/appMarkup.ts`
- Modify: `src/app.ts`
- Modify: `src/appBodyUploadWorkflow.ts`
- Modify: `tests/appBodyUploadWorkflow.test.ts`
- Modify: `tests/app.test.ts`

- [ ] **Step 1: Update markup**

In `src/appMarkup.ts`, after body upload label, add:

```html
          <div class="action-row">
            <button id="editBody" type="button">Edit mesh</button>
            <button id="removeBody" type="button">Remove</button>
          </div>
```

In the surface controls group, add:

```html
            <label class="toggle-line">
              <input id="shadingGeometryAssist" type="checkbox" />
              <span>光影曲面辅助</span>
            </label>
```

- [ ] **Step 2: Extend app state and elements**

Modify `AppState` in `src/app.ts`:

```ts
  shadingGeometryAssistEnabled: boolean;
```

Modify `BodySurfaceState` in `src/app.ts` and `src/appBodyUploadWorkflow.ts`:

```ts
  sourceCanvas: HTMLCanvasElement;
  fileName: string;
```

Add elements:

```ts
  editBodyButton: HTMLButtonElement;
  removeBodyButton: HTMLButtonElement;
  shadingGeometryAssistInput: HTMLInputElement;
```

Initialize state:

```ts
    shadingGeometryAssistEnabled: false,
```

Default body state:

```ts
      sourceCanvas: defaultBodyCanvas,
      fileName: "default-placeholder",
```

- [ ] **Step 3: Pass shading assist into local surface refresh**

Modify `refreshLocalSurface` in `src/app.ts`:

```ts
    shadingAssist: {
      enabled: state.shadingGeometryAssistEnabled,
      sourceCanvas: state.bodySurfaceState.sourceCanvas,
      maxAdjustmentRatio: 0.25,
    },
```

In `installTransformControls`, add:

```ts
  elements.shadingGeometryAssistInput.addEventListener("change", () => {
    state.shadingGeometryAssistEnabled = elements.shadingGeometryAssistInput.checked;
    refreshLocalSurface(state, elements, pixi);
  });
```

Update status formatter:

```ts
  const shading = debug.shading?.used
    ? " / shading used"
    : debug.shading?.enabled
      ? ` / shading ${debug.shading.reason}`
      : " / shading off";
  return `Surface: local mesh / ${debug.proxy ?? "proxy"} / warp ${describeWarp(debug.normalStats?.meanNormalXY ?? 0)}${shading} / fit ${formatSurfaceFitStrength(fitStrength)}`;
```

- [ ] **Step 4: Add body edit/remove handlers**

In `installBodyUploadWorkflow`, create a shared `openBodyEditorFromCanvas` function that accepts `fileName`, `sourceCanvas`, and existing params.

Add elements to `BodyUploadElements`:

```ts
  editBodyButton: HTMLButtonElement;
  removeBodyButton: HTMLButtonElement;
```

Handlers:

```ts
  input.elements.editBodyButton.addEventListener("click", () => {
    void openBodyEditorFromCanvas(
      input.state.bodySurfaceState.fileName,
      input.state.bodySurfaceState.sourceCanvas,
      input.state.bodySurfaceState.pipelineParams,
    );
  });

  input.elements.removeBodyButton.addEventListener("click", () => {
    input.resetBodySurface();
  });
```

Add `resetBodySurface` to `BodyUploadWorkflowInput`:

```ts
  resetBodySurface: () => void;
```

In `src/app.ts`, implement:

```ts
function resetBodySurface(state: AppState, pixi: PixiTattooRenderer): void {
  const defaultBodyCanvas = createDefaultBodyCanvas();
  const previousNormalTexture = state.bodySurfaceState.surfaceNormalTexture;
  if (previousNormalTexture) {
    pixi.setSurfaceNormalTexture(null);
    previousNormalTexture.destroy(true);
  }
  state.bodySurfaceState = initializeAppState(defaultBodyCanvas).bodySurfaceState;
}
```

After reset, call `renderBodySurface`, `refreshLocalSurface`, and `renderTattoo`.

In `applyBodySurfaceResult`, store:

```ts
    sourceCanvas: result.sourceCanvas,
    fileName: result.fileName,
```

Extend modal result object passed internally:

```ts
  result: {
    fileName: string;
    sourceCanvas: HTMLCanvasElement;
    params: BodyMeshPipelineParams;
    preview: { mask: SkinMask; mesh: SkinMeshData };
  }
```

- [ ] **Step 5: Update tests**

Append to `tests/appBodyUploadWorkflow.test.ts`:

```ts
  test("edit body reopens modal with stored source canvas and params", async () => {
    const state = createBodyWorkflowState();
    const editBodyButton = document.createElement("button");
    installBodyUploadWorkflow({
      state: state as never,
      elements: {
        bodyUploadInput: document.createElement("input"),
        editBodyButton,
        removeBodyButton: document.createElement("button"),
        statusLabel: document.createElement("div"),
      },
      pixi: { setSurfaceNormalTexture: vi.fn(), setBodyAnalysisDebug: vi.fn() } as never,
      initialTransform: state.tattooTransform,
      setTransform: vi.fn(),
      renderBodySurface: vi.fn(),
      resetBodySurface: vi.fn(),
    });

    editBodyButton.click();

    await vi.waitFor(() => expect(mocks.openBodyUploadModal).toHaveBeenCalledTimes(1));
    expect(mocks.openBodyUploadModal.mock.calls[0][0].sourceCanvas).toBe(state.bodySurfaceState.sourceCanvas);
  });
```

Add helper:

```ts
function createBodyWorkflowState() {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = 64;
  sourceCanvas.height = 32;
  return {
    tattooTransform: { x: 450, y: 310, scale: 0.42, rotation: 0, opacity: 1 },
    bodySurfaceState: {
      texture: { source: { id: "body" } },
      sourceCanvas,
      fileName: "body.png",
      surfaceNormalTexture: null,
      placementRect: { x: 0, y: 0, width: 900, height: 620 },
      sourceSize: { width: 64, height: 32 },
      mask: { width: 2, height: 2, probabilities: new Float32Array(4).fill(1) },
      mesh: createTriangleMesh(64, 32),
      pipelineParams: { ...defaultBodyMeshPipelineParams },
      analysisDebug: null,
      revision: 0,
    },
  };
}
```

- [ ] **Step 6: Run focused tests**

Run: `bun run test tests/appBodyUploadWorkflow.test.ts tests/app.test.ts tests/domain/localMeshSurface.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/appMarkup.ts src/app.ts src/appBodyUploadWorkflow.ts tests/appBodyUploadWorkflow.test.ts tests/app.test.ts
git commit -m "feat: add body edit remove and shading toggle"
```

---

### Task 6: Final Verification And Time-Box Stop

**Files:**
- No source changes unless fixing test failures from Tasks 1-5.

- [ ] **Step 1: Run targeted verification**

Run:

```bash
bun run test tests/domain/localSurfaceDescriptor.test.ts tests/domain/shadingGeometryAssist.test.ts tests/domain/localMeshSurface.test.ts tests/appUploadQueue.test.ts tests/appBodyUploadWorkflow.test.ts tests/app.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build only if at least 10 minutes remain**

Run:

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 4: Manual smoke check if a dev server is already running or time remains**

Run:

```bash
bun run dev --host 127.0.0.1
```

Open local app and verify:

- Tattoo can be uploaded.
- Tattoo can be edited without selecting file again.
- Tattoo can be removed.
- Same file can be selected again.
- Body mesh can be edited.
- Body can be removed to placeholder.
- `光影曲面辅助` toggles status/debug but does not change tattoo color.

- [ ] **Step 5: Commit verification-only fixes**

If verification required small fixes, run `git status --short`, add only the files changed by those fixes, and commit:

```bash
git status --short
git commit -m "fix: stabilize local surface editor flow"
```

---

## Out Of Scope For This 90-Minute Slice

- Full Pixi mesh UV remap execution layer.
- MLS/TPS dependency integration.
- Detailed visual debug overlays for shading gradient arrows.
- Body-part segmentation or Pose reintroduction.
- Tattoo color/light blending.

These are deliberately excluded because the user requested the implementation not exceed 90 minutes.

## Plan Self-Review

- Spec coverage included in this slice:
  - Asset lifecycle: covered by Tasks 4 and 5.
  - Shading assist switch: covered by Tasks 2, 3, and 5.
  - Geometry-first descriptor: covered by Tasks 1 and 3.
  - No tattoo color blending: enforced by implementation location and tests.
- Spec coverage deferred:
  - Full UV/mesh remap renderer. Deferred because it exceeds the 90-minute cap.
- Placeholder scan:
  - No `TBD`, `TODO`, or unspecified test steps.
- Type consistency:
  - `ShadingGeometryAssistDebug`, `LocalSurfaceDescriptor`, and `ShadingGeometryAssistInput` are defined before use.
  - Workflow state fields match the design spec names.
