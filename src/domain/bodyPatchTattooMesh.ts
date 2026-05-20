import type { TpsControlPoint } from "./tpsTransformer";
import type {
  Point,
  Rect,
  Size,
  SkinMeshData,
  TattooTransform,
  TattooWarpDebugLine,
  TattooWarpDiagnostics,
  TattooWarpMeshData,
} from "./types";

interface PatchVertex {
  source: Point;
  stage: Point;
  generated: boolean;
}

interface BodyPatchMesh {
  positions: Float32Array;
  sourcePositions: Float32Array;
  indices: Uint32Array;
  diagnostics: {
    sourceTriangleCount: number;
    clippedTriangleCount: number;
    clippedVertexCount: number;
    generatedBoundaryVertexCount: number;
    stageAreaBefore: number;
    stageAreaAfter: number;
    sourceAreaCoverageRatio: number;
    sourceOutOfBoundsRatio: number;
    sourceFlipTriangleCount: number;
    sourceDegenerateTriangleCount: number;
    filteredTriangleCount: number;
  };
}

type SourceToStageMapper = (source: Point, tattooSize: Size, transform: TattooTransform) => Point;
type StageToSourceMapper = (stage: Point) => Point;
type ForwardSourceMapper = (source: Point) => Point;

export function buildBodyPatchWarpMesh(
  input: {
    bodyMesh: SkinMeshData;
    tattooSize: Size;
    transform: TattooTransform;
    selectionBounds?: Rect;
  },
  controlPoints: TpsControlPoint[],
  mapFlatTattooSourceToStage: SourceToStageMapper,
  mapWarpedTattooSourceToStage: ForwardSourceMapper,
): TattooWarpMeshData | null {
  const flatStageToSource = createFlatStageToSourceMapper(input.transform, input.tattooSize);
  const stageToSource = createNumericalStageToSourceMapper(
    input.tattooSize,
    flatStageToSource,
    mapWarpedTattooSourceToStage,
  );
  let patch = selectClippedBodyPatch(input.bodyMesh, input.tattooSize, stageToSource, input.selectionBounds);
  if (patch && shouldFallbackToFlatInverse(patch.diagnostics)) {
    patch = selectClippedBodyPatch(input.bodyMesh, input.tattooSize, flatStageToSource, input.selectionBounds);
  }
  if (!patch) {
    return null;
  }

  const uvs = new Float32Array(patch.sourcePositions.length);
  let maxDisplacementPx = 0;
  let totalDisplacementPx = 0;
  const controlPointResidual = measureControlPointResidual(controlPoints, stageToSource);

  for (let index = 0; index < patch.positions.length; index += 2) {
    const stagePoint = { x: patch.positions[index], y: patch.positions[index + 1] };
    const source = { x: patch.sourcePositions[index], y: patch.sourcePositions[index + 1] };
    const flat = mapFlatTattooSourceToStage(source, input.tattooSize, input.transform);
    const displacement = Math.hypot(stagePoint.x - flat.x, stagePoint.y - flat.y);
    uvs[index] = clamp01(source.x / Math.max(input.tattooSize.width, 1));
    uvs[index + 1] = clamp01(source.y / Math.max(input.tattooSize.height, 1));
    maxDisplacementPx = Math.max(maxDisplacementPx, displacement);
    totalDisplacementPx += displacement;
  }
  const controlDisplacement = measureControlPointDisplacement(
    controlPoints,
    input.tattooSize,
    input.transform,
    mapFlatTattooSourceToStage,
  );
  maxDisplacementPx = Math.max(maxDisplacementPx, controlDisplacement.max);
  totalDisplacementPx += controlDisplacement.mean * controlPoints.length;

  // WHY: body patch triangle 必须先裁到 tattoo 源图边界，否则移动时会像在拖动一个可见窗口。
  // TRADE-OFF: 裁剪会新增边界顶点，但保留 body mesh 的局部三角拓扑作为贴附表面。
  const diagnostics: TattooWarpDiagnostics = {
    mode: "body-patch",
    patchSelection: {
      sourceTriangleCount: patch.diagnostics.sourceTriangleCount,
      clippedTriangleCount: patch.diagnostics.clippedTriangleCount,
      clippedVertexCount: patch.diagnostics.clippedVertexCount,
      generatedBoundaryVertexCount: patch.diagnostics.generatedBoundaryVertexCount,
      filteredTriangleCount: patch.diagnostics.filteredTriangleCount,
      stageAreaBefore: patch.diagnostics.stageAreaBefore,
      stageAreaAfter: patch.diagnostics.stageAreaAfter,
      sourceAreaCoverageRatio: patch.diagnostics.sourceAreaCoverageRatio,
    },
    inverseMapping: {
      controlPointResidualMax: controlPointResidual.max,
      controlPointResidualMean: controlPointResidual.mean,
      sourceOutOfBoundsRatio: patch.diagnostics.sourceOutOfBoundsRatio,
      sourceFlipTriangleCount: patch.diagnostics.sourceFlipTriangleCount,
      sourceDegenerateTriangleCount: patch.diagnostics.sourceDegenerateTriangleCount,
    },
  };
  return {
    positions: patch.positions,
    uvs,
    indices: patch.indices,
    debugLines: buildBodyPatchDebugLines(patch.positions, patch.indices),
    controlPoints,
    diagnostics,
    stats: {
      maxDisplacementPx,
      meanDisplacementPx: totalDisplacementPx / Math.max(1, patch.positions.length / 2),
    },
  };
}

