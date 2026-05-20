import { createThinPlateSplineTransformer, type TpsControlPoint } from "./tpsTransformer";
import type {
  BodySurfaceAnalysisDebugState,
  Point,
  Size,
  SkinMeshData,
  TattooTransform,
  TattooWarpDebugLine,
  TattooWarpMeshData,
} from "./types";

export interface TattooWarpMeshInput {
  tattooSize: Size;
  transform: TattooTransform;
  surface: BodySurfaceAnalysisDebugState | null;
  bodyMesh?: SkinMeshData;
  columns?: number;
  rows?: number;
}

interface SurfaceBasis {
  origin: Point;
  along: Point;
  across: Point;
  acrossCurvature: number;
  alongCurvature: number;
  edgeTurn: number;
}

const CONTROL_X_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;
const CONTROL_Y_FRACTIONS = [0, 0.5, 1] as const;

export function buildTattooWarpMesh(input: TattooWarpMeshInput): TattooWarpMeshData | null {
  const basis = getSurfaceBasis(input.surface);
  if (!basis) {
    return null;
  }

  const columns = clampInteger(input.columns ?? 24, 2, 64);
  const rows = clampInteger(input.rows ?? 32, 2, 96);
  const controlPoints = buildControlPoints(input.tattooSize, input.transform, basis);
  const transformer = createThinPlateSplineTransformer(controlPoints);
  const bodyPatchMesh = input.bodyMesh
    ? buildBodyPatchWarpMesh({ ...input, bodyMesh: input.bodyMesh }, controlPoints, createInverseTransformer(controlPoints))
    : null;

  if (bodyPatchMesh) {
    return bodyPatchMesh;
  }

  const vertexCount = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 2);
  const uvs = new Float32Array(vertexCount * 2);
  const stats = fillVertices({ input, columns, rows, transformer, positions, uvs });

  return {
    positions,
    uvs,
    indices: buildIndices(columns, rows),
    debugLines: buildDebugLines(input.tattooSize, columns, rows, transformer),
    controlPoints,
    stats,
  };
}

function createInverseTransformer(controlPoints: TpsControlPoint[]): ReturnType<typeof createThinPlateSplineTransformer> {
  return createThinPlateSplineTransformer(controlPoints.map((point) => ({
    source: point.destination,
    destination: point.source,
  })));
}

