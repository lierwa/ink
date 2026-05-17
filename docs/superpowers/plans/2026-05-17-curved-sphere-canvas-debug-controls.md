# Curved Sphere Canvas Debug Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tattoos conform to the sphere surface, add pan/zoom canvas navigation, and expose debug mesh resolution controls.

**Architecture:** Replace the current square-grid-inside-circle sphere mesh with a polar ring mesh so the visible sphere boundary has exact circle-edge vertices. Replace flat screen-space tattoo sampling with inverse sphere-surface projection: every mesh fragment reconstructs the sphere normal, projects it into the tattoo transform's local tangent frame, then samples tattoo UVs. Keep Pixi as renderer, Fabric as transform controller, and add a CSS-transform viewport around both layers so pan/zoom affects Pixi and Fabric together.

**Tech Stack:** TypeScript, Vite, Vitest, PixiJS 8, Fabric 7, CSS transforms.

---

## Scope Check

These three requirements are coupled and should be implemented together:

- Curved tattoo projection depends on sphere mesh positions and sphere uniforms.
- Debug mesh visualization must show the same sphere mesh the shader renders.
- Mesh resolution controls must rebuild both the rendered mesh and debug overlay.

Canvas pan/zoom is independent in math, but it changes app orchestration and layout around the same stage stack, so it belongs in this plan as a separate task.

## Target File Structure

- Modify `src/domain/types.ts`
  - Add `SphereMeshResolution` and `CanvasViewport`.
- Modify `src/domain/sphereMesh.ts`
  - Replace rectangular `columns/rows` input with polar `radialSegments/angularSegments`.
  - Keep exact circle boundary vertices on the outer ring.
  - Keep `buildSphereWireframeSegments`.
- Modify `src/domain/tattooProjection.ts`
  - Replace flat inverse projection with sphere-surface inverse projection helpers.
  - Export helper math that mirrors shader behavior.
- Create `src/domain/canvasViewport.ts`
  - Pure pan/zoom math for pointer-centered zoom and panning.
- Modify `src/sphereConfig.ts`
  - Replace `meshGrid` with `meshResolution`.
- Modify `src/render/pixiRenderer.ts`
  - Add sphere uniforms to the tattoo shader.
  - Rebuild mesh and wireframe from `setMeshResolution`.
  - Use the same polar mesh for tattoo rendering and debug overlay.
- Modify `src/app.ts`
  - Add canvas viewport state, wheel zoom, space/middle-button pan.
  - Add mesh resolution number controls.
  - Wire mesh resolution changes into Pixi renderer.
- Modify `src/styles.css`
  - Add viewport wrapper styling and compact debug controls.
- Modify tests:
  - `tests/domain/sphereMesh.test.ts`
  - `tests/domain/tattooProjection.test.ts`
  - `tests/domain/canvasViewport.test.ts`
  - `tests/render/pixiRenderer.test.ts`

## Task 1: Add Shared Types And Polar Sphere Mesh

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/sphereMesh.ts`
- Modify: `tests/domain/sphereMesh.test.ts`
- Modify: `src/sphereConfig.ts`

- [ ] **Step 1: Write failing polar mesh tests**

Replace `tests/domain/sphereMesh.test.ts` with:

```ts
import { describe, expect, test } from "vitest";
import {
  buildSphereMesh,
  buildSphereWireframeSegments,
} from "../../src/domain/sphereMesh";
import type { SphereMeshResolution, SphereSurface } from "../../src/domain/types";

const sphere: SphereSurface = { cx: 450, cy: 310, r: 205 };
const resolution: SphereMeshResolution = {
  radialSegments: 8,
  angularSegments: 32,
};

describe("buildSphereMesh", () => {
  test("uses polar rings so the outer ring lands exactly on the visible circle", () => {
    const mesh = buildSphereMesh({ sphere, resolution });
    const outerStart = 1 + (resolution.radialSegments - 1) * resolution.angularSegments;

    for (let i = 0; i < resolution.angularSegments; i += 1) {
      const vertex = outerStart + i;
      const x = mesh.positions[vertex * 2];
      const y = mesh.positions[vertex * 2 + 1];
      const dx = x - sphere.cx;
      const dy = y - sphere.cy;

      expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(sphere.r, 5);
    }
  });

  test("never emits triangle vertices outside the visible sphere", () => {
    const mesh = buildSphereMesh({ sphere, resolution });

    for (const index of mesh.indices) {
      const x = mesh.positions[index * 2];
      const y = mesh.positions[index * 2 + 1];
      const dx = x - sphere.cx;
      const dy = y - sphere.cy;

      expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(sphere.r + 0.001);
    }
  });

  test("uses the full visible sphere as the mesh domain", () => {
    const mesh = buildSphereMesh({ sphere, resolution });
    const xs: number[] = [];
    const ys: number[] = [];

    for (let i = 0; i < mesh.positions.length; i += 2) {
      xs.push(mesh.positions[i]);
      ys.push(mesh.positions[i + 1]);
    }

    expect(Math.min(...xs)).toBeCloseTo(sphere.cx - sphere.r, 5);
    expect(Math.max(...xs)).toBeCloseTo(sphere.cx + sphere.r, 5);
    expect(Math.min(...ys)).toBeCloseTo(sphere.cy - sphere.r, 5);
    expect(Math.max(...ys)).toBeCloseTo(sphere.cy + sphere.r, 5);
  });
});