function shouldFallbackToFlatInverse(diagnostics: BodyPatchMesh["diagnostics"]): boolean {
  const triangleCount = Math.max(1, diagnostics.clippedTriangleCount);
  const flipRatio = diagnostics.sourceFlipTriangleCount / triangleCount;
  // WHY: 一旦 source/stage 局部映射出现反射，纹理会出现扇形镜像和裂缝；直接降级到 flat inverse 能稳定收敛。
  // TRADE-OFF: 会损失一部分局部弯曲细节，但避免“局部爆裂”这类不可接受的错误输出。
  return flipRatio > 0.02;
}

function createFlatStageToSourceMapper(transform: TattooTransform, tattooSize: Size): StageToSourceMapper {
  const safeScale = Math.max(transform.scale, 1e-6);
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return (stage) => {
    const dx = stage.x - transform.x;
    const dy = stage.y - transform.y;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    return {
      x: localX / safeScale + tattooSize.width / 2,
      y: localY / safeScale + tattooSize.height / 2,
    };
  };
}

function createNumericalStageToSourceMapper(
  tattooSize: Size,
  fallback: StageToSourceMapper,
  warpedForward: ForwardSourceMapper,
): StageToSourceMapper {
  return (stage) => {
    const solved = solveStageToSource(stage, tattooSize, fallback(stage), warpedForward);
    return solved ?? fallback(stage);
  };
}

function solveStageToSource(
  stage: Point,
  tattooSize: Size,
  initial: Point,
  warpedForward: ForwardSourceMapper,
): Point | null {
  let source = {
    x: clamp(initial.x, -tattooSize.width * 0.5, tattooSize.width * 1.5),
    y: clamp(initial.y, -tattooSize.height * 0.5, tattooSize.height * 1.5),
  };
  const epsilon = 0.5;
  const tolerance = 1e-2;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const mapped = warpedForward(source);
    const errorX = mapped.x - stage.x;
    const errorY = mapped.y - stage.y;
    if (Math.hypot(errorX, errorY) <= tolerance) {
      return source;
    }

    const plusX = warpedForward({ x: source.x + epsilon, y: source.y });
    const minusX = warpedForward({ x: source.x - epsilon, y: source.y });
    const plusY = warpedForward({ x: source.x, y: source.y + epsilon });
    const minusY = warpedForward({ x: source.x, y: source.y - epsilon });
    const j00 = (plusX.x - minusX.x) / (2 * epsilon);
    const j10 = (plusX.y - minusX.y) / (2 * epsilon);
    const j01 = (plusY.x - minusY.x) / (2 * epsilon);
    const j11 = (plusY.y - minusY.y) / (2 * epsilon);
    const determinant = j00 * j11 - j01 * j10;
    if (Math.abs(determinant) < 1e-8) {
      return null;
    }

    const deltaX = (j11 * errorX - j01 * errorY) / determinant;
    const deltaY = (-j10 * errorX + j00 * errorY) / determinant;
    source = {
      x: clamp(source.x - deltaX, -tattooSize.width * 0.5, tattooSize.width * 1.5),
      y: clamp(source.y - deltaY, -tattooSize.height * 0.5, tattooSize.height * 1.5),
    };
  }

  const last = warpedForward(source);
  if (Math.hypot(last.x - stage.x, last.y - stage.y) <= 1) {
    return source;
  }
  return null;
}