function buildBodyPatchWarpMesh(
  input: TattooWarpMeshInput & { bodyMesh: SkinMeshData },
  controlPoints: TpsControlPoint[],
  inverseTransformer: ReturnType<typeof createThinPlateSplineTransformer>,
): TattooWarpMeshData | null {
  const patch = selectBodyPatchTriangles(input.bodyMesh, getTattooStageBounds(input.tattooSize, input.transform));
  if (!patch) {
    return null;
  }

  const uvs = new Float32Array(patch.positions.length);
  let maxDisplacementPx = 0;
  let totalDisplacementPx = 0;

  for (let index = 0; index < patch.positions.length; index += 2) {
    const stagePoint = { x: patch.positions[index], y: patch.positions[index + 1] };
    const source = inverseTransformer.transform(stagePoint);
    const flat = mapTattooSourceToStage(source, input.tattooSize, input.transform);
    const displacement = Math.hypot(stagePoint.x - flat.x, stagePoint.y - flat.y);
    uvs[index] = source.x / Math.max(input.tattooSize.width, 1);
    uvs[index + 1] = source.y / Math.max(input.tattooSize.height, 1);
    maxDisplacementPx = Math.max(maxDisplacementPx, displacement);
    totalDisplacementPx += displacement;
  }

  // WHY: 真正贴附时 geometry 应来自 body 局部三角 patch，tattoo 只通过 UV 采样；
  // TRADE-OFF: patch 边缘 UV 可能略超出 0..1，交给 shader 丢弃可避免复制/裁剪 body 三角形。
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

function selectBodyPatchTriangles(mesh: SkinMeshData, bounds: { minX: number; minY: number; maxX: number; maxY: number }): SkinMeshData | null {
  const vertexMap = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < mesh.indices.length; index += 3) {
    const triangle = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]] as const;
    if (!triangleIntersectsBounds(mesh.positions, triangle, bounds)) {
      continue;
    }

    for (const sourceIndex of triangle) {
      const mapped = getOrAddPatchVertex(sourceIndex, mesh.positions, vertexMap, positions);
      indices.push(mapped);
    }
  }

  if (positions.length < 6 || indices.length < 3) {
    return null;
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function getOrAddPatchVertex(
  sourceIndex: number,
  sourcePositions: Float32Array,
  vertexMap: Map<number, number>,
  positions: number[],
): number {
  const existing = vertexMap.get(sourceIndex);
  if (existing !== undefined) {
    return existing;
  }

  const nextIndex = positions.length / 2;
  vertexMap.set(sourceIndex, nextIndex);
  positions.push(sourcePositions[sourceIndex * 2], sourcePositions[sourceIndex * 2 + 1]);
  return nextIndex;
}

function getTattooStageBounds(tattooSize: Size, transform: TattooTransform): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = [
    mapTattooSourceToStage({ x: 0, y: 0 }, tattooSize, transform),
    mapTattooSourceToStage({ x: tattooSize.width, y: 0 }, tattooSize, transform),
    mapTattooSourceToStage({ x: tattooSize.width, y: tattooSize.height }, tattooSize, transform),
    mapTattooSourceToStage({ x: 0, y: tattooSize.height }, tattooSize, transform),
  ];

  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

function triangleIntersectsBounds(
  positions: Float32Array,
  triangle: readonly [number, number, number],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  const points = triangle.map((vertexIndex) => ({
    x: positions[vertexIndex * 2],
    y: positions[vertexIndex * 2 + 1],
  }));

  return points.some((point) => pointInsideBounds(point, bounds)) ||
    rectCorners(bounds).some((point) => pointInTriangle(point, points[0], points[1], points[2])) ||
    triangleEdges(points).some(([start, end]) => rectEdges(bounds).some(([rectStart, rectEnd]) => segmentsIntersect(start, end, rectStart, rectEnd)));
}

function pointInsideBounds(point: Point, bounds: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

function rectCorners(bounds: { minX: number; minY: number; maxX: number; maxY: number }): Point[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

function triangleEdges(points: Point[]): Array<[Point, Point]> {
  return [[points[0], points[1]], [points[1], points[2]], [points[2], points[0]]];
}

function rectEdges(bounds: { minX: number; minY: number; maxX: number; maxY: number }): Array<[Point, Point]> {
  const corners = rectCorners(bounds);
  return [[corners[0], corners[1]], [corners[1], corners[2]], [corners[2], corners[3]], [corners[3], corners[0]]];
}

function pointInTriangle(point: Point, a: Point, b: Point, c: Point): boolean {
  const area = cross(a, b, c);
  const first = cross(point, a, b);
  const second = cross(point, b, c);
  const third = cross(point, c, a);
  return area >= 0
    ? first >= 0 && second >= 0 && third >= 0
    : first <= 0 && second <= 0 && third <= 0;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);

  if (abC === 0 && pointOnSegment(c, a, b)) return true;
  if (abD === 0 && pointOnSegment(d, a, b)) return true;
  if (cdA === 0 && pointOnSegment(a, c, d)) return true;
  if (cdB === 0 && pointOnSegment(b, c, d)) return true;

  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  return point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y);
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
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

export function mapTattooSourceToStage(source: Point, tattooSize: Size, transform: TattooTransform): Point {
  const centeredX = (source.x - tattooSize.width / 2) * transform.scale;
  const centeredY = (source.y - tattooSize.height / 2) * transform.scale;
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);

  return {
    x: transform.x + centeredX * cos - centeredY * sin,
    y: transform.y + centeredX * sin + centeredY * cos,
  };
}

function getSurfaceBasis(surface: BodySurfaceAnalysisDebugState | null): SurfaceBasis | null {
  if (!surface?.axis || !surface.curvature || surface.source !== "local-mesh") {
    return null;
  }

  const along = normalize(surface.axis.direction);
  return {
    origin: surface.axis.origin,
    along,
    across: { x: along.y, y: -along.x },
    acrossCurvature: surface.curvature.acrossAxis,
    alongCurvature: surface.curvature.alongAxis,
    edgeTurn: surface.edgeTurn ?? 0.5,
  };
}

function buildControlPoints(tattooSize: Size, transform: TattooTransform, basis: SurfaceBasis): TpsControlPoint[] {
  return CONTROL_Y_FRACTIONS.flatMap((yFraction) =>
    CONTROL_X_FRACTIONS.map((xFraction) => {
      const source = { x: tattooSize.width * xFraction, y: tattooSize.height * yFraction };
      const flat = mapTattooSourceToStage(source, tattooSize, transform);
      return { source, destination: bendFlatPoint(flat, source, tattooSize, transform, basis) };
    }),
  );
}

function bendFlatPoint(
  flat: Point,
  source: Point,
  tattooSize: Size,
  transform: TattooTransform,
  basis: SurfaceBasis,
): Point {
  const normalizedX = normalizeSigned(source.x, tattooSize.width);
  const normalizedY = normalizeSigned(source.y, tattooSize.height);
  const stageWidth = tattooSize.width * transform.scale;
  const stageHeight = tattooSize.height * transform.scale;
  const acrossAmplitude = Math.max(14, stageWidth * basis.acrossCurvature * basis.edgeTurn * 0.32);
  const centerAmplitude = Math.max(5, stageWidth * basis.acrossCurvature * 0.12);
  const alongAmplitude = stageHeight * basis.alongCurvature * 0.22;
  const centerWeight = (1 - normalizedX * normalizedX) * (1 - Math.abs(normalizedY) * 0.35);
  const edgeTurn = normalizedX * Math.abs(normalizedX) * acrossAmplitude;

  // WHY: 控制点先用局部轴系表达“横向包裹 + 中央鼓起”，再交给 TPS 生成平滑网格；
  // TRADE-OFF: 这是几何代理而非真实 3D 投影，但保留了可解释参数，并让纹身边缘明显随身体曲面转折。
  const acrossOffset = edgeTurn + centerWeight * centerAmplitude;
  const alongOffset = normalizedY * Math.abs(normalizedY) * alongAmplitude;

  return {
    x: flat.x + basis.across.x * acrossOffset + basis.along.x * alongOffset,
    y: flat.y + basis.across.y * acrossOffset + basis.along.y * alongOffset,
  };
}

function fillVertices(params: {
  input: TattooWarpMeshInput;
  columns: number;
  rows: number;
  transformer: ReturnType<typeof createThinPlateSplineTransformer>;
  positions: Float32Array;
  uvs: Float32Array;
}): TattooWarpMeshData["stats"] {
  let maxDisplacementPx = 0;
  let totalDisplacementPx = 0;

  for (let row = 0; row <= params.rows; row += 1) {
    for (let column = 0; column <= params.columns; column += 1) {
      const index = row * (params.columns + 1) + column;
      const source = sourceAt(params.input.tattooSize, column / params.columns, row / params.rows);
      const flat = mapTattooSourceToStage(source, params.input.tattooSize, params.input.transform);
      const warped = params.transformer.transform(source);
      const displacement = Math.hypot(warped.x - flat.x, warped.y - flat.y);
      maxDisplacementPx = Math.max(maxDisplacementPx, displacement);
      totalDisplacementPx += displacement;
      writeVertex(params.positions, params.uvs, index, warped, column / params.columns, row / params.rows);
    }
  }

  return {
    maxDisplacementPx,
    meanDisplacementPx: totalDisplacementPx / ((params.columns + 1) * (params.rows + 1)),
  };
}

function buildIndices(columns: number, rows: number): Uint32Array {
  const indices = new Uint32Array(columns * rows * 6);
  let writeIndex = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * (columns + 1) + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns + 1;
      const bottomRight = bottomLeft + 1;
      indices.set([topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight], writeIndex);
      writeIndex += 6;
    }
  }

  return indices;
}

