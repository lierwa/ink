import { describe, expect, test } from "vitest";
import { resolveLocalSurfaceDescriptor } from "../../src/domain/localSurfaceDescriptor";
import type { SkinMask, SkinMeshData } from "../../src/domain/types";

function fullMask(width = 120, height = 120): SkinMask {
  return { width, height, probabilities: new Float32Array(width * height).fill(1) };
}

function verticalMesh(): SkinMeshData {
  return {
    positions: new Float32Array([
      50, 10, 70, 10,
      48, 60, 72, 60,
      50, 110, 70, 110,
    ]),
    indices: new Uint32Array([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]),
  };
}

describe("resolveLocalSurfaceDescriptor", () => {
  test("classifies a narrow local patch as an elliptical cylinder", () => {
    const descriptor = resolveLocalSurfaceDescriptor({
      mask: fullMask(),
      mesh: verticalMesh(),
      placementRect: { x: 0, y: 0, width: 120, height: 120 },
      stageSize: { width: 120, height: 120 },
      tattooBounds: { x: 45, y: 32, width: 30, height: 48 },
    });

    expect(descriptor.source).toBe("geometry");
    expect(descriptor.proxy).toBe("ellipticalCylinder");
    expect(descriptor.axis.direction.y).toBe(1);
    expect(descriptor.curvature.acrossAxis).toBeGreaterThan(0);
  });
});
