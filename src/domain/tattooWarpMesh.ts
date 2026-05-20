import { createThinPlateSplineTransformer, type TpsControlPoint } from "./tpsTransformer";
import type {
  BodySurfaceAnalysisDebugState,
  Point,
  Size,
  TattooTransform,
  TattooWarpDebugLine,
  TattooWarpMeshData,
} from "./types";

export interface TattooWarpMeshInput {
  tattooSize: Size;
  transform: TattooTransform;
  surface: BodySurfaceAnalysisDebugState | null;
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
  const vertexCount = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 2);
  const uvs = new Float32Array(vertexCount * 2);
  const debugLines: TattooWarpDebugLine[] = [];
  const stats = fillVertices({ input, columns, rows, transformer, positions, uvs, debugLines });

  return {
    positions,
    uvs,
    indices: buildIndices(columns, rows),
    debugLines,
    controlPoints,
    stats,
  };
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
  debugLines: TattooWarpDebugLine[];
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
      appendDebugPoint(params.debugLines, source, warped, column, row, params.columns);
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

function appendDebugPoint(
  debugLines: TattooWarpDebugLine[],
  source: Point,
  destination: Point,
  column: number,
  row: number,
  columns: number,
): void {
  if (row % 2 === 0 || column === Math.floor(columns / 2)) {
    debugLines.push({ source, destination });
  }
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
