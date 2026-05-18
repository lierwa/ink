import { describe, expect, test } from "vitest";
import { buildSurfaceFieldFromSkinMask } from "../../src/domain/surfaceField";
import type { SkinMask } from "../../src/domain/types";

describe("buildSurfaceFieldFromSkinMask", () => {
  test("builds a stage-sized normal map and keeps outside region transparent", () => {
    const mask = createCircleMask(32, 32, 16, 16, 12);
    const surface = buildSurfaceFieldFromSkinMask({
      mask,
      stageSize: { width: 64, height: 40 },
      placementRect: { x: 12, y: 4, width: 40, height: 32 },
    });

    expect(surface.width).toBe(64);
    expect(surface.height).toBe(40);
    expect(surface.normalRgba.length).toBe(64 * 40 * 4);
    expect(surface.normalRgba[3]).toBe(0);
  });

  test("keeps interior normal map data non-flat after distance-field shaping", () => {
    const mask = createCircleMask(40, 40, 20, 20, 14);
    const surface = buildSurfaceFieldFromSkinMask({
      mask,
      stageSize: { width: 64, height: 64 },
      placementRect: { x: 8, y: 8, width: 48, height: 48 },
    });

    const centerIndex = ((32 * 64) + 32) * 4;
    expect(surface.normalRgba[centerIndex + 2]).toBeGreaterThanOrEqual(200);
    expect(surface.normalRgba[centerIndex + 3]).toBe(255);
  });

  test("returns flat transparent output when mask is empty", () => {
    const emptyMask: SkinMask = {
      width: 10,
      height: 10,
      probabilities: new Float32Array(100).fill(0),
    };
    const surface = buildSurfaceFieldFromSkinMask({
      mask: emptyMask,
      stageSize: { width: 16, height: 16 },
      placementRect: { x: 2, y: 2, width: 12, height: 12 },
    });

    const sampleIndex = ((8 * 16) + 8) * 4;
    expect(surface.normalRgba[sampleIndex]).toBe(128);
    expect(surface.normalRgba[sampleIndex + 1]).toBe(128);
    expect(surface.normalRgba[sampleIndex + 2]).toBe(255);
    expect(surface.normalRgba[sampleIndex + 3]).toBe(0);
  });

  test("blends external depth field to increase directional normal variation", () => {
    const mask = createCircleMask(24, 24, 12, 12, 10);
    const width = 48;
    const height = 48;
    const depth = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        depth[y * width + x] = x / (width - 1);
      }
    }

    const surface = buildSurfaceFieldFromSkinMask({
      mask,
      stageSize: { width, height },
      placementRect: { x: 0, y: 0, width, height },
      depthField: { width, height, depth },
      options: { depthBlendWeight: 0.9 },
    });

    const center = ((24 * width) + 24) * 4;
    expect(surface.normalRgba[center]).not.toBe(128);
    expect(surface.normalRgba[center + 3]).toBe(255);
  });
});

function createCircleMask(
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
): SkinMask {
  const probabilities = new Float32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const inside = Math.sqrt(dx * dx + dy * dy) <= radius;
      probabilities[y * width + x] = inside ? 1 : 0;
    }
  }

  return { width, height, probabilities };
}
