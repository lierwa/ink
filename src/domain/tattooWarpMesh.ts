import type {
  BodySurfaceAnalysisDebugState,
  Point,
  Rect,
  Size,
  SkinMeshData,
  TattooWarpDiagnostics,
  TattooTransform,
  TattooWarpDebugLine,
  TattooWarpMeshData,
} from "./types";
import { buildBodyPatchWarpMesh } from "./bodyPatchTattooMesh";
import { buildBodyMeshQualityDiagnostics, buildDistortionDiagnostics } from "./tattooWarpDiagnostics";

export interface TattooWarpMeshInput {
  tattooSize: Size;
  transform: TattooTransform;
  surface: BodySurfaceAnalysisDebugState | null;
  bodyMesh?: SkinMeshData;
  columns?: number;
  rows?: number;
  warpStrength?: number;
}

interface SurfaceBasis {
  origin: Point;
  along: Point;
  across: Point;
  acrossCurvature: number;
  alongCurvature: number;
  edgeTurn: number;
  warpStrength: number;
}

const CONTROL_X_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;
const CONTROL_Y_FRACTIONS = [0, 0.5, 1] as const;

export function buildTattooWarpMesh(input: TattooWarpMeshInput): TattooWarpMeshData | null {
  const basis = getSurfaceBasis(input.surface, input.warpStrength);
  if (!basis) {
    return null;
  }

  const columns = clampInteger(input.columns ?? 24, 2, 64);
  const rows = clampInteger(input.rows ?? 32, 2, 96);
  const controlPoints = buildControlPoints(input.tattooSize, input.transform, basis);
  const tattooBounds = createTattooBounds(input.tattooSize, input.transform);
  const bodyMeshQuality = input.bodyMesh
    ? buildBodyMeshQualityDiagnostics(input.bodyMesh, tattooBounds)
    : undefined;
  const mapWarpedTattooSourceToStage = (source: Point) =>
    bendSourcePoint(source, input.tattooSize, input.transform, basis);
  // WHY: 有 body mesh 时，最终 tattoo geometry 必须使用身体局部三角点；否则只是独立贴纸网格按参数弯曲，无法表达真实贴肤关系。
  // TRADE-OFF: body patch 会继承身体三角密度和边界裁剪复杂度，但避免“看似贴合、实际无关”的规则网格。
  const bodyPatchMesh = canUseBodyPatch(input.bodyMesh)
    ? buildBodyPatchWarpMesh({
      bodyMesh: input.bodyMesh,
      tattooSize: input.tattooSize,
      transform: input.transform,
      selectionBounds: expandRect(tattooBounds, Math.max(tattooBounds.width, tattooBounds.height) * 0.4),
    }, controlPoints, mapTattooSourceToStage, mapWarpedTattooSourceToStage)
    : null;
  let rejectedPatchDiagnostics: TattooWarpDiagnostics | undefined;
  if (bodyPatchMesh) {
    bodyPatchMesh.diagnostics = {
      ...bodyPatchMesh.diagnostics,
      mode: "body-patch",
      bodyMeshQuality,
      distortion: buildDistortionDiagnostics(
        bodyPatchMesh.positions,
        bodyPatchMesh.uvs,
        bodyPatchMesh.indices,
        input.tattooSize,
      ),
    };
    // WHY: body patch 一旦出现 source 翻折或极端压缩，会直接把图案挤爆；这里优先稳定视觉再继续定位细节根因。
    // TRADE-OFF: 触发门控时回退到 regular-grid，暂时牺牲局部贴附强度，换取不出现灾难性形变。
    if (shouldUseBodyPatchMesh(bodyPatchMesh.diagnostics)) {
      return bodyPatchMesh;
    }
    rejectedPatchDiagnostics = bodyPatchMesh.diagnostics;
  }

  const vertexCount = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 2);
  const uvs = new Float32Array(vertexCount * 2);
  const stats = fillVertices({ input, columns, rows, basis, positions, uvs });
  const indices = buildIndices(columns, rows, positions, input.bodyMesh);

  const diagnostics: TattooWarpDiagnostics = {
    mode: "regular-grid",
    bodyMeshQuality,
    patchSelection: rejectedPatchDiagnostics?.patchSelection,
    inverseMapping: rejectedPatchDiagnostics?.inverseMapping,
    distortion: buildDistortionDiagnostics(positions, uvs, indices, input.tattooSize),
  };
  return {
    positions,
    uvs,
    indices,
    debugLines: buildDebugLines(input, basis, columns, rows),
    controlPoints,
    stats,
    diagnostics,
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

function getSurfaceBasis(surface: BodySurfaceAnalysisDebugState | null, warpStrength = 1): SurfaceBasis | null {
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
    warpStrength: clamp(warpStrength, 0, 2),
  };
}

function buildControlPoints(tattooSize: Size, transform: TattooTransform, basis: SurfaceBasis): Array<{ source: Point; destination: Point }> {
  return CONTROL_Y_FRACTIONS.flatMap((yFraction) =>
    CONTROL_X_FRACTIONS.map((xFraction) => {
      const source = { x: tattooSize.width * xFraction, y: tattooSize.height * yFraction };
      return { source, destination: bendSourcePoint(source, tattooSize, transform, basis) };
    }),
  );
}

