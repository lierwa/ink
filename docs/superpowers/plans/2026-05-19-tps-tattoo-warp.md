# TPS Tattoo Warp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current weak shader-offset tattoo projection with a real, visible thin-plate-spline warped tattoo mesh that bends the tattoo grid on the body surface.

**Architecture:** Use `@allmaps/transform` `GeneralGcpTransformer` with `thinPlateSpline` to transform a subdivided tattoo-local mesh into stage coordinates. Pixi renders that warped mesh directly with tattoo UVs, body mask clipping, and optional surface lighting; the old Sprite fallback must not cover the warped mesh. A debug warped-grid overlay is required so a human can verify the geometry is actually bending.

**Tech Stack:** TypeScript, Vite, Vitest, Pixi v8 `MeshGeometry`, Fabric controls, `@allmaps/transform` thin plate spline.

---

## References

- `@allmaps/transform` official docs: `GeneralGcpTransformer` transforms `source` to `destination`, and `thinPlateSpline` is described as rubber sheeting with exact control points. https://allmaps.org/docs/packages/transform/
- scikit-image TPS reference example: shows expected non-linear deformation behavior, not just light/shader offset. https://scikit-image.org/docs/stable/auto_examples/transform/plot_tps_deformation.html

## File Structure

- Create `src/domain/tpsTransformer.ts`: small adapter around `@allmaps/transform`, so the rest of the app does not depend directly on Allmaps API names.
- Create `tests/domain/tpsTransformer.test.ts`: verifies TPS exactness at control points and visible non-linear center displacement.
- Create `src/domain/tattooWarpMesh.ts`: builds source control points, destination control points, subdivided warped mesh positions, UVs, indices, and debug grid lines.
- Create `tests/domain/tattooWarpMesh.test.ts`: verifies warped mesh dimensions, UV range, non-linear displacement, and debug grid output.
- Modify `src/domain/types.ts`: add `TattooWarpMeshData`, `TattooWarpDebugLine`, and `TattooWarpDebugState`.
- Modify `src/render/pixiRenderer.ts`: replace tattoo projection mesh path with direct warped tattoo mesh rendering when a warp mesh exists.
- Modify `src/render/pixiDebugGeometry.ts`: draw warped tattoo grid lines when debug is enabled.
- Modify `src/app.ts`: store `tattooWarpMesh`, build it after local surface refresh, render Pixi only after warp mesh is updated, and update status messages.
- Modify `tests/render/pixiRenderer.test.ts`: verify Pixi geometry uses warped positions and tattoo UVs directly.
- Modify `tests/app.test.ts`: verify app state and render order update local surface before rendering tattoo.
- Modify `package.json` and lockfile: add `@allmaps/transform`.

## Acceptance Standard

The implementation is not complete unless all three are true:

1. A test proves a rectangular tattoo mesh warps into non-rectangular stage coordinates using `thinPlateSpline`.
2. Pixi renders the tattoo from warped mesh positions and tattoo UVs, not from the old flat Sprite fallback.
3. The debug overlay can draw warped grid line segments whose middle x/y coordinates are not collinear with their endpoints.

---

### Task 1: Add Thin Plate Spline Adapter

**Files:**
- Modify: `package.json`
- Create: `src/domain/tpsTransformer.ts`
- Test: `tests/domain/tpsTransformer.test.ts`

- [ ] **Step 1: Install the mature TPS library**

Run:

```bash
bun add @allmaps/transform
```

Expected: `package.json` includes `@allmaps/transform` under `dependencies`, and the lockfile updates.

- [ ] **Step 2: Write the failing TPS adapter test**

