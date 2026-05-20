import { createThinPlateSplineTransformer, type TpsControlPoint } from "./tpsTransformer";
import type { Point, Size, SkinMeshData, TattooTransform, TattooWarpDebugLine, TattooWarpMeshData } from "./types";

interface PatchVertex {
  source: Point;
  stage: Point;
}

interface BodyPatchMesh {
  positions: Float32Array;
  sourcePositions: Float32Array;
  indices: Uint32Array;
}

type SourceToStageMapper = (source: Point, tattooSize: Size, transform: TattooTransform) => Point;

export function buildBodyPatchWarpMesh(
  input: {
    bodyMesh: SkinMeshData;
    tattooSize: Size;
    transform: TattooTransform;
  },
  controlPoints: TpsControlPoint[],
  mapTattooSourceToStage: SourceToStageMapper,
): TattooWarpMeshData | null {
  const inverseTransformer = createInverseTransformer(controlPoints);
  const patch = selectClippedBodyPatch(input.bodyMesh, input.tattooSize, inverseTransformer);
  if (!patch) {
    return null;
  }

  const uvs = new Float32Array(patch.sourcePositions.length);
  let maxDisplacementPx = 0;
  let totalDisplacementPx = 0;

  for (let index = 0; index < patch.positions.length; index += 2) {
    const stagePoint = { x: patch.positions[index], y: patch.positions[index + 1] };
    const source = { x: patch.sourcePositions[index], y: patch.sourcePositions[index + 1] };
    const flat = mapTattooSourceToStage(source, input.tattooSize, input.transform);
    const displacement = Math.hypot(stagePoint.x - flat.x, stagePoint.y - flat.y);
    uvs[index] = clamp01(source.x / Math.max(input.tattooSize.width, 1));
    uvs[index + 1] = clamp01(source.y / Math.max(input.tattooSize.height, 1));
    maxDisplacementPx = Math.max(maxDisplacementPx, displacement);
    totalDisplacementPx += displacement;
  }

  // WHY: body patch triangle 必须先裁到 tattoo 源图边界，否则移动时会像在拖动一个可见窗口。
  // TRADE-OFF: 裁剪会新增边界顶点，但保留 body mesh 的局部三角拓扑作为贴附表面。
  return {
    positions: patch.positions,
    uvs,
    indices: patch.indices,
    debugLines: buildBodyPatchDebugLines(patch.positions, patch.indices),
    controlPoints,
    stats: {
      maxDisplacementPx,
      meanDisplacementPx: totalDisplacementPx / Math.max(1, patch.positions.length / 2),
    },
  };
}

function createInverseTransformer(controlPoints: TpsControlPoint[]): ReturnType<typeof createThinPlateSplineTransformer> {
  return createThinPlateSplineTransformer(controlPoints.map((point) => ({
    source: point.destination,
    destination: point.source,
  })));
}

function selectClippedBodyPatch(
  mesh: SkinMeshData,
  tattooSize: Size,
  inverseTransformer: ReturnType<typeof createThinPlateSplineTransformer>,
): BodyPatchMesh | null {
  const vertexMap = new Map<string, number>();
  const positions: number[] = [];
  const sourcePositions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < mesh.indices.length; index += 3) {
    const polygon = clipPolygonToTattooBounds([
      createPatchVertex(mesh.positions, mesh.indices[index], inverseTransformer),
      createPatchVertex(mesh.positions, mesh.indices[index + 1], inverseTransformer),
      createPatchVertex(mesh.positions, mesh.indices[index + 2], inverseTransformer),
    ], tattooSize);

    if (polygon.length < 3) {
      continue;
    }

    const first = addPatchVertex(polygon[0], vertexMap, positions, sourcePositions);
    for (let vertex = 1; vertex < polygon.length - 1; vertex += 1) {
      indices.push(
        first,
        addPatchVertex(polygon[vertex], vertexMap, positions, sourcePositions),
        addPatchVertex(polygon[vertex + 1], vertexMap, positions, sourcePositions),
      );
    }
  }

  if (positions.length < 6 || indices.length < 3) {
    return null;
  }

  return {
    positions: new Float32Array(positions),
    sourcePositions: new Float32Array(sourcePositions),
    indices: new Uint32Array(indices),
  };
}

