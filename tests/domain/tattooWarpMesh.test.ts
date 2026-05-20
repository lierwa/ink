import { describe, expect, test } from "vitest";
import { buildTattooWarpMesh, mapTattooSourceToStage } from "../../src/domain/tattooWarpMesh";
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

    expect(mesh).not.toBeNull();
    if (!mesh) {
      throw new Error("Expected tattoo warp mesh.");
    }

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
    expect(centerPosition.x).toBeGreaterThan(100);
    expect(centerPosition.x).toBeLessThan(380);
    expect(centerPosition.y).toBeGreaterThan(80);
    expect(centerPosition.y).toBeLessThan(280);
    expect(Math.hypot(centerPosition.x - flatCenter.x, centerPosition.y - flatCenter.y)).toBeGreaterThan(3);
    expect(mesh.stats.maxDisplacementPx).toBeGreaterThan(12);
    expect(mesh.stats.meanDisplacementPx).toBeGreaterThan(3);
    expect(mesh.controlPoints.length).toBeGreaterThanOrEqual(9);
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
    let hasCenterWarp = false;
    let hasTiltedAdjacentSegment = false;

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
      hasCenterWarp ||= isDisplacedFromFlatStage(start);
      hasCenterWarp ||= isDisplacedFromFlatStage(end);
      hasTiltedAdjacentSegment ||=
        Math.abs(end.destination.x - start.destination.x) > 1 &&
        Math.abs(end.destination.y - start.destination.y) > 1;
    }

    expect(hasAdjacentPair).toBe(true);
    expect(hasRightEdgeExpansion || hasCenterWarp || hasTiltedAdjacentSegment).toBe(true);
  });
});

function isDisplacedFromFlatStage(line: {
  source: { x: number; y: number };
  destination: { x: number; y: number };
}): boolean {
  const flat = mapTattooSourceToStage(line.source, { width: 200, height: 120 }, transform);
  return Math.hypot(line.destination.x - flat.x, line.destination.y - flat.y) > 3;
}