function buildDebugLines(
  tattooSize: Size,
  columns: number,
  rows: number,
  transformer: ReturnType<typeof createThinPlateSplineTransformer>,
): TattooWarpDebugLine[] {
  const debugLines: TattooWarpDebugLine[] = [];

  for (let column = 0; column <= columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      pushDebugLine(debugLines, transformer, [
        sourceAt(tattooSize, column / columns, row / rows),
        sourceAt(tattooSize, column / columns, (row + 1) / rows),
      ]);
    }
  }

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      pushDebugLine(debugLines, transformer, [
        sourceAt(tattooSize, column / columns, row / rows),
        sourceAt(tattooSize, (column + 1) / columns, row / rows),
      ]);
    }
  }

  return debugLines;
}

function pushDebugLine(
  debugLines: TattooWarpDebugLine[],
  transformer: ReturnType<typeof createThinPlateSplineTransformer>,
  endpoints: [Point, Point],
): void {
  // WHY: 调试渲染器按 [0,1]、[2,3] 消费端点，必须在域层保持相邻线段边界；
  // TRADE-OFF: 这里会重复共享顶点，但换来渲染端零状态、无索引重建的简单协议。
  debugLines.push(
    { source: endpoints[0], destination: transformer.transform(endpoints[0]) },
    { source: endpoints[1], destination: transformer.transform(endpoints[1]) },
  );
}

function writeVertex(
  positions: Float32Array,
  uvs: Float32Array,
  index: number,
  position: Point,
  u: number,
  v: number,
): void {
  const offset = index * 2;
  positions[offset] = position.x;
  positions[offset + 1] = position.y;
  uvs[offset] = u;
  uvs[offset + 1] = v;
}

function sourceAt(tattooSize: Size, xFraction: number, yFraction: number): Point {
  return { x: tattooSize.width * xFraction, y: tattooSize.height * yFraction };
}

function normalizeSigned(value: number, size: number): number {
  if (size <= 0) {
    return 0;
  }

  return (value / size) * 2 - 1;
}

function normalize(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) {
    return { x: 0, y: 1 };
  }

  return { x: vector.x / length, y: vector.y / length };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