Create `tests/domain/tpsTransformer.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { createThinPlateSplineTransformer } from "../../src/domain/tpsTransformer";

describe("createThinPlateSplineTransformer", () => {
  test("maps every control point exactly enough for tattoo anchoring", () => {
    const transformer = createThinPlateSplineTransformer([
      { source: { x: 0, y: 0 }, destination: { x: 10, y: 20 } },
      { source: { x: 100, y: 0 }, destination: { x: 120, y: 25 } },
      { source: { x: 0, y: 100 }, destination: { x: 4, y: 130 } },
      { source: { x: 100, y: 100 }, destination: { x: 112, y: 118 } },
      { source: { x: 50, y: 50 }, destination: { x: 66, y: 74 } },
    ]);

    expect(transformer.transform({ x: 0, y: 0 })).toMatchObject({ x: expect.closeTo(10, 5), y: expect.closeTo(20, 5) });
    expect(transformer.transform({ x: 100, y: 0 })).toMatchObject({ x: expect.closeTo(120, 5), y: expect.closeTo(25, 5) });
    expect(transformer.transform({ x: 50, y: 50 })).toMatchObject({ x: expect.closeTo(66, 5), y: expect.closeTo(74, 5) });
  });

  test("creates visible non-linear displacement between edge and center control points", () => {
    const transformer = createThinPlateSplineTransformer([
      { source: { x: 0, y: 0 }, destination: { x: 0, y: 0 } },
      { source: { x: 100, y: 0 }, destination: { x: 100, y: 8 } },
      { source: { x: 0, y: 100 }, destination: { x: 0, y: 100 } },
      { source: { x: 100, y: 100 }, destination: { x: 100, y: 108 } },
      { source: { x: 50, y: 50 }, destination: { x: 58, y: 62 } },
    ]);

    const linearMidpoint = { x: 50, y: 54 };
    const warped = transformer.transform({ x: 50, y: 50 });

    expect(Math.hypot(warped.x - linearMidpoint.x, warped.y - linearMidpoint.y)).toBeGreaterThan(6);
  });
});
```

- [ ] **Step 3: Run the test to verify RED**

Run:

```bash
npm test -- tests/domain/tpsTransformer.test.ts
```

Expected: FAIL with an import error for `../../src/domain/tpsTransformer`.

- [ ] **Step 4: Implement the adapter**

Create `src/domain/tpsTransformer.ts`:

```ts
import { GeneralGcpTransformer } from "@allmaps/transform";
import type { Point } from "./types";

export interface TpsControlPoint {
  source: Point;
  destination: Point;
}

export interface ThinPlateSplineTransformer {
  transform(point: Point): Point;
}

export function createThinPlateSplineTransformer(controlPoints: TpsControlPoint[]): ThinPlateSplineTransformer {
  if (controlPoints.length < 3) {
    throw new Error("Thin plate spline tattoo warp needs at least 3 control points.");
  }

  const transformer = new GeneralGcpTransformer(
    controlPoints.map((point) => ({
      source: [point.source.x, point.source.y],
      destination: [point.destination.x, point.destination.y],
    })),
    "thinPlateSpline",
    { differentHandedness: false },
  );

  return {
    transform(point) {
      const transformed = transformer.transformForward([point.x, point.y]) as [number, number];
      return { x: transformed[0], y: transformed[1] };
    },
  };
}
```

- [ ] **Step 5: Run the adapter test to verify GREEN**

Run:

```bash
npm test -- tests/domain/tpsTransformer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json bun.lock src/domain/tpsTransformer.ts tests/domain/tpsTransformer.test.ts
git commit -m "feat: add tps transformer adapter"
```

Expected: commit succeeds.

---

### Task 2: Build Tattoo Warp Mesh Domain Model

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/tattooWarpMesh.ts`
- Test: `tests/domain/tattooWarpMesh.test.ts`

- [ ] **Step 1: Add warp mesh types**

Modify `src/domain/types.ts` by adding these interfaces after `SkinMeshData`:

```ts
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
```

- [ ] **Step 2: Write the failing warp mesh test**

Create `tests/domain/tattooWarpMesh.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildTattooWarpMesh } from "../../src/domain/tattooWarpMesh";
import type { BodySurfaceAnalysisDebugState, TattooTransform } from "../../src/domain/types";

const transform: TattooTransform = {
  x: 240,
  y: 180,
  scale: 0.5,
  rotation: 0,
  opacity: 1,
};

const surface: BodySurfaceAnalysisDebugState = {
  source: "local-mesh",
  confidence: 0.8,
  axis: {
    origin: { x: 240, y: 180 },
    direction: { x: 0, y: 1 },
    length: 240,
  },
  patchBounds: { x: 120, y: 60, width: 240, height: 260 },
  proxy: "ellipticalCylinder",
  edgeTurn: 0.7,
  curvature: { acrossAxis: 0.72, alongAxis: 0.08 },
  normalStats: { activePixelRatio: 0.25, maxNormalXY: 0.45, meanNormalXY: 0.22 },
};

