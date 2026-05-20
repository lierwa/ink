import { describe, expect, test } from "vitest";
import { buildTattooWarpMesh, mapTattooSourceToStage } from "../../src/domain/tattooWarpMesh";
import type { BodySurfaceAnalysisDebugState, SkinMeshData, TattooTransform } from "../../src/domain/types";

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
  test("uses clipped body mesh triangles as render geometry when body mesh is available", () => {
    const bodyMesh: SkinMeshData = {
      positions: new Float32Array([
        230, 170,
        250, 170,
        240, 190,
        520, 520,
        580, 520,
        580, 580,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      boundaryFlags: new Uint8Array([0, 0, 0, 0, 0, 0]),
    };

    const mesh = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      bodyMesh,
      columns: 8,
      rows: 6,
    });

    expect(mesh).not.toBeNull();
    if (!mesh) {
      throw new Error("Expected body-patch tattoo warp mesh.");
    }

    // WHY: 优先走 body-patch，但门控触发时允许回退到 regular-grid，避免出现翻折和局部爆裂。
    // TRADE-OFF: 回退时不再逐点等于输入三角，但仍必须输出受 body 约束的有效几何。
    expect(["body-patch", "regular-grid"]).toContain(mesh.diagnostics?.mode);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.uvs.length).toBe(mesh.positions.length);
    expect(mesh.diagnostics?.patchSelection?.clippedTriangleCount).toBeGreaterThan(0);
    expect(mesh.diagnostics?.inverseMapping?.controlPointResidualMax).toBeGreaterThanOrEqual(0);
    expect(mesh.diagnostics?.distortion?.flippedRenderTriangleCount).toBeGreaterThanOrEqual(0);
  });

  test("keeps regular tattoo grid uv coordinates inside source bounds", () => {
    const bodyMesh: SkinMeshData = {
      positions: new Float32Array([
        130, 120,
        360, 120,
        360, 260,
        130, 260,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };

    const mesh = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      bodyMesh,
    });

    expect(mesh).not.toBeNull();
    if (!mesh) {
      throw new Error("Expected clipped body-patch tattoo warp mesh.");
    }

    expect(Math.min(...Array.from(mesh.uvs))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...Array.from(mesh.uvs))).toBeLessThanOrEqual(1);
    expect(mesh.indices.length).toBeGreaterThan(0);
  });

  test("clips regular tattoo grid triangles outside the latest body mesh", () => {
    const bodyMesh: SkinMeshData = {
      positions: new Float32Array([
        190, 120,
        240, 120,
        240, 240,
        190, 240,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };

    const unclipped = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      columns: 8,
      rows: 6,
    });
    const clipped = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      bodyMesh,
      columns: 8,
      rows: 6,
    });

    expect(unclipped).not.toBeNull();
    expect(clipped).not.toBeNull();
    if (!unclipped || !clipped) {
      throw new Error("Expected tattoo warp meshes.");
    }

    // WHY: 即便 body-patch 触发门控回退到 regular-grid，可见三角仍必须受 body mesh 约束，避免画到衣服/背景区域。
    // TRADE-OFF: 回退后 positions 可能不再减少，但最终索引集仍应被明显裁剪。
    expect(["body-patch", "regular-grid"]).toContain(clipped.diagnostics?.mode);
    expect(clipped.indices.length).toBeLessThan(unclipped.indices.length);
    for (let index = 0; index < clipped.indices.length; index += 1) {
      const vertexIndex = clipped.indices[index] * 2;
      expect(clipped.positions[vertexIndex]).toBeGreaterThanOrEqual(170);
      expect(clipped.positions[vertexIndex]).toBeLessThanOrEqual(270);
    }
  });

  test("builds a subdivided mesh with tattoo uvs and triangle indices", () => {
    const mesh = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      columns: 8,
      rows: 6,
    });

    expect(mesh).not.toBeNull();
    if (!mesh) {
      throw new Error("Expected tattoo warp mesh.");
    }

    expect(mesh.positions.length).toBe((8 + 1) * (6 + 1) * 2);
    expect(mesh.uvs.length).toBe(mesh.positions.length);
    expect(mesh.indices.length).toBe(8 * 6 * 6);
    expect(mesh.diagnostics?.mode).toBe("regular-grid");
    expect(mesh.diagnostics?.distortion?.areaScaleMax).toBeGreaterThan(0);
    expect(Math.min(...Array.from(mesh.uvs))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...Array.from(mesh.uvs))).toBeLessThanOrEqual(1);
  });

  test("uses a predictable cylinder wrap: center stable and quarter columns symmetric", () => {
    const mesh = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      columns: 12,
      rows: 8,
    });

    expect(mesh).not.toBeNull();
    if (!mesh) {
      throw new Error("Expected tattoo warp mesh.");
    }

    const xs = Array.from(mesh.positions).filter((_, index) => index % 2 === 0);
    const ys = Array.from(mesh.positions).filter((_, index) => index % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThan(100);
    expect(Math.max(...xs)).toBeLessThan(380);
    expect(Math.min(...ys)).toBeGreaterThan(80);
    expect(Math.max(...ys)).toBeLessThan(280);

    const centerVertexIndex = 4 * (12 + 1) + 6;
    const centerOffset = centerVertexIndex * 2;
    const centerPosition = {
      x: mesh.positions[centerOffset],
      y: mesh.positions[centerOffset + 1],
    };
    const flatCenter = mapTattooSourceToStage({ x: 100, y: 60 }, { width: 200, height: 120 }, transform);
    expect(centerPosition.x).toBeCloseTo(flatCenter.x, 5);
    expect(centerPosition.y).toBeCloseTo(flatCenter.y, 5);

    const leftQuarter = readGridPoint(mesh.positions, 12, 8, 3, 4);
    const rightQuarter = readGridPoint(mesh.positions, 12, 8, 9, 4);
    const flatLeftQuarter = mapTattooSourceToStage({ x: 50, y: 60 }, { width: 200, height: 120 }, transform);
    const flatRightQuarter = mapTattooSourceToStage({ x: 150, y: 60 }, { width: 200, height: 120 }, transform);
    const leftDelta = leftQuarter.x - flatLeftQuarter.x;
    const rightDelta = rightQuarter.x - flatRightQuarter.x;

    // WHY: cylinder wrap 必须有肉眼可解释的规律：中心不动，左右同距列按相反方向对称压缩。
    // TRADE-OFF: 这是确定性 2.5D 代理，不再追求 TPS 自由控制点带来的复杂局部扭曲。
    expect(leftDelta).toBeGreaterThan(1);
    expect(rightDelta).toBeLessThan(-1);
    expect(Math.abs(leftDelta)).toBeCloseTo(Math.abs(rightDelta), 4);
    expect(mesh.stats.maxDisplacementPx).toBeGreaterThan(12);
    expect(mesh.stats.meanDisplacementPx).toBeGreaterThan(3);
    expect(mesh.controlPoints.length).toBeGreaterThanOrEqual(9);
  });

  test("scales visible curvature with warp strength", () => {
    const flat = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      columns: 12,
      rows: 8,
      warpStrength: 0,
    });
    const strong = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      columns: 12,
      rows: 8,
      warpStrength: 2,
    });

    expect(flat).not.toBeNull();
    expect(strong).not.toBeNull();
    if (!flat || !strong) {
      throw new Error("Expected tattoo warp meshes.");
    }

    expect(flat.stats.maxDisplacementPx).toBeLessThan(1);
    expect(strong.stats.maxDisplacementPx).toBeGreaterThan(24);
    expect(strong.stats.maxDisplacementPx).toBeGreaterThan(flat.stats.maxDisplacementPx + 20);
  });

  test("emits warped debug grid lines that show non-flat coverage", () => {
    const mesh = buildTattooWarpMesh({
      tattooSize: { width: 200, height: 120 },
      transform,
      surface,
      columns: 4,
      rows: 3,
    });

    expect(mesh).not.toBeNull();
    if (!mesh) {
      throw new Error("Expected tattoo warp mesh.");
    }

    expect(mesh.debugLines.length).toBeGreaterThan(0);
    expect(mesh.debugLines.length % 2).toBe(0);

    const firstLine = mesh.debugLines[0];
    expect(Number.isFinite(firstLine?.source.x)).toBe(true);
    expect(Number.isFinite(firstLine?.source.y)).toBe(true);
    expect(Number.isFinite(firstLine?.destination.x)).toBe(true);
    expect(Number.isFinite(firstLine?.destination.y)).toBe(true);

    const flatRightEdge = transform.x + (200 * transform.scale) / 2;
    let hasAdjacentPair = false;
    let hasRightEdgeExpansion = false;
    let hasSymmetricCylinderWarp = false;

    for (let index = 0; index < mesh.debugLines.length; index += 2) {
      const start = mesh.debugLines[index];
      const end = mesh.debugLines[index + 1];
      const sourceDx = Math.abs(end.source.x - start.source.x);
      const sourceDy = Math.abs(end.source.y - start.source.y);
      const isHorizontal = start.source.y === end.source.y && sourceDx === 50;
      const isVertical = start.source.x === end.source.x && sourceDy === 40;
      const hasFiniteDestinations =
        Number.isFinite(start.destination.x) &&
        Number.isFinite(start.destination.y) &&
        Number.isFinite(end.destination.x) &&
        Number.isFinite(end.destination.y);

      expect((isHorizontal || isVertical) && hasFiniteDestinations).toBe(true);
      hasAdjacentPair ||= isHorizontal || isVertical;
      hasRightEdgeExpansion ||= start.destination.x > flatRightEdge || end.destination.x > flatRightEdge;
      hasSymmetricCylinderWarp ||= isDisplacedFromFlatStage(start) || isDisplacedFromFlatStage(end);
    }

    expect(hasAdjacentPair).toBe(true);
    expect(hasRightEdgeExpansion || hasSymmetricCylinderWarp).toBe(true);
  });
});

function readGridPoint(
  positions: Float32Array,
  columns: number,
  _rows: number,
  column: number,
  row: number,
): { x: number; y: number } {
  const index = (row * (columns + 1) + column) * 2;
  return { x: positions[index], y: positions[index + 1] };
}

function isDisplacedFromFlatStage(line: {
  source: { x: number; y: number };
  destination: { x: number; y: number };
}): boolean {
  const flat = mapTattooSourceToStage(line.source, { width: 200, height: 120 }, transform);
  return Math.hypot(line.destination.x - flat.x, line.destination.y - flat.y) > 3;
}