describe("buildSphereWireframeSegments", () => {
  test("returns unique line segments for triangle edges", () => {
    const mesh = buildSphereMesh({ sphere, resolution });
    const segments = buildSphereWireframeSegments(mesh);

    expect(segments.length).toBeGreaterThan(0);
    expect(segments.length % 4).toBe(0);

    const seen = new Set<string>();
    for (let i = 0; i < segments.length; i += 4) {
      const key = Array.from(segments.slice(i, i + 4)).join(",");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
```

- [ ] **Step 2: Run the mesh tests and verify RED**

Run:

```bash
bun run test tests/domain/sphereMesh.test.ts
```

Expected: TypeScript or runtime failures because `SphereMeshResolution` does not exist and `buildSphereMesh` still accepts `columns/rows`.

- [ ] **Step 3: Add mesh resolution type**

In `src/domain/types.ts`, add:

```ts
export interface SphereMeshResolution {
  radialSegments: number;
  angularSegments: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}
```

- [ ] **Step 4: Replace `buildSphereMesh` with polar mesh generation**

Replace `src/domain/sphereMesh.ts` with:

```ts
import type { SphereMeshResolution, SphereSurface } from "./types";

export interface SphereMeshInput {
  sphere: SphereSurface;
  resolution: SphereMeshResolution;
}

export interface SphereMeshData {
  positions: Float32Array;
  sphereUv: Float32Array;
  indices: Uint32Array;
}

export function buildSphereMesh(input: SphereMeshInput): SphereMeshData {
  const { sphere, resolution } = input;
  const radialSegments = clampInteger(resolution.radialSegments, 2, 128);
  const angularSegments = clampInteger(resolution.angularSegments, 8, 512);
  const positions: number[] = [sphere.cx, sphere.cy];
  const sphereUv: number[] = [0.5, 0.5];
  const indices: number[] = [];

  for (let ring = 1; ring <= radialSegments; ring += 1) {
    const radiusRatio = ring / radialSegments;
    const ringRadius = sphere.r * radiusRatio;

    for (let segment = 0; segment < angularSegments; segment += 1) {
      const angle = (segment / angularSegments) * Math.PI * 2;
      const x = sphere.cx + Math.cos(angle) * ringRadius;
      const y = sphere.cy + Math.sin(angle) * ringRadius;
      positions.push(x, y);
      sphereUv.push(
        (x - (sphere.cx - sphere.r)) / (sphere.r * 2),
        (y - (sphere.cy - sphere.r)) / (sphere.r * 2),
      );
    }
  }

  for (let segment = 0; segment < angularSegments; segment += 1) {
    indices.push(0, ringVertex(1, segment, angularSegments), ringVertex(1, segment + 1, angularSegments));
  }

  for (let ring = 2; ring <= radialSegments; ring += 1) {
    for (let segment = 0; segment < angularSegments; segment += 1) {
      const innerLeft = ringVertex(ring - 1, segment, angularSegments);
      const innerRight = ringVertex(ring - 1, segment + 1, angularSegments);
      const outerLeft = ringVertex(ring, segment, angularSegments);
      const outerRight = ringVertex(ring, segment + 1, angularSegments);

      indices.push(innerLeft, outerLeft, innerRight);
      indices.push(innerRight, outerLeft, outerRight);
    }
  }

  return {
    positions: new Float32Array(positions),
    sphereUv: new Float32Array(sphereUv),
    indices: new Uint32Array(indices),
  };
}

export function buildSphereWireframeSegments(mesh: SphereMeshData): Float32Array {
  const segments: number[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < mesh.indices.length; i += 3) {
    pushEdge(segments, seen, mesh.positions, mesh.indices[i], mesh.indices[i + 1]);
    pushEdge(segments, seen, mesh.positions, mesh.indices[i + 1], mesh.indices[i + 2]);
    pushEdge(segments, seen, mesh.positions, mesh.indices[i + 2], mesh.indices[i]);
  }

  return new Float32Array(segments);
}

function ringVertex(ring: number, segment: number, angularSegments: number): number {
  const wrappedSegment = ((segment % angularSegments) + angularSegments) % angularSegments;
  return 1 + (ring - 1) * angularSegments + wrappedSegment;
}

function pushEdge(
  segments: number[],
  seen: Set<string>,
  positions: Float32Array,
  a: number,
  b: number,
): void {
  const first = Math.min(a, b);
  const second = Math.max(a, b);
  const key = `${first}:${second}`;

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  segments.push(
    positions[first * 2],
    positions[first * 2 + 1],
    positions[second * 2],
    positions[second * 2 + 1],
  );
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}
```

- [ ] **Step 5: Update mesh config**

In `src/sphereConfig.ts`, replace `meshGrid` with:

```ts
export const meshResolution = {
  radialSegments: 18,
  angularSegments: 72,
} as const;
```

- [ ] **Step 6: Run mesh tests and verify GREEN**

Run:

```bash
bun run test tests/domain/sphereMesh.test.ts
```

Expected: all tests in `tests/domain/sphereMesh.test.ts` pass.

- [ ] **Step 7: Commit if Git is available**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If it prints `true`, run:

```bash
git add src/domain/types.ts src/domain/sphereMesh.ts src/sphereConfig.ts tests/domain/sphereMesh.test.ts
git commit -m "feat: use polar sphere mesh"
```

If it fails with `fatal: not a git repository`, skip this commit step.

## Task 2: Add Curved Sphere-Surface Tattoo Projection

**Files:**
- Modify: `src/domain/tattooProjection.ts`
- Modify: `tests/domain/tattooProjection.test.ts`

- [ ] **Step 1: Replace projection tests with curved surface behavior**

Replace `tests/domain/tattooProjection.test.ts` with:

```ts
import { describe, expect, test } from "vitest";
import {
  pointIsInsideTattoo,
  projectPointToTattooUv,
  spherePointToNormal,
} from "../../src/domain/tattooProjection";
import type { Size, SphereSurface, TattooTransform } from "../../src/domain/types";

const sphere: SphereSurface = { cx: 450, cy: 310, r: 200 };
const size: Size = { width: 200, height: 160 };
const transform: TattooTransform = {
  x: 450,
  y: 310,
  scale: 1,
  rotation: 0,
  opacity: 0.84,
};

describe("spherePointToNormal", () => {
  test("reconstructs the front-facing unit normal for a sphere screen point", () => {
    expect(spherePointToNormal({ x: 450, y: 310 }, sphere)).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });

    const edge = spherePointToNormal({ x: 650, y: 310 }, sphere);
    expect(edge.x).toBeCloseTo(1);
    expect(edge.y).toBeCloseTo(0);
    expect(edge.z).toBeCloseTo(0);
  });
});

describe("tattoo projection", () => {
  test("maps the transform center to the center of the tattoo texture", () => {
    expect(projectPointToTattooUv({ x: 450, y: 310 }, sphere, size, transform)).toEqual({
      u: 0.5,
      v: 0.5,
    });
  });

  test("uses angular sphere distance rather than flat screen distance", () => {
    const pointAtQuarterRadian = {
      x: sphere.cx + Math.sin(0.25) * sphere.r,
      y: sphere.cy,
    };

    const uv = projectPointToTattooUv(pointAtQuarterRadian, sphere, size, transform);

    expect(uv.u).toBeCloseTo(0.75, 4);
    expect(uv.v).toBeCloseTo(0.5, 4);
  });

  test("uses inverse rotation in the tangent frame", () => {
    const rotated: TattooTransform = {
      ...transform,
      rotation: Math.PI / 2,
    };
    const pointAtQuarterRadianDown = {
      x: sphere.cx,
      y: sphere.cy + Math.sin(0.25) * sphere.r,
    };

    const uv = projectPointToTattooUv(pointAtQuarterRadianDown, sphere, size, rotated);

    expect(uv.u).toBeCloseTo(0.75, 4);
    expect(uv.v).toBeCloseTo(0.5, 4);
  });

  test("detects whether a sphere point samples inside the tattoo image", () => {
    expect(pointIsInsideTattoo({ x: 450, y: 310 }, sphere, size, transform)).toBe(true);
    expect(pointIsInsideTattoo({ x: 650, y: 310 }, sphere, size, transform)).toBe(false);
  });
});
```

- [ ] **Step 2: Run projection tests and verify RED**

Run:

```bash
bun run test tests/domain/tattooProjection.test.ts
```

Expected: failures because `projectPointToTattooUv` currently accepts `(point, tattooSize, transform)` and performs flat projection.

- [ ] **Step 3: Implement sphere-surface projection**

Replace `src/domain/tattooProjection.ts` with:

```ts
import type { Point, Size, SphereSurface, TattooTransform } from "./types";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface TattooUv {
  u: number;
  v: number;
}

export function spherePointToNormal(point: Point, sphere: SphereSurface): Vector3 {
  const x = clamp((point.x - sphere.cx) / sphere.r, -1, 1);
  const y = clamp((point.y - sphere.cy) / sphere.r, -1, 1);
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));

  return normalize3({ x, y, z });
}

export function projectPointToTattooUv(
  point: Point,
  sphere: SphereSurface,
  tattooSize: Size,
  transform: TattooTransform,
): TattooUv {
  const sphereNormal = spherePointToNormal(point, sphere);
  const centerNormal = spherePointToNormal({ x: transform.x, y: transform.y }, sphere);
  const basis = createTangentBasis(centerNormal, transform.rotation);
  const forward = Math.max(dot3(sphereNormal, centerNormal), 0.0001);
  const tangentX = dot3(sphereNormal, basis.u);
  const tangentY = dot3(sphereNormal, basis.v);
  const localX = (sphere.r * Math.atan2(tangentX, forward)) / transform.scale;
  const localY = (sphere.r * Math.atan2(tangentY, forward)) / transform.scale;

  return {
    u: localX / tattooSize.width + 0.5,
    v: localY / tattooSize.height + 0.5,
  };
}

export function pointIsInsideTattoo(
  point: Point,
  sphere: SphereSurface,
  tattooSize: Size,
  transform: TattooTransform,
): boolean {
  const uv = projectPointToTattooUv(point, sphere, tattooSize, transform);
  return uv.u >= 0 && uv.u <= 1 && uv.v >= 0 && uv.v <= 1;
}

function createTangentBasis(normal: Vector3, rotation: number): { u: Vector3; v: Vector3 } {
  const projectedRight = subtract3({ x: 1, y: 0, z: 0 }, scale3(normal, normal.x));
  const unrotatedU = length3(projectedRight) < 0.0001
    ? normalize3(subtract3({ x: 0, y: 1, z: 0 }, scale3(normal, normal.y)))
    : normalize3(projectedRight);
  const unrotatedV = normalize3(cross3(normal, unrotatedU));
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    u: normalize3(add3(scale3(unrotatedU, cos), scale3(unrotatedV, sin))),
    v: normalize3(add3(scale3(unrotatedU, -sin), scale3(unrotatedV, cos))),
  };
}