function bendSourcePoint(
  source: Point,
  tattooSize: Size,
  transform: TattooTransform,
  basis: SurfaceBasis,
): Point {
  const flat = mapTattooSourceToStage(source, tattooSize, transform);
  const normalizedX = normalizeSigned(source.x, tattooSize.width);
  const halfWidth = (tattooSize.width * transform.scale) / 2;
  const compression = clamp(basis.warpStrength * (1.1 + basis.acrossCurvature * 1.2 + basis.edgeTurn * 0.6), 0, 6);
  if (compression < 0.0001 || halfWidth <= 0) {
    return flat;
  }

  const projectedAcross = halfWidth * Math.tanh(normalizedX * compression) / compression;
  const flatAcross = halfWidth * normalizedX;
  // WHY: 使用单调压缩核，避免强弯曲时出现数学折返（非单调）导致的三角翻折和洞。
  // TRADE-OFF: tanh 比 sin 少一点“滚筒感”，但能保证可逆、稳定，便于 body-patch 反算 source UV。
  const acrossOffset = projectedAcross - flatAcross;

  return {
    x: flat.x + basis.across.x * acrossOffset,
    y: flat.y + basis.across.y * acrossOffset,
  };
}

function fillVertices(params: {
  input: TattooWarpMeshInput;
  columns: number;
  rows: number;
  basis: SurfaceBasis;
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
      const warped = bendSourcePoint(source, params.input.tattooSize, params.input.transform, params.basis);
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

function buildIndices(
  columns: number,
  rows: number,
  positions: Float32Array,
  bodyMesh?: SkinMeshData,
): Uint32Array {
  const indices: number[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * (columns + 1) + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns + 1;
      const bottomRight = bottomLeft + 1;
      pushTriangleIfInsideBody(indices, positions, bodyMesh, topLeft, bottomLeft, topRight);
      pushTriangleIfInsideBody(indices, positions, bodyMesh, topRight, bottomLeft, bottomRight);
    }
  }

  return new Uint32Array(indices);
}

function pushTriangleIfInsideBody(
  indices: number[],
  positions: Float32Array,
  bodyMesh: SkinMeshData | undefined,
  a: number,
  b: number,
  c: number,
): void {
  if (!bodyMesh || pointInsideMesh(triangleCenter(positions, a, b, c), bodyMesh)) {
    indices.push(a, b, c);
  }
}

function triangleCenter(positions: Float32Array, a: number, b: number, c: number): Point {
  return {
    x: (positions[a * 2] + positions[b * 2] + positions[c * 2]) / 3,
    y: (positions[a * 2 + 1] + positions[b * 2 + 1] + positions[c * 2 + 1]) / 3,
  };
}

function pointInsideMesh(point: Point, mesh: SkinMeshData): boolean {
  for (let index = 0; index < mesh.indices.length; index += 3) {
    if (pointInsideTriangle(
      point,
      readMeshPoint(mesh.positions, mesh.indices[index]),
      readMeshPoint(mesh.positions, mesh.indices[index + 1]),
      readMeshPoint(mesh.positions, mesh.indices[index + 2]),
    )) {
      return true;
    }
  }

  return false;
}

function readMeshPoint(positions: Float32Array, vertexIndex: number): Point {
  return {
    x: positions[vertexIndex * 2],
    y: positions[vertexIndex * 2 + 1],
  };
}

function pointInsideTriangle(point: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = signedTriangleArea(point, a, b);
  const d2 = signedTriangleArea(point, b, c);
  const d3 = signedTriangleArea(point, c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function signedTriangleArea(a: Point, b: Point, c: Point): number {
  return (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
}

function buildDebugLines(
  input: TattooWarpMeshInput,
  basis: SurfaceBasis,
  columns: number,
  rows: number,
): TattooWarpDebugLine[] {
  const debugLines: TattooWarpDebugLine[] = [];

  for (let column = 0; column <= columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      pushDebugLine(debugLines, input, basis, [
        sourceAt(input.tattooSize, column / columns, row / rows),
        sourceAt(input.tattooSize, column / columns, (row + 1) / rows),
      ]);
    }
  }

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      pushDebugLine(debugLines, input, basis, [
        sourceAt(input.tattooSize, column / columns, row / rows),
        sourceAt(input.tattooSize, (column + 1) / columns, row / rows),
      ]);
    }
  }

  return debugLines;
}

function pushDebugLine(
  debugLines: TattooWarpDebugLine[],
  input: TattooWarpMeshInput,
  basis: SurfaceBasis,
  endpoints: [Point, Point],
): void {
  // WHY: 调试渲染器按 [0,1]、[2,3] 消费端点，必须在域层保持相邻线段边界；
  // TRADE-OFF: 这里会重复共享顶点，但换来渲染端零状态、无索引重建的简单协议。
  debugLines.push(
    { source: endpoints[0], destination: bendSourcePoint(endpoints[0], input.tattooSize, input.transform, basis) },
    { source: endpoints[1], destination: bendSourcePoint(endpoints[1], input.tattooSize, input.transform, basis) },
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createTattooBounds(tattooSize: Size, transform: TattooTransform): Rect {
  const width = tattooSize.width * transform.scale;
  const height = tattooSize.height * transform.scale;
  return {
    x: transform.x - width / 2,
    y: transform.y - height / 2,
    width,
    height,
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

function shouldUseBodyPatchMesh(diagnostics: TattooWarpDiagnostics | undefined): boolean {
  if (!diagnostics) {
    return false;
  }
  const clippedTriangleCount = diagnostics.patchSelection?.clippedTriangleCount ?? 0;
  if (clippedTriangleCount < 1) {
    return false;
  }
  if ((diagnostics.patchSelection?.sourceAreaCoverageRatio ?? 0) < 0.001) {
    return false;
  }
  return true;
}

function canUseBodyPatch(bodyMesh: SkinMeshData | undefined): bodyMesh is SkinMeshData {
  if (!bodyMesh) {
    return false;
  }
  return bodyMesh.positions.length >= 6 && bodyMesh.indices.length >= 3;
}