describe("buildTattooWarpMesh", () => {
  test("builds a subdivided mesh with tattoo uvs and triangle indices", () => {
    const mesh = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      columns: 8,
      rows: 6,
    });

    expect(mesh.positions.length).toBe((8 + 1) * (6 + 1) * 2);
    expect(mesh.uvs.length).toBe(mesh.positions.length);
    expect(mesh.indices.length).toBe(8 * 6 * 6);
    expect(Math.min(...Array.from(mesh.uvs))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...Array.from(mesh.uvs))).toBeLessThanOrEqual(1);
  });

  test("warps the grid enough to be visually different from a flat rectangle", () => {
    const mesh = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      columns: 12,
      rows: 8,
    });

    expect(mesh.stats.maxDisplacementPx).toBeGreaterThan(12);
    expect(mesh.stats.meanDisplacementPx).toBeGreaterThan(3);
    expect(mesh.controlPoints.length).toBeGreaterThanOrEqual(9);
  });

  test("returns debug grid lines for visual verification", () => {
    const mesh = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      columns: 4,
      rows: 3,
    });

    expect(mesh.debugLines.length).toBeGreaterThan(0);
    expect(mesh.debugLines[0]).toMatchObject({
      source: { x: expect.any(Number), y: expect.any(Number) },
      destination: { x: expect.any(Number), y: expect.any(Number) },
    });
  });
});
```

- [ ] **Step 3: Run the test to verify RED**

Run:

```bash
npm test -- tests/domain/tattooWarpMesh.test.ts
```

Expected: FAIL with an import error for `../../src/domain/tattooWarpMesh`.

- [ ] **Step 4: Implement the warp mesh builder**

Create `src/domain/tattooWarpMesh.ts`:

```ts
import { createThinPlateSplineTransformer, type TpsControlPoint } from "./tpsTransformer";
import type { BodySurfaceAnalysisDebugState, Point, Size, TattooTransform, TattooWarpDebugLine, TattooWarpMeshData, Vector2 } from "./types";

export interface TattooWarpMeshInput {
  tattooSize: Size;
  transform: TattooTransform;
  surface: BodySurfaceAnalysisDebugState | null;
  columns?: number;
  rows?: number;
}

export function buildTattooWarpMesh(input: TattooWarpMeshInput): TattooWarpMeshData | null {
  if (!input.surface || input.surface.source !== "local-mesh" || !input.surface.axis || !input.surface.curvature) {
    return null;
  }

  const columns = clampInt(input.columns ?? 24, 2, 64);
  const rows = clampInt(input.rows ?? 32, 2, 96);
  const controlPoints = buildControlPoints(input);
  const transformer = createThinPlateSplineTransformer(controlPoints);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let displacementSum = 0;
  let displacementMax = 0;

  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const source = { x: u * input.tattooSize.width, y: v * input.tattooSize.height };
      const flat = mapTattooSourceToStage(source, input.tattooSize, input.transform);
      const warped = transformer.transform(source);
      const displacement = Math.hypot(warped.x - flat.x, warped.y - flat.y);
      displacementSum += displacement;
      displacementMax = Math.max(displacementMax, displacement);
      positions.push(warped.x, warped.y);
      uvs.push(u, v);
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    controlPoints,
    debugLines: buildDebugLines(input, transformer, columns, rows),
    stats: {
      maxDisplacementPx: displacementMax,
      meanDisplacementPx: displacementSum / Math.max(1, positions.length / 2),
    },
  };
}

function buildControlPoints(input: Required<Pick<TattooWarpMeshInput, "tattooSize" | "transform">> & TattooWarpMeshInput): TpsControlPoint[] {
  const points: TpsControlPoint[] = [];
  const xs = [0, 0.25, 0.5, 0.75, 1];
  const ys = [0, 0.5, 1];

  for (const y of ys) {
    for (const x of xs) {
      const source = { x: x * input.tattooSize.width, y: y * input.tattooSize.height };
      points.push({
        source,
        destination: bendStagePoint(source, input),
      });
    }
  }

  return points;
}