function selectClippedBodyPatch(
  mesh: SkinMeshData,
  tattooSize: Size,
  stageToSource: StageToSourceMapper,
  selectionBounds?: Rect,
): BodyPatchMesh | null {
  const vertexMap = new Map<string, number>();
  const positions: number[] = [];
  const sourcePositions: number[] = [];
  const indices: number[] = [];
  let sourceTriangleCount = 0;
  let outOfBoundsSourceVertexCount = 0;
  let rawSourceVertexCount = 0;
  let generatedBoundaryVertexCount = 0;
  let stageAreaBefore = 0;

  for (let index = 0; index < mesh.indices.length; index += 3) {
    if (selectionBounds && !triangleCentroidInRect(mesh.positions, mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2], selectionBounds)) {
      continue;
    }
    sourceTriangleCount += 1;
    stageAreaBefore += triangleAreaFromMesh(mesh.positions, mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]);
    const rawTriangle = [
      createPatchVertex(mesh.positions, mesh.indices[index], stageToSource),
      createPatchVertex(mesh.positions, mesh.indices[index + 1], stageToSource),
      createPatchVertex(mesh.positions, mesh.indices[index + 2], stageToSource),
    ];
    for (const vertex of rawTriangle) {
      rawSourceVertexCount += 1;
      if (vertex.source.x < 0 || vertex.source.x > tattooSize.width || vertex.source.y < 0 || vertex.source.y > tattooSize.height) {
        outOfBoundsSourceVertexCount += 1;
      }
    }

    const polygon = clipPolygonToTattooBounds([
      rawTriangle[0],
      rawTriangle[1],
      rawTriangle[2],
    ], tattooSize);

    if (polygon.length < 3) {
      continue;
    }

    const first = addPatchVertex(polygon[0], vertexMap, positions, sourcePositions);
    if (first.isNew && polygon[0].generated) {
      generatedBoundaryVertexCount += 1;
    }
    for (let vertex = 1; vertex < polygon.length - 1; vertex += 1) {
      const b = addPatchVertex(polygon[vertex], vertexMap, positions, sourcePositions);
      if (b.isNew && polygon[vertex].generated) {
        generatedBoundaryVertexCount += 1;
      }
      const c = addPatchVertex(polygon[vertex + 1], vertexMap, positions, sourcePositions);
      if (c.isNew && polygon[vertex + 1].generated) {
        generatedBoundaryVertexCount += 1;
      }
      indices.push(
        first.index,
        b.index,
        c.index,
      );
    }
  }

  if (positions.length < 6 || indices.length < 3) {
    return null;
  }

  const output: BodyPatchMesh = {
    positions: new Float32Array(positions),
    sourcePositions: new Float32Array(sourcePositions),
    indices: new Uint32Array(indices),
    diagnostics: {
      sourceTriangleCount,
      clippedTriangleCount: indices.length / 3,
      clippedVertexCount: positions.length / 2,
      generatedBoundaryVertexCount,
      stageAreaBefore,
      stageAreaAfter: 0,
      sourceAreaCoverageRatio: 0,
      sourceOutOfBoundsRatio: rawSourceVertexCount > 0 ? outOfBoundsSourceVertexCount / rawSourceVertexCount : 0,
      sourceFlipTriangleCount: 0,
      sourceDegenerateTriangleCount: 0,
      filteredTriangleCount: 0,
    },
  };
  const sanitizeResult = sanitizePatchTriangles(output.positions, output.sourcePositions, output.indices);
  output.indices = sanitizeResult.indices;
  output.diagnostics.filteredTriangleCount = sanitizeResult.filteredTriangleCount;
  const sourceBoundsArea = Math.max(1, tattooSize.width * tattooSize.height);
  output.diagnostics.stageAreaAfter = totalStageArea(output.positions, output.indices);
  const sourceAreaAfter = totalSourceArea(output.sourcePositions, output.indices);
  output.diagnostics.sourceAreaCoverageRatio = sourceAreaAfter / sourceBoundsArea;
  const sourceOrientation = sourceOrientationStats(output.positions, output.sourcePositions, output.indices);
  output.diagnostics.sourceFlipTriangleCount = sourceOrientation.flipCount;
  output.diagnostics.sourceDegenerateTriangleCount = sourceOrientation.degenerateCount;
  return output;
}