function createPatchVertex(
  positions: Float32Array,
  vertexIndex: number,
  inverseTransformer: ReturnType<typeof createThinPlateSplineTransformer>,
): PatchVertex {
  const stage = { x: positions[vertexIndex * 2], y: positions[vertexIndex * 2 + 1] };
  return { stage, source: inverseTransformer.transform(stage) };
}

function addPatchVertex(
  vertex: PatchVertex,
  vertexMap: Map<string, number>,
  positions: number[],
  sourcePositions: number[],
): number {
  const key = [
    vertex.stage.x.toFixed(4),
    vertex.stage.y.toFixed(4),
    vertex.source.x.toFixed(4),
    vertex.source.y.toFixed(4),
  ].join(",");
  const existing = vertexMap.get(key);
  if (existing !== undefined) {
    return existing;
  }

  const next = positions.length / 2;
  vertexMap.set(key, next);
  positions.push(vertex.stage.x, vertex.stage.y);
  sourcePositions.push(vertex.source.x, vertex.source.y);
  return next;
}

function clipPolygonToTattooBounds(polygon: PatchVertex[], tattooSize: Size): PatchVertex[] {
  return clipPolygon(
    clipPolygon(
      clipPolygon(
        clipPolygon(polygon, (vertex) => vertex.source.x >= 0, (start, end) => interpolateAtSourceX(start, end, 0)),
        (vertex) => vertex.source.x <= tattooSize.width,
        (start, end) => interpolateAtSourceX(start, end, tattooSize.width),
      ),
      (vertex) => vertex.source.y >= 0,
      (start, end) => interpolateAtSourceY(start, end, 0),
    ),
    (vertex) => vertex.source.y <= tattooSize.height,
    (start, end) => interpolateAtSourceY(start, end, tattooSize.height),
  );
}

function clipPolygon(
  polygon: PatchVertex[],
  isInside: (vertex: PatchVertex) => boolean,
  intersect: (start: PatchVertex, end: PatchVertex) => PatchVertex,
): PatchVertex[] {
  if (polygon.length === 0) {
    return [];
  }

  const output: PatchVertex[] = [];
  let previous = polygon[polygon.length - 1];
  let previousInside = isInside(previous);

  for (const current of polygon) {
    const currentInside = isInside(current);
    if (currentInside && !previousInside) {
      output.push(intersect(previous, current));
    }
    if (currentInside) {
      output.push(current);
    }
    if (!currentInside && previousInside) {
      output.push(intersect(previous, current));
    }
    previous = current;
    previousInside = currentInside;
  }

  return output;
}

function interpolateAtSourceX(start: PatchVertex, end: PatchVertex, x: number): PatchVertex {
  return interpolatePatchVertex(start, end, ratioFor(start.source.x, end.source.x, x));
}

function interpolateAtSourceY(start: PatchVertex, end: PatchVertex, y: number): PatchVertex {
  return interpolatePatchVertex(start, end, ratioFor(start.source.y, end.source.y, y));
}

function ratioFor(start: number, end: number, value: number): number {
  const denominator = end - start;
  return denominator === 0 ? 0 : (value - start) / denominator;
}

function interpolatePatchVertex(start: PatchVertex, end: PatchVertex, ratio: number): PatchVertex {
  return {
    source: lerpPoint(start.source, end.source, ratio),
    stage: lerpPoint(start.stage, end.stage, ratio),
  };
}

function lerpPoint(start: Point, end: Point, ratio: number): Point {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function buildBodyPatchDebugLines(positions: Float32Array, indices: Uint32Array): TattooWarpDebugLine[] {
  const lines: TattooWarpDebugLine[] = [];

  for (let index = 0; index < indices.length; index += 3) {
    pushStageDebugSegment(lines, positions, indices[index], indices[index + 1]);
    pushStageDebugSegment(lines, positions, indices[index + 1], indices[index + 2]);
    pushStageDebugSegment(lines, positions, indices[index + 2], indices[index]);
  }

  return lines;
}

function pushStageDebugSegment(lines: TattooWarpDebugLine[], positions: Float32Array, startIndex: number, endIndex: number): void {
  const start = { x: positions[startIndex * 2], y: positions[startIndex * 2 + 1] };
  const end = { x: positions[endIndex * 2], y: positions[endIndex * 2 + 1] };
  lines.push({ source: start, destination: start }, { source: end, destination: end });
}
