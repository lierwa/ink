import type { SphereMeshResolution, SphereSurface } from "./types";

export const meshResolutionLimits = {
  radialSegments: { min: 4, max: 64 },
  angularSegments: { min: 12, max: 192 },
} as const;

export interface SphereMeshInput {
  sphere: SphereSurface;
  resolution: SphereMeshResolution;
}

export interface SphereMeshData {
  positions: Float32Array;
  sphereUv: Float32Array;
  indices: Uint32Array;
}

export function normalizeMeshResolution(resolution: SphereMeshResolution): SphereMeshResolution {
  return {
    radialSegments: normalizeSegment(
      resolution.radialSegments,
      meshResolutionLimits.radialSegments.min,
      meshResolutionLimits.radialSegments.max,
    ),
    angularSegments: normalizeSegment(
      resolution.angularSegments,
      meshResolutionLimits.angularSegments.min,
      meshResolutionLimits.angularSegments.max,
    ),
  };
}

export function buildSphereMesh(input: SphereMeshInput): SphereMeshData {
  const { sphere } = input;
  const { radialSegments, angularSegments } = normalizeMeshResolution(input.resolution);
  const positions: number[] = [];
  const sphereUv: number[] = [];

  pushVertex(positions, sphereUv, sphere, sphere.cx, sphere.cy);

  for (let ring = 1; ring <= radialSegments; ring += 1) {
    const radius = (ring / radialSegments) * sphere.r;

    for (let segment = 0; segment < angularSegments; segment += 1) {
      const angle = (segment / angularSegments) * Math.PI * 2;
      const x = sphere.cx + Math.cos(angle) * radius;
      const y = sphere.cy + Math.sin(angle) * radius;
      pushVertex(positions, sphereUv, sphere, x, y);
    }
  }

  const indices: number[] = [];

  for (let segment = 0; segment < angularSegments; segment += 1) {
    indices.push(0, ringVertex(1, segment, angularSegments), ringVertex(1, segment + 1, angularSegments));
  }

  for (let ring = 1; ring < radialSegments; ring += 1) {
    for (let segment = 0; segment < angularSegments; segment += 1) {
      const innerCurrent = ringVertex(ring, segment, angularSegments);
      const innerNext = ringVertex(ring, segment + 1, angularSegments);
      const outerCurrent = ringVertex(ring + 1, segment, angularSegments);
      const outerNext = ringVertex(ring + 1, segment + 1, angularSegments);

      indices.push(innerCurrent, outerCurrent, innerNext);
      indices.push(innerNext, outerCurrent, outerNext);
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

function pushVertex(
  positions: number[],
  sphereUv: number[],
  sphere: SphereSurface,
  x: number,
  y: number,
): void {
  positions.push(x, y);
  sphereUv.push(
    (x - (sphere.cx - sphere.r)) / (sphere.r * 2),
    (y - (sphere.cy - sphere.r)) / (sphere.r * 2),
  );
}

function ringVertex(ring: number, segment: number, angularSegments: number): number {
  const wrappedSegment = ((segment % angularSegments) + angularSegments) % angularSegments;
  return 1 + (ring - 1) * angularSegments + wrappedSegment;
}

function normalizeSegment(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  // WHY: App 输入和网格生成共享同一套整数化规则，避免小数值在 UI 与渲染层产生不同网格。
  return Math.min(Math.max(Math.round(value), min), max);
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
