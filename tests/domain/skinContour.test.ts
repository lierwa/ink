import { describe, expect, test } from "vitest";
import { extractSkinContours } from "../../src/domain/skinContour";
import type { BinaryMask } from "../../src/domain/types";

function binaryMaskFromRows(rows: string[]): BinaryMask {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = rows[y][x] === "1" ? 1 : 0;
    }
  }

  return { width, height, data };
}

describe("extractSkinContours", () => {
  test("extracts a primary outer contour from a filled region", () => {
    const mask = binaryMaskFromRows([
      "0000000000",
      "0011111100",
      "0011111100",
      "0011111100",
      "0011111100",
      "0000000000",
    ]);

    const contours = extractSkinContours(mask, {
      simplifyTolerance: 0,
      minLoopArea: 1,
      resample: { minStep: 2, maxStep: 2 },
    });

    expect(contours.length).toBe(1);
    expect(contours[0].isHole).toBe(false);
    expect(Math.abs(contours[0].area)).toBeCloseTo(24, 5);
    expect(contours[0].points.length).toBeGreaterThan(8);
  });

  test("identifies hole contours in a donut-shaped region", () => {
    const mask = binaryMaskFromRows([
      "000000000",
      "011111110",
      "011111110",
      "011000110",
      "011000110",
      "011111110",
      "011111110",
      "000000000",
    ]);

    const contours = extractSkinContours(mask, {
      simplifyTolerance: 0,
      minLoopArea: 1,
      resample: { minStep: 1, maxStep: 1 },
    });

    expect(contours.length).toBe(2);
    expect(contours.some((contour) => contour.isHole)).toBe(true);
    expect(contours.some((contour) => !contour.isHole)).toBe(true);
  });

  test("adds more points around high-curvature edges with adaptive resampling", () => {
    const mask = binaryMaskFromRows([
      "00000000000",
      "00111111100",
      "00111111100",
      "00111000000",
      "00111000000",
      "00111000000",
      "00000000000",
    ]);

    const adaptive = extractSkinContours(mask, {
      simplifyTolerance: 0,
      minLoopArea: 1,
      resample: { minStep: 1, maxStep: 5 },
    });
    const uniform = extractSkinContours(mask, {
      simplifyTolerance: 0,
      minLoopArea: 1,
      resample: { minStep: 5, maxStep: 5 },
    });

    expect(adaptive[0].points.length).toBeGreaterThan(uniform[0].points.length);
  });
});
