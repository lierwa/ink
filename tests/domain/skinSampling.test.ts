import { describe, expect, test } from "vitest";
import { sampleSkinInterior } from "../../src/domain/skinSampling";
import type { BinaryMask, SkinContourLoop } from "../../src/domain/types";

function filledMask(width: number, height: number): BinaryMask {
  return {
    width,
    height,
    data: new Uint8Array(width * height).fill(1),
  };
}

describe("sampleSkinInterior", () => {
  test("generates points that stay inside the binary mask", () => {
    const mask = filledMask(64, 48);
    const loops: SkinContourLoop[] = [
      {
        isHole: false,
        area: 64 * 48,
        perimeter: 2 * (64 + 48),
        points: [
          { x: 0, y: 0 },
          { x: 63, y: 0 },
          { x: 63, y: 47 },
          { x: 0, y: 47 },
        ],
      },
    ];

    const points = sampleSkinInterior(mask, loops, {
      innerRadius: 8,
      boundaryBandWidth: 10,
      boundaryRadius: 4,
    });

    expect(points.length).toBeGreaterThan(10);
    expect(points.every((point) => point.x >= 0 && point.y >= 0 && point.x < 64 && point.y < 48)).toBe(true);
  });
});