function bendStagePoint(source: Point, input: TattooWarpMeshInput): Point {
  const flat = mapTattooSourceToStage(source, input.tattooSize, input.transform);
  const axis = input.surface?.axis ?? { origin: flat, direction: { x: 0, y: 1 }, length: input.tattooSize.height };
  const normal = normalizeVector({ x: -axis.direction.y, y: axis.direction.x });
  const along = normalizeVector(axis.direction);
  const u = source.x / Math.max(1, input.tattooSize.width);
  const v = source.y / Math.max(1, input.tattooSize.height);
  const across = (u - 0.5) * 2;
  const alongCentered = (v - 0.5) * 2;
  const curvature = input.surface?.curvature?.acrossAxis ?? 0;
  const base = Math.min(input.tattooSize.width, input.tattooSize.height) * input.transform.scale;
  const curvePx = clamp(base * curvature * 0.34, 10, 72);
  const edgeCurl = across * Math.abs(across) * curvePx;
  const belly = (1 - across * across) * curvePx * 0.22;
  const verticalRoll = alongCentered * across * curvePx * 0.18;

  return {
    x: flat.x + normal.x * edgeCurl + normal.x * belly + along.x * verticalRoll,
    y: flat.y + normal.y * edgeCurl + normal.y * belly + along.y * verticalRoll,
  };
}

export function mapTattooSourceToStage(source: Point, tattooSize: Size, transform: TattooTransform): Point {
  const localX = (source.x - tattooSize.width / 2) * transform.scale;
  const localY = (source.y - tattooSize.height / 2) * transform.scale;
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);

  return {
    x: transform.x + localX * cos - localY * sin,
    y: transform.y + localX * sin + localY * cos,
  };
}

function buildDebugLines(input: TattooWarpMeshInput, transformer: { transform(point: Point): Point }, columns: number, rows: number): TattooWarpDebugLine[] {
  const lines: TattooWarpDebugLine[] = [];

  for (let column = 0; column <= columns; column += Math.max(1, Math.floor(columns / 4))) {
    for (let row = 0; row < rows; row += 1) {
      pushDebugLine(lines, input, transformer, column / columns, row / rows, column / columns, (row + 1) / rows);
    }
  }

  for (let row = 0; row <= rows; row += Math.max(1, Math.floor(rows / 4))) {
    for (let column = 0; column < columns; column += 1) {
      pushDebugLine(lines, input, transformer, column / columns, row / rows, (column + 1) / columns, row / rows);
    }
  }

  return lines;
}

function pushDebugLine(
  lines: TattooWarpDebugLine[],
  input: TattooWarpMeshInput,
  transformer: { transform(point: Point): Point },
  u0: number,
  v0: number,
  u1: number,
  v1: number,
): void {
  const source0 = { x: u0 * input.tattooSize.width, y: v0 * input.tattooSize.height };
  const source1 = { x: u1 * input.tattooSize.width, y: v1 * input.tattooSize.height };
  lines.push({ source: source0, destination: transformer.transform(source0) });
  lines.push({ source: source1, destination: transformer.transform(source1) });
}

function normalizeVector(vector: Vector2): Vector2 {
  const length = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / length, y: vector.y / length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}
