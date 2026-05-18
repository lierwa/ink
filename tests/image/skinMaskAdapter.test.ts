import { describe, expect, test } from "vitest";
import { createSkinMaskFromImageData } from "../../src/image/skinMaskAdapter";

describe("createSkinMaskFromImageData", () => {
  test("converts alpha channel to normalized probabilities", () => {
    const imageData = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        10, 20, 30, 0,
        10, 20, 30, 64,
        10, 20, 30, 128,
        10, 20, 30, 255,
      ]),
    } as ImageData;

    const mask = createSkinMaskFromImageData(imageData);

    expect(mask.width).toBe(2);
    expect(mask.height).toBe(2);
    expect(mask.probabilities[0]).toBe(0);
    expect(mask.probabilities[1]).toBeCloseTo(64 / 255, 6);
    expect(mask.probabilities[2]).toBeCloseTo(128 / 255, 6);
    expect(mask.probabilities[3]).toBe(1);
  });

  test("keeps output buffer length aligned with image area", () => {
    const imageData = {
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([
        0, 0, 0, 12,
        0, 0, 0, 34,
        0, 0, 0, 56,
      ]),
    } as ImageData;

    const mask = createSkinMaskFromImageData(imageData);
    expect(mask.probabilities.length).toBe(3);
  });
});
