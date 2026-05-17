import { describe, expect, test } from "vitest";
import {
  cleanupLineArtBackground,
  cleanupLineArtBackgroundFromPixels,
} from "../../src/image/lineArtCleanup";

describe("cleanupLineArtBackgroundFromPixels", () => {
  test("removes paper-like white and light gray pixels", () => {
    const pixels = new Uint8ClampedArray([
      250, 250, 248, 255,
      228, 229, 226, 255,
      24, 24, 24, 255,
    ]);

    cleanupLineArtBackgroundFromPixels(pixels);

    expect(pixels[3]).toBe(0);
    expect(pixels[7]).toBeLessThan(96);
    expect(pixels[11]).toBe(255);
  });

  test("preserves dark and mid-gray linework", () => {
    const pixels = new Uint8ClampedArray([
      30, 30, 30, 255,
      120, 120, 118, 255,
      178, 176, 172, 255,
    ]);

    cleanupLineArtBackgroundFromPixels(pixels);

    expect(pixels[3]).toBeGreaterThanOrEqual(250);
    expect(pixels[7]).toBeGreaterThanOrEqual(120);
    expect(pixels[11]).toBeGreaterThanOrEqual(50);
  });

  test("does not make semi-transparent uploaded pixels opaque", () => {
    const pixels = new Uint8ClampedArray([
      250, 250, 250, 70,
      20, 20, 20, 90,
    ]);

    cleanupLineArtBackgroundFromPixels(pixels);

    expect(pixels[3]).toBeLessThanOrEqual(70);
    expect(pixels[7]).toBe(90);
  });

  test("uses border paper color to clean non-white thumbnail backgrounds", () => {
    const imageData = {
      width: 3,
      height: 3,
      data: new Uint8ClampedArray([
        232, 232, 232, 255,
        232, 232, 232, 255,
        232, 232, 232, 255,
        232, 232, 232, 255,
        42, 42, 42, 255,
        232, 232, 232, 255,
        232, 232, 232, 255,
        232, 232, 232, 255,
        232, 232, 232, 255,
      ]),
    } as ImageData;

    cleanupLineArtBackground(imageData);

    expect(imageData.data[3]).toBe(0);
    expect(imageData.data[19]).toBeGreaterThan(220);
    expect(imageData.data[16]).toBe(0);
  });

  test("converts paper-colored edge RGB into alpha instead of leaving white fringes", () => {
    const pixels = new Uint8ClampedArray([
      210, 210, 210, 255,
      42, 42, 42, 255,
    ]);

    cleanupLineArtBackgroundFromPixels(pixels, undefined, 232);

    expect(pixels[3]).toBeGreaterThan(0);
    expect(pixels[3]).toBeLessThan(255);
    expect(pixels[0]).toBeLessThan(210);
    expect(Array.from(pixels.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(pixels.slice(4, 7))).toEqual([0, 0, 0]);
    expect(pixels[7]).toBeGreaterThan(220);
  });
});
