import { describe, expect, test } from "vitest";
import { buildTattooWarpMesh } from "../../src/domain/tattooWarpMesh";
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

    const firstLine = mesh.debugLines[0];
    expect(Number.isFinite(firstLine?.source.x)).toBe(true);
    expect(Number.isFinite(firstLine?.source.y)).toBe(true);
    expect(Number.isFinite(firstLine?.destination.x)).toBe(true);
    expect(Number.isFinite(firstLine?.destination.y)).toBe(true);

    const flatRightEdge = transform.x + (200 * transform.scale) / 2;
    const center = { x: 100, y: 60 };
    const flatCenter = { x: transform.x, y: transform.y };
    const hasRightEdgeExpansion = mesh.debugLines.some((line) => line.destination.x > flatRightEdge);
    const hasCenterWarp = mesh.debugLines.some(
      (line) =>
        Math.hypot(line.source.x - center.x, line.source.y - center.y) < 1 &&
        Math.hypot(line.destination.x - flatCenter.x, line.destination.y - flatCenter.y) > 3,
    );
    const hasTiltedAdjacentSegment = mesh.debugLines.some((line, index, lines) => {
      if (index === 0) {
        return false;
      }

      const previous = lines[index - 1];
      const sharesAxis =
        previous.source.x === line.source.x ||
        previous.source.y === line.source.y ||
        previous.destination.x === line.destination.x ||
        previous.destination.y === line.destination.y;

      return (
        sharesAxis &&
        Math.abs(line.destination.x - previous.destination.x) > 1 &&
        Math.abs(line.destination.y - previous.destination.y) > 1
      );
    });

    expect(hasRightEdgeExpansion || hasCenterWarp || hasTiltedAdjacentSegment).toBe(true);
  });
});