function createPatchVertex(
  positions: Float32Array,
  vertexIndex: number,
  stageToSource: StageToSourceMapper,
): PatchVertex {
  const stage = { x: positions[vertexIndex * 2], y: positions[vertexIndex * 2 + 1] };
  return { stage, source: stageToSource(stage), generated: false };
}

function addPatchVertex(
  vertex: PatchVertex,
  vertexMap: Map<string, number>,
  positions: number[],
  sourcePositions: number[],
): { index: number; isNew: boolean } {
  const key = [
    vertex.stage.x.toFixed(4),
    vertex.stage.y.toFixed(4),
    vertex.source.x.toFixed(4),
    vertex.source.y.toFixed(4),
  ].join(",");
  const existing = vertexMap.get(key);
  if (existing !== undefined) {
    return { index: existing, isNew: false };
  }

  const next = positions.length / 2;
  vertexMap.set(key, next);
  positions.push(vertex.stage.x, vertex.stage.y);
  sourcePositions.push(vertex.source.x, vertex.source.y);
  return { index: next, isNew: true };
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
    generated: true,
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function measureControlPointResidual(
  controlPoints: TpsControlPoint[],
  stageToSource: StageToSourceMapper,
): { max: number; mean: number } {
  let max = 0;
  let total = 0;

  for (const point of controlPoints) {
    const mapped = stageToSource(point.destination);
    const residual = Math.hypot(mapped.x - point.source.x, mapped.y - point.source.y);
    max = Math.max(max, residual);
    total += residual;
  }

  return {
    max,
    mean: controlPoints.length > 0 ? total / controlPoints.length : 0,
  };
}

function measureControlPointDisplacement(
  controlPoints: TpsControlPoint[],
  tattooSize: Size,
  transform: TattooTransform,
  mapFlatTattooSourceToStage: SourceToStageMapper,
): { max: number; mean: number } {
  let max = 0;
  let total = 0;
  for (const point of controlPoints) {
    const flat = mapFlatTattooSourceToStage(point.source, tattooSize, transform);
    const displacement = Math.hypot(point.destination.x - flat.x, point.destination.y - flat.y);
    max = Math.max(max, displacement);
    total += displacement;
  }
  return {
    max,
    mean: controlPoints.length > 0 ? total / controlPoints.length : 0,
  };
}

function triangleAreaFromMesh(positions: Float32Array, a: number, b: number, c: number): number {
  const ax = positions[a * 2];
  const ay = positions[a * 2 + 1];
  const bx = positions[b * 2];
  const by = positions[b * 2 + 1];
  const cx = positions[c * 2];
  const cy = positions[c * 2 + 1];
  return Math.abs(signedArea(ax, ay, bx, by, cx, cy));
}

function triangleCentroidInRect(
  positions: Float32Array,
  a: number,
  b: number,
  c: number,
  bounds: Rect,
): boolean {
  const centroidX = (positions[a * 2] + positions[b * 2] + positions[c * 2]) / 3;
  const centroidY = (positions[a * 2 + 1] + positions[b * 2 + 1] + positions[c * 2 + 1]) / 3;
  return centroidX >= bounds.x &&
    centroidX <= bounds.x + bounds.width &&
    centroidY >= bounds.y &&
    centroidY <= bounds.y + bounds.height;
}

function totalStageArea(positions: Float32Array, indices: Uint32Array): number {
  let area = 0;
  for (let index = 0; index < indices.length; index += 3) {
    area += triangleAreaFromMesh(positions, indices[index], indices[index + 1], indices[index + 2]);
  }
  return area;
}

function totalSourceArea(sourcePositions: Float32Array, indices: Uint32Array): number {
  let area = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];
    const ax = sourcePositions[a * 2];
    const ay = sourcePositions[a * 2 + 1];
    const bx = sourcePositions[b * 2];
    const by = sourcePositions[b * 2 + 1];
    const cx = sourcePositions[c * 2];
    const cy = sourcePositions[c * 2 + 1];
    area += Math.abs(signedArea(ax, ay, bx, by, cx, cy));
  }
  return area;
}

