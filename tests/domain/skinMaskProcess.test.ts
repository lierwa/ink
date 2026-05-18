import { describe, expect, test } from "vitest";
import { postProcessSkinMask } from "../../src/domain/skinMaskProcess";
import type { SkinMask } from "../../src/domain/types";

function createSkinMask(width: number, height: number, active: Array<[number, number]>, base = 0): SkinMask {
  const probabilities = new Float32Array(width * height).fill(base);
  for (const [x, y] of active) {
    probabilities[y * width + x] = 0.9;
  }
  return { width, height, probabilities };
}

describe("postProcessSkinMask", () => {
  test("removes small components while preserving the major area", () => {
    const major: Array<[number, number]> = [];
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 2; x <= 4; x += 1) {
        major.push([x, y]);
      }
    }
    const mask = createSkinMask(8, 8, [...major, [7, 1]]);

    const result = postProcessSkinMask(mask, {
      minComponentArea: 3,
      keepLargestComponent: false,
      morphology: { enabled: false },
    });

    expect(result.data[1 * 8 + 7]).toBe(0);
    const activeCount = Array.from(result.data).filter((value) => value === 1).length;
    expect(activeCount).toBe(major.length);
  });

  test("fills a single-pixel hole with close morphology", () => {
    const active: Array<[number, number]> = [];
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        if (x === 2 && y === 2) {
          continue;
        }
        active.push([x, y]);
      }
    }
    const mask = createSkinMask(5, 5, active);

    const result = postProcessSkinMask(mask, {
      minComponentArea: 1,
      keepLargestComponent: false,
      morphology: {
        enabled: true,
        kernelSize: 3,
        openIterations: 0,
        closeIterations: 1,
      },
    });

    expect(result.data[2 * 5 + 2]).toBe(1);
  });

  test("keeps only the largest component when keepLargestComponent is true", () => {
    const clusterA: Array<[number, number]> = [
      [1, 1], [2, 1], [3, 1],
      [1, 2], [2, 2], [3, 2],
    ];
    const clusterB: Array<[number, number]> = [
      [6, 4], [7, 4],
      [6, 5], [7, 5],
    ];
    const mask = createSkinMask(10, 8, [...clusterA, ...clusterB]);

    const result = postProcessSkinMask(mask, {
      minComponentArea: 1,
      keepLargestComponent: true,
      morphology: { enabled: false },
    });

    const count = Array.from(result.data).filter((value) => value === 1).length;
    expect(count).toBe(clusterA.length);
    expect(result.data[4 * 10 + 6]).toBe(0);
  });
});