function add3(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract3(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale3(value: Vector3, scale: number): Vector3 {
  return { x: value.x * scale, y: value.y * scale, z: value.z * scale };
}

function dot3(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length3(value: Vector3): number {
  return Math.sqrt(dot3(value, value));
}

function normalize3(value: Vector3): Vector3 {
  const length = length3(value);

  if (length < 0.0001) {
    return { x: 0, y: 0, z: 1 };
  }

  return scale3(value, 1 / length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
```

- [ ] **Step 4: Run projection tests and verify GREEN**

Run:

```bash
bun run test tests/domain/tattooProjection.test.ts
```

Expected: all tests in `tests/domain/tattooProjection.test.ts` pass.

- [ ] **Step 5: Commit if Git is available**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If it prints `true`, run:

```bash
git add src/domain/tattooProjection.ts tests/domain/tattooProjection.test.ts
git commit -m "feat: project tattoos onto sphere surface"
```

If it fails with `fatal: not a git repository`, skip this commit step.

## Task 3: Update Pixi Shader To Match Curved Projection And Rebuild Mesh Resolution

**Files:**
- Modify: `src/render/pixiRenderer.ts`
- Modify: `tests/render/pixiRenderer.test.ts`

- [ ] **Step 1: Write failing renderer resource tests**

Replace `tests/render/pixiRenderer.test.ts` with:

```ts
import { describe, expect, test } from "vitest";
import { createTattooShaderResources } from "../../src/render/pixiRenderer";

describe("createTattooShaderResources", () => {
  test("wraps tattoo and sphere uniforms in a Pixi uniform group", () => {
    const resources = createTattooShaderResources({
      sphere: { cx: 450, cy: 310, r: 205 },
      tattooSize: { width: 100, height: 80 },
      transform: {
        x: 450,
        y: 310,
        scale: 1,
        rotation: 0,
        opacity: 0.84,
      },
    });

    expect("uTattooSize" in resources).toBe(false);
    expect("uSphere" in resources).toBe(false);
    expect(resources.tattooUniforms.uniforms.uSphere).toEqual(new Float32Array([450, 310, 205]));
    expect(resources.tattooUniforms.uniforms.uTattooSize).toEqual(new Float32Array([100, 80]));
    expect(resources.tattooUniforms.uniforms.uTattooOpacity).toBe(0.84);
  });
});
```

- [ ] **Step 2: Run renderer test and verify RED**

Run:

```bash
bun run test tests/render/pixiRenderer.test.ts
```

Expected: failure because `createTattooShaderResources` does not accept `sphere` and the shader lacks `uSphere`.

- [ ] **Step 3: Update renderer public types**

In `src/render/pixiRenderer.ts`, replace renderer input and public API types with:

```ts
import type { Size, SphereMeshResolution, SphereSurface, TattooTransform } from "../domain/types";

export interface PixiRendererInput {
  mount: HTMLElement;
  stageSize: Size;
  sphere: SphereSurface;
  mesh: SphereMeshResolution;
}

export interface PixiTattooRenderer {
  canvas: HTMLCanvasElement;
  setTattoo(state: PixiTattooState): void;
  setDebugMeshVisible(visible: boolean): void;
  setMeshResolution(resolution: SphereMeshResolution): void;
  destroy(): void;
}
```

- [ ] **Step 4: Update shader resources**

In `src/render/pixiRenderer.ts`, replace `TattooShaderResources`, `TattooShaderResourceInput`, and `createTattooShaderResources` with:

```ts
export type TattooShaderResources = {
  uTexture: Texture["source"];
  tattooUniforms: UniformGroup<{
    uSphere: { value: Float32Array; type: "vec3<f32>" };
    uTattooSize: { value: Float32Array; type: "vec2<f32>" };
    uTattooTransform: { value: Float32Array; type: "vec4<f32>" };
    uTattooOpacity: { value: number; type: "f32" };
  }>;
};

export interface TattooShaderResourceInput {
  sphere: SphereSurface;
  tattooSize: Size;
  transform: TattooTransform;
}

export function createTattooShaderResources(
  input: TattooShaderResourceInput,
): TattooShaderResources {
  return {
    uTexture: Texture.EMPTY.source,
    tattooUniforms: new UniformGroup({
      uSphere: {
        value: new Float32Array([input.sphere.cx, input.sphere.cy, input.sphere.r]),
        type: "vec3<f32>",
      },
      uTattooSize: {
        value: new Float32Array([input.tattooSize.width, input.tattooSize.height]),
        type: "vec2<f32>",
      },
      uTattooTransform: {
        value: new Float32Array([
          input.transform.x,
          input.transform.y,
          input.transform.scale,
          input.transform.rotation,
        ]),
        type: "vec4<f32>",
      },
      uTattooOpacity: {
        value: input.transform.opacity,
        type: "f32",
      },
    }),
  };
}
```

- [ ] **Step 5: Add mesh rebuild helper in renderer**

Inside `createPixiTattooRenderer`, replace direct one-time mesh creation with mutable references:

```ts
let currentResolution = input.mesh;
let sphereMesh = buildSphereMesh({
  sphere: input.sphere,
  resolution: currentResolution,
});
const geometry = new MeshGeometry({
  positions: sphereMesh.positions,
  uvs: sphereMesh.sphereUv,
  indices: sphereMesh.indices,
});
const tattooMesh = new Mesh({ geometry, shader });
const debugWireframe = new Graphics();

function rebuildMesh(resolution: SphereMeshResolution): void {
  currentResolution = resolution;
  sphereMesh = buildSphereMesh({
    sphere: input.sphere,
    resolution: currentResolution,
  });
  tattooMesh.geometry = new MeshGeometry({
    positions: sphereMesh.positions,
    uvs: sphereMesh.sphereUv,
    indices: sphereMesh.indices,
  });
  drawWireframe(debugWireframe, sphereMesh);
}
```

Add this helper below `createTattooShader`:

```ts
function drawWireframe(graphics: Graphics, mesh: ReturnType<typeof buildSphereMesh>): void {
  const segments = buildSphereWireframeSegments(mesh);
  graphics.clear();

  for (let i = 0; i < segments.length; i += 4) {
    graphics.moveTo(segments[i], segments[i + 1]);
    graphics.lineTo(segments[i + 2], segments[i + 3]);
  }

  graphics.stroke({ color: 0x23424a, width: 1, alpha: 0.38 });
}
```

In the returned renderer object, add:

```ts
setMeshResolution(resolution) {
  rebuildMesh(resolution);
},
```

- [ ] **Step 6: Replace GLSL shader projection with sphere math**

In `tattooProjectionBit.fragment.header`, use:

```glsl
in vec2 vSpherePoint;
uniform sampler2D uTexture;
uniform vec3 uSphere;
uniform vec2 uTattooSize;
uniform vec4 uTattooTransform;
uniform float uTattooOpacity;

vec3 normalFromPoint(vec2 point) {
  vec2 xy = clamp((point - uSphere.xy) / uSphere.z, vec2(-1.0), vec2(1.0));
  float z = sqrt(max(0.0, 1.0 - dot(xy, xy)));
  return normalize(vec3(xy, z));
}

vec3 safeNormalize(vec3 value) {
  float len = length(value);
  if (len < 0.0001) {
    return vec3(0.0, 0.0, 1.0);
  }
  return value / len;
}
```

In `tattooProjectionBit.fragment.main`, use:

```glsl
vec3 sphereNormal = normalFromPoint(vSpherePoint);
vec3 centerNormal = normalFromPoint(uTattooTransform.xy);
vec3 projectedRight = vec3(1.0, 0.0, 0.0) - centerNormal * centerNormal.x;
vec3 unrotatedU = length(projectedRight) < 0.0001
  ? safeNormalize(vec3(0.0, 1.0, 0.0) - centerNormal * centerNormal.y)
  : safeNormalize(projectedRight);
vec3 unrotatedV = safeNormalize(cross(centerNormal, unrotatedU));
float c = cos(uTattooTransform.w);
float s = sin(uTattooTransform.w);
vec3 tangentU = safeNormalize(unrotatedU * c + unrotatedV * s);
vec3 tangentV = safeNormalize(unrotatedU * -s + unrotatedV * c);
float forward = max(dot(sphereNormal, centerNormal), 0.0001);
float localX = (uSphere.z * atan(dot(sphereNormal, tangentU), forward)) / uTattooTransform.z;
float localY = (uSphere.z * atan(dot(sphereNormal, tangentV), forward)) / uTattooTransform.z;
vec2 tattooUv = vec2(localX, localY) / uTattooSize + vec2(0.5);

if (
  tattooUv.x < 0.0 ||
  tattooUv.x > 1.0 ||
  tattooUv.y < 0.0 ||
  tattooUv.y > 1.0
) {
  outColor = vec4(0.0);
} else {
  outColor = texture(uTexture, tattooUv) * uTattooOpacity;
}
```

- [ ] **Step 7: Update `createPixiTattooRenderer` calls to new mesh API**

In `src/render/pixiRenderer.ts`, update `createTattooShaderResources` call to pass `sphere`:

```ts
const resources = createTattooShaderResources({
  sphere: input.sphere,
  tattooSize: { width: 1, height: 1 },
  transform: {
    x: input.sphere.cx,
    y: input.sphere.cy,
    scale: 1,
    rotation: 0,
    opacity: 1,
  },
});
```

In `setTattoo`, keep updating only texture, size, transform, and opacity:

```ts
resources.uTexture = state.texture.source;
resources.tattooUniforms.uniforms.uTattooSize[0] = state.tattooSize.width;
resources.tattooUniforms.uniforms.uTattooSize[1] = state.tattooSize.height;
resources.tattooUniforms.uniforms.uTattooTransform[0] = state.transform.x;
resources.tattooUniforms.uniforms.uTattooTransform[1] = state.transform.y;
resources.tattooUniforms.uniforms.uTattooTransform[2] = state.transform.scale;
resources.tattooUniforms.uniforms.uTattooTransform[3] = state.transform.rotation;
resources.tattooUniforms.uniforms.uTattooOpacity = state.transform.opacity;
shader.resources.uTexture = resources.uTexture;
```

- [ ] **Step 8: Run renderer tests and typecheck**

Run:

```bash
bun run test tests/render/pixiRenderer.test.ts
bun run typecheck
```

Expected: renderer test passes and TypeScript passes.

- [ ] **Step 9: Commit if Git is available**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If it prints `true`, run:

```bash
git add src/render/pixiRenderer.ts tests/render/pixiRenderer.test.ts
git commit -m "feat: render tattoos with curved sphere projection"
```

If it fails with `fatal: not a git repository`, skip this commit step.

## Task 4: Add Canvas Pan And Zoom Viewport

**Files:**
- Create: `src/domain/canvasViewport.ts`
- Create: `tests/domain/canvasViewport.test.ts`
- Modify: `src/app.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing viewport math tests**

Create `tests/domain/canvasViewport.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  clampViewportScale,
  panViewport,
  zoomViewportAtPoint,
} from "../../src/domain/canvasViewport";
import type { CanvasViewport } from "../../src/domain/types";

describe("canvas viewport math", () => {
  test("clamps zoom scale to the supported range", () => {
    expect(clampViewportScale(0.05)).toBe(0.25);
    expect(clampViewportScale(1.5)).toBe(1.5);
    expect(clampViewportScale(8)).toBe(4);
  });

  test("pans by screen-space delta", () => {
    const viewport: CanvasViewport = { x: 10, y: 20, scale: 1.5 };

    expect(panViewport(viewport, { x: 4, y: -8 })).toEqual({
      x: 14,
      y: 12,
      scale: 1.5,
    });
  });

  test("zooms around the pointer while keeping the stage point under the cursor fixed", () => {
    const viewport: CanvasViewport = { x: 100, y: 50, scale: 1 };
    const next = zoomViewportAtPoint(viewport, { x: 300, y: 250 }, 2);

    expect(next).toEqual({
      x: -100,
      y: -150,
      scale: 2,
    });
  });
});
```

- [ ] **Step 2: Run viewport tests and verify RED**

Run:

```bash
bun run test tests/domain/canvasViewport.test.ts
```

Expected: failure because `src/domain/canvasViewport.ts` does not exist.

- [ ] **Step 3: Implement viewport math**

Create `src/domain/canvasViewport.ts`:

```ts
import type { CanvasViewport, Point } from "./types";

export const minViewportScale = 0.25;
export const maxViewportScale = 4;

export function clampViewportScale(scale: number): number {
  return Math.min(Math.max(scale, minViewportScale), maxViewportScale);
}

export function panViewport(viewport: CanvasViewport, delta: Point): CanvasViewport {
  return {
    x: viewport.x + delta.x,
    y: viewport.y + delta.y,
    scale: viewport.scale,
  };
}

export function zoomViewportAtPoint(
  viewport: CanvasViewport,
  point: Point,
  nextScale: number,
): CanvasViewport {
  const scale = clampViewportScale(nextScale);
  const stageX = (point.x - viewport.x) / viewport.scale;
  const stageY = (point.y - viewport.y) / viewport.scale;

  return {
    x: point.x - stageX * scale,
    y: point.y - stageY * scale,
    scale,
  };
}
```

- [ ] **Step 4: Run viewport tests and verify GREEN**

Run:

```bash
bun run test tests/domain/canvasViewport.test.ts
```

Expected: all tests in `tests/domain/canvasViewport.test.ts` pass.

- [ ] **Step 5: Add viewport DOM wrapper in app markup**

In `src/app.ts`, change the stage markup from:

```ts
canvasFrame.innerHTML = `
  <div class="stage-stack">
    <div class="pixi-layer" id="pixiLayer"></div>
    <canvas id="fabricLayer" width="${stageSize.width}" height="${stageSize.height}" aria-label="Fabric tattoo editor layer"></canvas>
  </div>
`;
```

to:

```ts
canvasFrame.innerHTML = `
  <div class="viewport-surface" id="viewportSurface">
    <div class="stage-stack" id="stageStack">
      <div class="pixi-layer" id="pixiLayer"></div>
      <canvas id="fabricLayer" width="${stageSize.width}" height="${stageSize.height}" aria-label="Fabric tattoo editor layer"></canvas>
    </div>
  </div>
`;
```

- [ ] **Step 6: Wire viewport state and interactions**

In `src/app.ts`, add imports:

```ts
import {
  panViewport,
  zoomViewportAtPoint,
} from "./domain/canvasViewport";
```

After reading `canvasFrame`, add:

```ts
const viewportSurface = getElement<HTMLDivElement>("viewportSurface");
const stageStack = getElement<HTMLDivElement>("stageStack");
let viewport: CanvasViewport = { x: 0, y: 0, scale: 1 };
let isSpacePressed = false;
let panStart: { pointerId: number; x: number; y: number } | null = null;

const applyViewport = (): void => {
  stageStack.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
};
```

Add `CanvasViewport` to type imports:

```ts
import type { CanvasViewport, Size, TattooTransform } from "./domain/types";
```

After `syncPanelFromTransform();`, call:

```ts
applyViewport();
```

After existing event listeners, add:

```ts
viewportSurface.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = viewportSurface.getBoundingClientRect();
  const point = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const zoomFactor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
  viewport = zoomViewportAtPoint(viewport, point, viewport.scale * zoomFactor);
  applyViewport();
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    isSpacePressed = true;
    viewportSurface.classList.add("is-panning-enabled");
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    isSpacePressed = false;
    panStart = null;
    viewportSurface.classList.remove("is-panning-enabled");
  }
});

viewportSurface.addEventListener("pointerdown", (event) => {
  const shouldPan = event.button === 1 || (event.button === 0 && isSpacePressed);

  if (!shouldPan) {
    return;
  }

  event.preventDefault();
  panStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  };
  viewportSurface.setPointerCapture(event.pointerId);
  viewportSurface.classList.add("is-panning");
});

viewportSurface.addEventListener("pointermove", (event) => {
  if (!panStart || panStart.pointerId !== event.pointerId) {
    return;
  }

  viewport = panViewport(viewport, {
    x: event.clientX - panStart.x,
    y: event.clientY - panStart.y,
  });
  panStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  };
  applyViewport();
});

viewportSurface.addEventListener("pointerup", (event) => {
  if (!panStart || panStart.pointerId !== event.pointerId) {
    return;
  }

  panStart = null;
  viewportSurface.releasePointerCapture(event.pointerId);
  viewportSurface.classList.remove("is-panning");
});
```

- [ ] **Step 7: Add viewport styles**

In `src/styles.css`, replace the `.stage-stack` block with:

```css
.viewport-surface {
  display: grid;
  place-items: center;
  width: min(100%, 900px);
  aspect-ratio: 900 / 620;
  max-height: calc(100vh - 120px);
  overflow: hidden;
  touch-action: none;
}

.viewport-surface.is-panning-enabled,
.viewport-surface.is-panning {
  cursor: grab;
}

.viewport-surface.is-panning {
  cursor: grabbing;
}

.stage-stack {
  position: relative;
  width: 900px;
  height: 620px;
  border: 1px solid rgba(20, 24, 25, 0.22);
  border-radius: 8px;
  box-shadow: 0 18px 40px rgba(21, 24, 25, 0.22);
  overflow: hidden;
  transform-origin: 0 0;
}
```

- [ ] **Step 8: Run viewport tests and typecheck**

Run:

```bash
bun run test tests/domain/canvasViewport.test.ts
bun run typecheck
```

Expected: tests pass and TypeScript passes.

- [ ] **Step 9: Commit if Git is available**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If it prints `true`, run:

```bash
git add src/domain/types.ts src/domain/canvasViewport.ts src/app.ts src/styles.css tests/domain/canvasViewport.test.ts
git commit -m "feat: add canvas pan and zoom viewport"
```

If it fails with `fatal: not a git repository`, skip this commit step.

## Task 5: Expose Mesh Resolution Controls

**Files:**
- Modify: `src/app.ts`
- Modify: `src/styles.css`
- Modify: `src/render/pixiRenderer.ts`
- Modify: `src/sphereConfig.ts`

- [ ] **Step 1: Add mesh resolution state to `AppState`**

In `src/app.ts`, change imports:

```ts
import { meshResolution, sphere, stageSize } from "./sphereConfig";
import type { CanvasViewport, Size, SphereMeshResolution, TattooTransform } from "./domain/types";
```

Change `AppState`:

```ts
interface AppState {
  tattooTransform: TattooTransform;
  tattooSize: Size;
  tattooTexture: Texture;
  removeWhiteUpload: boolean;
  meshResolution: SphereMeshResolution;
}
```

When creating state, add:

```ts
meshResolution: { ...meshResolution },
```

When creating Pixi renderer, pass:

```ts
mesh: state.meshResolution,
```

- [ ] **Step 2: Add mesh control markup**

In `createAppMarkup`, replace the current metric card:

```html
<div class="metric-card"><span>Mesh</span><strong>${meshGrid.columns} x ${meshGrid.rows}</strong></div>
```

with:

```html
<label>
  <span>Radial</span>
  <input id="meshRadialSegments" type="number" min="2" max="128" step="1" value="${meshResolution.radialSegments}" />
</label>
<label>
  <span>Angular</span>
  <input id="meshAngularSegments" type="number" min="8" max="512" step="1" value="${meshResolution.angularSegments}" />
</label>
```

- [ ] **Step 3: Wire mesh control inputs**

In `src/app.ts`, after reading `debugMeshInput`, add:

```ts
const meshRadialInput = getElement<HTMLInputElement>("meshRadialSegments");
const meshAngularInput = getElement<HTMLInputElement>("meshAngularSegments");
```

Add helper inside `startApp` after `setTransform`:

```ts
const applyMeshResolution = (): void => {
  state.meshResolution = {
    radialSegments: clampInteger(Number(meshRadialInput.value), 2, 128),
    angularSegments: clampInteger(Number(meshAngularInput.value), 8, 512),
  };
  meshRadialInput.value = String(state.meshResolution.radialSegments);
  meshAngularInput.value = String(state.meshResolution.angularSegments);
  pixi.setMeshResolution(state.meshResolution);
};
```

Add event listeners after debug mesh listener:

```ts
meshRadialInput.addEventListener("change", applyMeshResolution);
meshAngularInput.addEventListener("change", applyMeshResolution);
```

Add helper at bottom of `src/app.ts`:

```ts
function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value) || min, min), max);
}
```

- [ ] **Step 4: Update compact control grid CSS**

In `src/styles.css`, keep `.param-grid { grid-template-columns: repeat(3, 1fr); }`.

Remove `.metric-card` from these grouped selectors:

```css
.param-grid label,
.metric-card {
  ...
}

.param-grid span,
.metric-card span {
  ...
}

.metric-card strong {
  font-size: 1rem;
}
```

Replace them with:

```css
.param-grid label {
  display: grid;
  gap: 4px;
  border: 1px solid rgba(247, 251, 250, 0.12);
  border-radius: 6px;
  padding: 10px;
  background: #171b1c;
}

.param-grid span {
  color: #8fa09d;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
}
```

- [ ] **Step 5: Search for old `meshGrid` references**

Run:

```bash
rg "meshGrid|columns|rows" src tests
```

Expected: no `meshGrid` references. `columns` or `rows` may appear only in unrelated package text if the search accidentally includes `node_modules`; the command above searches only `src tests`.

- [ ] **Step 6: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: TypeScript passes.

- [ ] **Step 7: Commit if Git is available**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If it prints `true`, run:

```bash
git add src/app.ts src/styles.css src/render/pixiRenderer.ts src/sphereConfig.ts
git commit -m "feat: expose sphere mesh resolution controls"
```

If it fails with `fatal: not a git repository`, skip this commit step.

## Task 6: Final Verification

**Files:**
- Verify: all changed files

- [ ] **Step 1: Run full tests**

Run:

```bash
bun run test
```

Expected: all test files pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: `tsc --noEmit` exits with code 0.

- [ ] **Step 3: Run production build**

Run:

```bash
bun run build
```

Expected: build exits with code 0. The Vite chunk-size warning is acceptable.

- [ ] **Step 4: Start or verify dev server**

If no server is already running, run:

```bash
bun run dev -- --port 5173
```

Expected: Vite prints a local URL. If 5173 is occupied, Vite may choose another port.

- [ ] **Step 5: Manual browser verification**

Open the Vite URL and verify these behaviors:

- Dragging the tattoo across the sphere shows curvature from the sphere surface, not just flat translation.
- The tattoo only clips at the visible sphere edge.
- `Show sphere mesh` toggles a mesh overlay.
- Changing `Radial` updates ring count.
- Changing `Angular` updates edge smoothness around the circle.
- Mouse wheel zooms the whole canvas around the cursor.
- Hold Space and left-drag, or middle-drag, pans the whole canvas.
- Normal left-drag still moves the Fabric tattoo controller.

- [ ] **Step 6: Commit verification note if Git is available**

Run:

```bash
git rev-parse --is-inside-work-tree
```

If it prints `true`, run:

```bash
git status --short
```

If only expected source, test, style, and plan files are changed, commit:

```bash
git add docs/superpowers/plans/2026-05-17-curved-sphere-canvas-debug-controls.md
git commit -m "docs: plan curved sphere canvas controls"
```

If it fails with `fatal: not a git repository`, skip this commit step.

## Self-Review

- Spec coverage: Requirement 1 is covered by Task 2 and Task 3. Requirement 2 is covered by Task 4. Requirement 3 is covered by Task 1 and Task 5.
- Placeholder scan: This plan contains concrete file paths, concrete command lines, concrete expected outcomes, and concrete code snippets for each implementation step.
- Type consistency: `SphereMeshResolution`, `CanvasViewport`, `createTattooShaderResources`, `setMeshResolution`, and `meshResolution` are consistently named across tasks.