```

- [ ] **Step 5: Run the warp mesh test to verify GREEN**

Run:

```bash
npm test -- tests/domain/tattooWarpMesh.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/domain/types.ts src/domain/tattooWarpMesh.ts tests/domain/tattooWarpMesh.test.ts
git commit -m "feat: build tps tattoo warp mesh"
```

Expected: commit succeeds.

---

### Task 3: Render Warped Tattoo Mesh in Pixi

**Files:**
- Modify: `src/render/pixiRenderer.ts`
- Test: `tests/render/pixiRenderer.test.ts`

- [ ] **Step 1: Write failing renderer geometry tests**

Append to `tests/render/pixiRenderer.test.ts`:

```ts
describe("warped tattoo mesh geometry", () => {
  test("builds Pixi geometry from warped tattoo positions and tattoo uvs", () => {
    const geometry = createMeshGeometry({
      positions: new Float32Array([10, 20, 110, 25, 12, 140]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    }, { width: 900, height: 620 });

    expect(geometry.getBuffer("aPosition").data).toEqual(new Float32Array([10, 20, 110, 25, 12, 140]));
    expect(geometry.getBuffer("aUV").data).toEqual(new Float32Array([0, 0, 1, 0, 0, 1]));
    expect(geometry.indexBuffer.data).toEqual(new Uint32Array([0, 1, 2]));
  });

  test("shader samples tattoo from mesh uv rather than recomputing a flat rectangle uv", () => {
    expect(tattooProjectionFragmentMain).toContain("vec2 tattooUv = vSurfaceUv");
    expect(tattooProjectionFragmentMain).not.toContain("vec2 localPoint = (vSurfacePoint - uTattooTransform.xy)");
    expect(tattooProjectionFragmentMain).not.toContain("warpedPoint = localPoint");
  });
});
```

- [ ] **Step 2: Run renderer tests to verify RED**

Run:

```bash
npm test -- tests/render/pixiRenderer.test.ts
```

Expected: FAIL because `tattooProjectionFragmentMain` still contains flat rectangle UV math.

- [ ] **Step 3: Modify `PixiTattooState` to carry a warp mesh**

In `src/render/pixiRenderer.ts`, import `TattooWarpMeshData`:

```ts
import type {
  BodySurfaceAnalysisDebugState,
  Rect,
  Size,
  SkinMask,
  SkinMeshData,
  SphereMeshResolution,
  SphereSurface,
  TattooTransform,
  TattooWarpMeshData,
} from "../domain/types";
```

Then change `PixiTattooState`:

```ts
export interface PixiTattooState {
  texture: Texture;
  tattooSize: Size;
  transform: TattooTransform;
  warpMesh: TattooWarpMeshData | null;
}
```

- [ ] **Step 4: Replace projection shader UV math with mesh UV sampling**

Replace `tattooProjectionFragmentMain` with:

```ts
export const tattooProjectionFragmentMain = `
      vec2 tattooUv = vSurfaceUv;
      float surfaceLight = 1.0;

      if (uSurfaceEnabled > 0.5) {
        vec4 encodedNormal = texture(uSurfaceNormalTex, vec2(
          clamp(vSurfacePoint.x / max(uStageSize.x, 1.0), 0.0, 1.0),
          clamp(vSurfacePoint.y / max(uStageSize.y, 1.0), 0.0, 1.0)
        ));

        if (encodedNormal.a > 0.0) {
          vec3 surfaceNormal = normalize(encodedNormal.rgb * 2.0 - 1.0);
          surfaceLight = clamp(dot(surfaceNormal, normalize(vec3(-0.35, -0.25, 0.9))) * 0.38 + 0.72, 0.72, 1.12);
        }
      }

      if (
        tattooUv.x < 0.0 ||
        tattooUv.x > 1.0 ||
        tattooUv.y < 0.0 ||
        tattooUv.y > 1.0
      ) {
        outColor = vec4(0.0);
      } else {
        vec4 tattooColor = texture(uTexture, tattooUv);
        outColor = vec4(tattooColor.rgb * surfaceLight, tattooColor.a * uTattooOpacity);
      }
    `;
```

- [ ] **Step 5: Add `uStageSize` uniform**

Update `TattooShaderResources`:

```ts
uStageSize: { value: Float32Array; type: "vec2<f32>" };
```

Update `TattooShaderResourceInput`:

```ts
stageSize: Size;
```

In `createTattooShaderResources`, add:

```ts
uStageSize: {
  value: new Float32Array([input.stageSize.width, input.stageSize.height]),
  type: "vec2<f32>",
},
```

In `tattooProjectionFragmentHeader`, add:

```glsl
uniform vec2 uStageSize;
```

In the call to `createTattooShaderResources`, pass:

```ts
stageSize: input.stageSize,
```

- [ ] **Step 6: Use warped geometry when tattoo state has a warp mesh**

Inside `setTattoo(state)` in `createPixiTattooRenderer`, replace geometry before applying uniforms:

```ts
if (state.warpMesh) {
  const previousGeometry = tattooMesh.geometry;
  tattooMesh.geometry = createMeshGeometry({
    positions: state.warpMesh.positions,
    uvs: state.warpMesh.uvs,
    indices: state.warpMesh.indices,
  }, input.stageSize);
  previousGeometry.destroy();
}
```

Keep:

```ts
applyTattooState(resources, shader, state);
applyTattooMeshVisibilityState(tattooMesh, state.transform.opacity);
applyTattooSpriteState(tattooSprite, state, { surfaceWarpEnabled: Boolean(state.warpMesh) || currentSurfaceWarpEnabled });
```

- [ ] **Step 7: Run renderer tests to verify GREEN**

Run:

```bash
npm test -- tests/render/pixiRenderer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/render/pixiRenderer.ts tests/render/pixiRenderer.test.ts
git commit -m "feat: render tattoo with warped mesh uv"
```

Expected: commit succeeds.

---

### Task 4: Integrate Warp Mesh into App State and Render Order

**Files:**
- Modify: `src/app.ts`
- Test: `tests/app.test.ts`

- [ ] **Step 1: Write failing app integration test**

Add to `tests/app.test.ts`:

```ts
import { buildTattooWarpMesh } from "../src/domain/tattooWarpMesh";

describe("tattoo warp integration", () => {
  test("builds a warped tattoo mesh only after local surface analysis exists", () => {
    const mesh = buildTattooWarpMesh({
      tattooSize: { width: 160, height: 100 },
      transform: { x: 200, y: 180, scale: 0.6, rotation: 0, opacity: 1 },
      surface: {
        source: "local-mesh",
        confidence: 0.7,
        axis: { origin: { x: 200, y: 180 }, direction: { x: 0, y: 1 }, length: 180 },
        patchBounds: { x: 100, y: 80, width: 220, height: 260 },
        proxy: "ellipticalCylinder",
        edgeTurn: 0.6,
        curvature: { acrossAxis: 0.65, alongAxis: 0.06 },
      },
      columns: 10,
      rows: 8,
    });

    expect(mesh?.stats.maxDisplacementPx).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run app test to verify RED or compile failure**

Run:

```bash
npm test -- tests/app.test.ts
```

Expected before Task 2 is implemented: FAIL due to missing `tattooWarpMesh`. Expected after Task 2 is implemented: PASS for this domain-level integration guard.

- [ ] **Step 3: Add app state field**

In `src/app.ts`, import:

```ts
import { buildTattooWarpMesh } from "./domain/tattooWarpMesh";
```

Add to `AppState`:

```ts
tattooWarpMesh: TattooWarpMeshData | null;
```

Import type:

```ts
TattooWarpMeshData,
```

Initialize in `initializeAppState`:

```ts
tattooWarpMesh: null,
```

- [ ] **Step 4: Update refresh/render order**

In `createTransformSetter`, change commit ordering from:

```ts
syncPanelFromTransform(state, elements);
renderTattoo(state, pixi);
if (source === "fabric" && phase === "live") {
  if (state.tattooAsset) {
    scheduleLiveSurfaceRefresh.schedule();
  }
  return;
}
scheduleLiveSurfaceRefresh.cancel();
refreshLocalSurface(state, elements, pixi);
```

To:

```ts
syncPanelFromTransform(state, elements);
if (source === "fabric" && phase === "live") {
  if (state.tattooAsset) {
    scheduleLiveSurfaceRefresh.schedule();
  }
  renderTattoo(state, pixi);
  return;
}
scheduleLiveSurfaceRefresh.cancel();
refreshLocalSurface(state, elements, pixi);
renderTattoo(state, pixi);
```

- [ ] **Step 5: Build warp mesh inside `refreshLocalSurface`**

After:

```ts
state.bodySurfaceState.analysisDebug = localSurface.debug;
```

Add:

```ts
state.tattooWarpMesh = buildTattooWarpMesh({
  tattooSize: state.tattooAsset.size,
  transform: state.tattooTransform,
  surface: localSurface.debug.source === "local-mesh" ? localSurface.debug : null,
});
```

In the no tattoo branch, add:

```ts
state.tattooWarpMesh = null;
```

- [ ] **Step 6: Pass warp mesh into Pixi**

In `renderTattoo`, pass:

```ts
pixi.setTattoo({
  texture: state.tattooAsset.texture,
  tattooSize: state.tattooAsset.size,
  transform: state.tattooTransform,
  warpMesh: state.tattooWarpMesh,
});
```

- [ ] **Step 7: Update status to expose warp evidence**

In `formatLocalSurfaceStatus`, append warp mesh evidence in the caller after `refreshSurfaceStatus`, or replace the status assignment in `refreshLocalSurface` with:

```ts
const warp = state.tattooWarpMesh
  ? ` / TPS warp ${Math.round(state.tattooWarpMesh.stats.maxDisplacementPx)}px`
  : " / TPS warp unavailable";
elements.statusLabel.textContent = `${formatLocalSurfaceStatus(localSurface.debug)}${warp}`;
```

- [ ] **Step 8: Run app tests to verify GREEN**

Run:

```bash
npm test -- tests/app.test.ts tests/appStart.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/app.ts tests/app.test.ts tests/appStart.test.ts
git commit -m "feat: integrate tps tattoo warp into app state"
```

Expected: commit succeeds.

---

### Task 5: Draw Warped Grid Debug Overlay

**Files:**
- Modify: `src/render/pixiDebugGeometry.ts`
- Modify: `src/render/pixiRenderer.ts`
- Test: `tests/render/pixiRenderer.test.ts`

- [ ] **Step 1: Write failing debug grid test**

Add to `tests/render/pixiRenderer.test.ts`:

```ts
import { drawTattooWarpDebugGrid } from "../../src/render/pixiDebugGeometry";

describe("tattoo warp debug grid", () => {
  test("draws warped grid lines with a visible cyan style", () => {
    const strokes: unknown[] = [];
    const moves: Array<[number, number]> = [];
    const graphics = {
      clear: vi.fn(),
      moveTo: (x: number, y: number) => moves.push([x, y]),
      lineTo: vi.fn(),
      stroke: (style: unknown) => strokes.push(style),
    };

    drawTattooWarpDebugGrid(graphics as never, [
      { source: { x: 0, y: 0 }, destination: { x: 10, y: 10 } },
      { source: { x: 100, y: 0 }, destination: { x: 120, y: 18 } },
    ]);

    expect(graphics.clear).toHaveBeenCalled();
    expect(moves[0]).toEqual([10, 10]);
    expect(strokes).toEqual([{ color: 0x18c6ff, width: 1.5, alpha: 0.86 }]);
  });
});
```

- [ ] **Step 2: Run renderer test to verify RED**

Run:

```bash
npm test -- tests/render/pixiRenderer.test.ts
```

Expected: FAIL because `drawTattooWarpDebugGrid` is not exported.

- [ ] **Step 3: Implement debug grid drawing**

In `src/render/pixiDebugGeometry.ts`, add:

```ts
import type { TattooWarpDebugLine } from "../domain/types";

export const tattooWarpDebugGridStrokeStyle = { color: 0x18c6ff, width: 1.5, alpha: 0.86 };

export function drawTattooWarpDebugGrid(graphics: Graphics, lines: TattooWarpDebugLine[]): void {
  graphics.clear();

  for (let index = 0; index < lines.length; index += 2) {
    const start = lines[index]?.destination;
    const end = lines[index + 1]?.destination;
    if (!start || !end) {
      continue;
    }
    graphics.moveTo(start.x, start.y);
    graphics.lineTo(end.x, end.y);
  }

  if (lines.length > 1) {
    graphics.stroke(tattooWarpDebugGridStrokeStyle);
  }
}
```

- [ ] **Step 4: Wire debug grid into Pixi renderer**

In `src/render/pixiRenderer.ts`, import:

```ts
drawTattooWarpDebugGrid,
```

Create:

```ts
const tattooWarpDebug = new Graphics();
```

Set:

```ts
tattooWarpDebug.zIndex = 102;
tattooWarpDebug.visible = false;
app.stage.addChild(tattooWarpDebug);
```

In `setTattoo(state)`, after setting mesh:

```ts
drawTattooWarpDebugGrid(tattooWarpDebug, state.warpMesh?.debugLines ?? []);
```

In `setDebugMeshVisible(visible)`, add:

```ts
tattooWarpDebug.visible = visible;
```

- [ ] **Step 5: Run renderer tests to verify GREEN**

Run:

```bash
npm test -- tests/render/pixiRenderer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/render/pixiDebugGeometry.ts src/render/pixiRenderer.ts tests/render/pixiRenderer.test.ts
git commit -m "feat: show warped tattoo debug grid"
```

Expected: commit succeeds.

---

### Task 6: Remove Flat Fallback from Active Warped Path

**Files:**
- Modify: `src/render/pixiRenderer.ts`
- Test: `tests/render/pixiRenderer.test.ts`

- [ ] **Step 1: Write failing fallback test**

Add to `tests/render/pixiRenderer.test.ts`:

```ts
describe("flat tattoo fallback guard", () => {
  test("plain sprite fallback is hidden whenever a tps warp mesh exists", () => {
    const sprite = {
      texture: Texture.EMPTY,
      anchor: { set: vi.fn() },
      scale: { set: vi.fn() },
      x: 0,
      y: 0,
      rotation: 0,
      alpha: 0,
      visible: true,
    };

    applyTattooSpriteState(sprite as never, {
      texture: Texture.WHITE,
      tattooSize: { width: 100, height: 80 },
      transform: { x: 20, y: 30, scale: 1, rotation: 0, opacity: 1 },
      warpMesh: {
        positions: new Float32Array([0, 0, 1, 0, 0, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        debugLines: [],
        controlPoints: [],
        stats: { maxDisplacementPx: 16, meanDisplacementPx: 8 },
      },
    }, { surfaceWarpEnabled: true });

    expect(sprite.visible).toBe(false);
  });
});
```

- [ ] **Step 2: Run renderer test to verify RED or compile failure**

Run:

```bash
npm test -- tests/render/pixiRenderer.test.ts
```

Expected before Task 3: compile failure because `PixiTattooState` has no `warpMesh`. Expected after Task 3: PASS if the fallback is already hidden; otherwise FAIL until Step 3.

- [ ] **Step 3: Make fallback guard explicit**

Change calls to `applyTattooSpriteState` in `setTattoo` and `setSurfaceNormalTexture` to compute:

```ts
const hideFlatFallback = Boolean(currentTattooState?.warpMesh) || currentSurfaceWarpEnabled;
applyTattooSpriteState(tattooSprite, currentTattooState, { surfaceWarpEnabled: hideFlatFallback });
```

For `setTattoo(state)`:

```ts
const hideFlatFallback = Boolean(state.warpMesh) || currentSurfaceWarpEnabled;
applyTattooSpriteState(tattooSprite, state, { surfaceWarpEnabled: hideFlatFallback });
```

- [ ] **Step 4: Run renderer test to verify GREEN**

Run:

```bash
npm test -- tests/render/pixiRenderer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/render/pixiRenderer.ts tests/render/pixiRenderer.test.ts
git commit -m "fix: prevent flat sprite from covering tps warp"
```

Expected: commit succeeds.

---

### Task 7: End-to-End Verification and Browser Visual Check

**Files:**
- Modify only if tests reveal a real bug: files from previous tasks

- [ ] **Step 1: Run full unit tests**

Run:

```bash
npm test
```

Expected: all test files pass. If a test fails, stop and fix the failing task before continuing.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: build succeeds. Vite chunk-size warning is acceptable because it already exists and is unrelated to TPS warp.

- [ ] **Step 3: Start dev server**

Run:

```bash
npm run dev
```

Expected: Vite prints a local URL such as `http://127.0.0.1:7788/` or the next available port.

- [ ] **Step 4: Browser visual verification**

Open the Vite URL. Upload a body image and tattoo image. Enable Show body mesh. Confirm all of these visually:

```text
1. The cyan tattoo warp grid is visible over the tattoo when Show body mesh is enabled.
2. The cyan grid is not a rectangle; at least one vertical or horizontal grid line bends.
3. The visible tattoo follows the cyan warped grid.
4. Status text includes "TPS warp <number>px" with a number greater than 10 for a shoulder or upper-arm placement.
5. The flat Fabric control box may remain rectangular, but the rendered Pixi tattoo inside it is warped.
```

- [ ] **Step 5: Capture evidence in the final implementation note**

Record these exact values in the final response:

```text
Tests: npm test -> all passed
Build: npm run build -> passed
Visual: TPS warp debug grid visible; max displacement reported as <actual number>px
Known limitation: Fabric editor control box remains rectangular; Pixi render is the source of truth for warped tattoo output.
```

- [ ] **Step 6: Commit verification-only adjustments if any**

If Step 4 required code fixes, commit them:

```bash
git add src tests
git commit -m "fix: verify visible tps tattoo warp"
```

Expected: commit succeeds only if files changed. If no files changed, do not create an empty commit.

---

## Self-Review

**Spec coverage:** This plan replaces shader-offset projection with real TPS control-point deformation, adds warped mesh rendering, disables flat fallback on the warped path, adds debug grid evidence, and requires visual verification.

**Plan completeness scan:** The plan contains concrete file paths, code blocks, commands, and expected outcomes for each task.

**Type consistency:** `TattooWarpMeshData`, `TattooWarpDebugLine`, `TpsControlPoint`, and `PixiTattooState.warpMesh` are introduced before use. The renderer tasks use existing `createMeshGeometry`, `Texture`, and Pixi test patterns already present in the repository.