function sourceOrientationStats(
  stagePositions: Float32Array,
  sourcePositions: Float32Array,
  indices: Uint32Array,
): { flipCount: number; degenerateCount: number } {
  let flipCount = 0;
  let degenerateCount = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];
    const stageArea = signedArea(
      stagePositions[a * 2],
      stagePositions[a * 2 + 1],
      stagePositions[b * 2],
      stagePositions[b * 2 + 1],
      stagePositions[c * 2],
      stagePositions[c * 2 + 1],
    );
    const sourceArea = signedArea(
      sourcePositions[a * 2],
      sourcePositions[a * 2 + 1],
      sourcePositions[b * 2],
      sourcePositions[b * 2 + 1],
      sourcePositions[c * 2],
      sourcePositions[c * 2 + 1],
    );
    if (Math.abs(sourceArea) <= 1e-6) {
      degenerateCount += 1;
    }
    if (Math.sign(stageArea) !== Math.sign(sourceArea)) {
      flipCount += 1;
    }
  }
  return { flipCount, degenerateCount };
}

function signedArea(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * 0.5;
}

function sanitizePatchTriangles(
  stagePositions: Float32Array,
  sourcePositions: Float32Array,
  indices: Uint32Array,
): { indices: Uint32Array; filteredTriangleCount: number } {
  const keep: number[] = [];
  let filteredTriangleCount = 0;
  const minSourceArea = 1e-8;

  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];
    const sourceArea = signedArea(
      sourcePositions[a * 2],
      sourcePositions[a * 2 + 1],
      sourcePositions[b * 2],
      sourcePositions[b * 2 + 1],
      sourcePositions[c * 2],
      sourcePositions[c * 2 + 1],
    );
    const stageArea = signedArea(
      stagePositions[a * 2],
      stagePositions[a * 2 + 1],
      stagePositions[b * 2],
      stagePositions[b * 2 + 1],
      stagePositions[c * 2],
      stagePositions[c * 2 + 1],
    );
    const absSourceArea = Math.abs(sourceArea);

    if (absSourceArea <= minSourceArea) {
      filteredTriangleCount += 1;
      continue;
    }

    // WHY: source/stage 朝向不一致会导致局部镜像和锯齿裂缝；这里统一索引朝向，避免渲染期出现交替翻转。
    // TRADE-OFF: 这会掩盖部分上游逆映射噪声，但优先保证 mesh 连续可见，便于后续继续收敛 inverse 精度。
    if (Math.sign(sourceArea) !== Math.sign(stageArea)) {
      keep.push(a, c, b);
      continue;
    }

    keep.push(a, b, c);
  }

  return {
    indices: toUint32Array(keep),
    filteredTriangleCount,
  };
}

function toUint32Array(values: number[]): Uint32Array {
  const output = new Uint32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    output[index] = values[index];
  }
  return output;
}
