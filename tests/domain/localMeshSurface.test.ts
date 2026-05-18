import { describe, expect, test } from "vitest";
import { buildLocalMeshSurface } from "../../src/domain/localMeshSurface";
import type { SkinMask, SkinMeshData } from "../../src/domain/types";

function fullMask(width = 120, height = 120): SkinMask {
  return { width, height, probabilities: new Float32Array(width * height).fill(1) };
}

function mesh(): SkinMeshData {
  return {
    positions: new Float32Array([
      20, 20, 60, 20, 100, 20,
      20, 60, 60, 60, 100, 60,
      20, 100, 60, 100, 100, 100,
    ]),
    indices: new Uint32Array([
      0, 1, 4, 0, 4, 3,
      1, 2, 5, 1, 5, 4,
      3, 4, 7, 3, 7, 6,
      4, 5, 8, 4, 8, 7,
    ]),
  };
}

describe("buildLocalMeshSurface", () => {
  test("uses vertices near tattoo bounds for patch bounds and normals", () => {
    const result = buildLocalMeshSurface({
      mask: fullMask(),
      mesh: mesh(),
      stageSize: { width: 120, height: 120 },
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      tattooBounds: { x: 70, y: 70, width: 28, height: 24 },
    });

    expect(result.debug.source).toBe("local-mesh");
    expect(result.debug.patchBounds?.x).toBeGreaterThanOrEqual(55);
    expect(result.debug.patchBounds?.width).toBeLessThan(70);
    expect(result.surfaceField.normalStats?.activePixelRatio).toBeGreaterThan(0);
    expect(result.surfaceField.normalStats?.maxNormalXY).toBeGreaterThan(0);
  });

  test("keeps local normal xy in a medium visible but safe range", () => {
    const result = buildLocalMeshSurface({
      mask: fullMask(),
      mesh: mesh(),
      stageSize: { width: 120, height: 120 },
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      tattooBounds: { x: 35, y: 20, width: 54, height: 80 },
    });

    expect(result.surfaceField.normalStats?.maxNormalXY).toBeLessThanOrEqual(0.5);
    expect(result.surfaceField.normalStats?.meanNormalXY).toBeGreaterThanOrEqual(0.16);
  });

  test("reports insufficient mesh when tattoo has no nearby skin vertices", () => {
    const result = buildLocalMeshSurface({
      mask: fullMask(),
      mesh: mesh(),
      stageSize: { width: 120, height: 120 },
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      tattooBounds: { x: 0, y: 0, width: 8, height: 8 },
    });

    expect(result.debug.source).toBe("insufficient-mesh");
    expect(result.surfaceField.normalStats?.maxNormalXY).toBe(0);
  });
});
