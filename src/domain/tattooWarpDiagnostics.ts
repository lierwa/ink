import type { Rect, Size, SkinMeshData, TattooWarpDiagnostics } from "./types";

interface Triangle {
  a: number;
  b: number;
  c: number;
}

export function buildBodyMeshQualityDiagnostics(
  bodyMesh: SkinMeshData,
  tattooBounds: Rect,
): NonNullable<TattooWarpDiagnostics["bodyMeshQuality"]> {
  const searchBounds = expandRect(tattooBounds, Math.max(tattooBounds.width, tattooBounds.height) * 0.75);
  const localTriangles = collectLocalTriangles(bodyMesh, searchBounds);
  const vertexSet = new Set<number>();
  const areas: number[] = [];
  let badAspectCount = 0;

  for (const triangle of localTriangles) {
    vertexSet.add(triangle.a);
    vertexSet.add(triangle.b);
    vertexSet.add(triangle.c);
    const pa = readPoint(bodyMesh.positions, triangle.a);
    const pb = readPoint(bodyMesh.positions, triangle.b);
    const pc = readPoint(bodyMesh.positions, triangle.c);
    const area = Math.abs(signedArea(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y));
    areas.push(area);
    if (triangleAspectRatio(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y) > 6) {
      badAspectCount += 1;
    }
  }

  const boundaryFlags = bodyMesh.boundaryFlags;
  let boundaryVertexCount = 0;
  if (boundaryFlags) {
    for (const vertexIndex of vertexSet) {
      if (boundaryFlags[vertexIndex]) {
        boundaryVertexCount += 1;
      }
    }
  }

  return {
    localVertexCount: vertexSet.size,
    localTriangleCount: localTriangles.length,
    triangleAreaMin: areas.length > 0 ? Math.min(...areas) : 0,
    triangleAreaMean: areas.length > 0 ? areas.reduce((sum, area) => sum + area, 0) / areas.length : 0,
    triangleAreaMax: areas.length > 0 ? Math.max(...areas) : 0,
    badAspectTriangleRatio: localTriangles.length > 0 ? badAspectCount / localTriangles.length : 0,
    boundaryVertexRatio: vertexSet.size > 0 ? boundaryVertexCount / vertexSet.size : 0,
  };
}

export function buildDistortionDiagnostics(
  positions: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
  tattooSize: Size,
): NonNullable<TattooWarpDiagnostics["distortion"]> {
  let areaScaleMin = Number.POSITIVE_INFINITY;
  let areaScaleMax = 0;
  let areaScaleSum = 0;
  let areaScaleCount = 0;
  let maxStretchRatio = 0;
  let maxCompressionRatio = Number.POSITIVE_INFINITY;
  let flippedRenderTriangleCount = 0;

  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];
    const stageA = readPoint(positions, a);
    const stageB = readPoint(positions, b);
    const stageC = readPoint(positions, c);
    const sourceA = readSourcePoint(uvs, a, tattooSize);
    const sourceB = readSourcePoint(uvs, b, tattooSize);
    const sourceC = readSourcePoint(uvs, c, tattooSize);
    const stageSignedArea = signedArea(stageA.x, stageA.y, stageB.x, stageB.y, stageC.x, stageC.y);
    const sourceSignedArea = signedArea(sourceA.x, sourceA.y, sourceB.x, sourceB.y, sourceC.x, sourceC.y);
    const stageArea = Math.abs(stageSignedArea);
    const sourceArea = Math.abs(sourceSignedArea);

    if (Math.sign(stageSignedArea) !== Math.sign(sourceSignedArea)) {
      flippedRenderTriangleCount += 1;
    }

    if (sourceArea > 1e-6) {
      const areaScale = stageArea / sourceArea;
      areaScaleMin = Math.min(areaScaleMin, areaScale);
      areaScaleMax = Math.max(areaScaleMax, areaScale);
      areaScaleSum += areaScale;
      areaScaleCount += 1;
    }

    const stageLongestEdge = Math.max(
      distance(stageA.x, stageA.y, stageB.x, stageB.y),
      distance(stageB.x, stageB.y, stageC.x, stageC.y),
      distance(stageC.x, stageC.y, stageA.x, stageA.y),
    );
    const sourceLongestEdge = Math.max(
      distance(sourceA.x, sourceA.y, sourceB.x, sourceB.y),
      distance(sourceB.x, sourceB.y, sourceC.x, sourceC.y),
      distance(sourceC.x, sourceC.y, sourceA.x, sourceA.y),
    );
    const stageShortestEdge = Math.min(
      distance(stageA.x, stageA.y, stageB.x, stageB.y),
      distance(stageB.x, stageB.y, stageC.x, stageC.y),
      distance(stageC.x, stageC.y, stageA.x, stageA.y),
    );
    const sourceShortestEdge = Math.min(
      distance(sourceA.x, sourceA.y, sourceB.x, sourceB.y),
      distance(sourceB.x, sourceB.y, sourceC.x, sourceC.y),
      distance(sourceC.x, sourceC.y, sourceA.x, sourceA.y),
    );
    if (sourceLongestEdge > 1e-6) {
      maxStretchRatio = Math.max(maxStretchRatio, stageLongestEdge / sourceLongestEdge);
    }
    if (sourceShortestEdge > 1e-6) {
      maxCompressionRatio = Math.min(maxCompressionRatio, stageShortestEdge / sourceShortestEdge);
    }
  }

  return {
    areaScaleMin: areaScaleCount > 0 ? areaScaleMin : 0,
    areaScaleMean: areaScaleCount > 0 ? areaScaleSum / areaScaleCount : 0,
    areaScaleMax: areaScaleCount > 0 ? areaScaleMax : 0,
    maxStretchRatio,
    maxCompressionRatio: maxCompressionRatio === Number.POSITIVE_INFINITY ? 0 : maxCompressionRatio,
    flippedRenderTriangleCount,
  };
}

function collectLocalTriangles(mesh: SkinMeshData, bounds: Rect): Triangle[] {
  const output: Triangle[] = [];
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = mesh.indices[index];
    const b = mesh.indices[index + 1];
    const c = mesh.indices[index + 2];
    const pa = readPoint(mesh.positions, a);
    const pb = readPoint(mesh.positions, b);
    const pc = readPoint(mesh.positions, c);
    const centroid = {
      x: (pa.x + pb.x + pc.x) / 3,
      y: (pa.y + pb.y + pc.y) / 3,
    };
    if (pointInsideRect(centroid.x, centroid.y, bounds)) {
      output.push({ a, b, c });
    }
  }
  return output;
}

function readPoint(positions: Float32Array, vertexIndex: number): { x: number; y: number } {
  return {
    x: positions[vertexIndex * 2],
    y: positions[vertexIndex * 2 + 1],
  };
}

function readSourcePoint(uvs: Float32Array, vertexIndex: number, tattooSize: Size): { x: number; y: number } {
  return {
    x: uvs[vertexIndex * 2] * tattooSize.width,
    y: uvs[vertexIndex * 2 + 1] * tattooSize.height,
  };
}

function pointInsideRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function expandRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function signedArea(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * 0.5;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function triangleAspectRatio(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const edges = [
    distance(ax, ay, bx, by),
    distance(bx, by, cx, cy),
    distance(cx, cy, ax, ay),
  ];
  const longest = Math.max(...edges);
  const shortest = Math.max(1e-6, Math.min(...edges));
  return longest / shortest;
}
