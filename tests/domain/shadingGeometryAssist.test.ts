// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { resolveShadingGeometryAssist } from "../../src/domain/shadingGeometryAssist";

describe("resolveShadingGeometryAssist", () => {
  test("returns disabled debug when the switch is off", () => {
    const result = resolveShadingGeometryAssist({
      enabled: false,
      sourceCanvas: createGradientCanvas(),
      localBounds: { x: 0, y: 0, width: 20, height: 10 },
      crossAxis: { x: 1, y: 0 },
    });

    expect(result.debug).toEqual({
      enabled: false,
      used: false,
      confidence: 0,
      agreement: 0,
      appliedStrength: 0,
      reason: "disabled",
    });
    expect(result.curvatureMultiplier).toBe(1);
  });

  test("applies bounded curvature assist when shading aligns with geometry", () => {
    const result = resolveShadingGeometryAssist({
      enabled: true,
      sourceCanvas: createGradientCanvas(),
      localBounds: { x: 0, y: 0, width: 20, height: 10 },
      crossAxis: { x: 1, y: 0 },
      maxAdjustmentRatio: 0.25,
    });

    expect(result.debug.used).toBe(true);
    expect(result.debug.reason).toBe("used");
    expect(result.curvatureMultiplier).toBeGreaterThan(1);
    expect(result.curvatureMultiplier).toBeLessThanOrEqual(1.25);
  });

  test("returns low confidence when canvas readback throws", () => {
    const result = resolveShadingGeometryAssist({
      enabled: true,
      sourceCanvas: createThrowingCanvas(),
      localBounds: { x: 0, y: 0, width: 20, height: 10 },
      crossAxis: { x: 1, y: 0 },
    });

    expect(result.debug.reason).toBe("low-confidence");
    expect(result.debug.used).toBe(false);
    expect(result.curvatureMultiplier).toBe(1);
  });

  test("rejects perpendicular shading as a geometry conflict", () => {
    const result = resolveShadingGeometryAssist({
      enabled: true,
      sourceCanvas: createGradientCanvas(),
      localBounds: { x: 0, y: 0, width: 20, height: 10 },
      crossAxis: { x: 0, y: 1 },
    });

    expect(result.debug.reason).toBe("geometry-conflict");
    expect(result.debug.used).toBe(false);
    expect(result.curvatureMultiplier).toBe(1);
  });

  test("caps oversized max adjustment ratio", () => {
    const result = resolveShadingGeometryAssist({
      enabled: true,
      sourceCanvas: createGradientCanvas(),
      localBounds: { x: 0, y: 0, width: 20, height: 10 },
      crossAxis: { x: 1, y: 0 },
      maxAdjustmentRatio: 10,
    });

    expect(result.debug.used).toBe(true);
    expect(result.curvatureMultiplier).toBeLessThanOrEqual(1.3);
  });
});

function createGradientCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 20;
  canvas.height = 10;
  vi.spyOn(canvas, "getContext").mockReturnValue({
    getImageData: vi.fn(() => {
      const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const index = (y * canvas.width + x) * 4;
          const value = Math.round((x / (canvas.width - 1)) * 255);
          data[index] = value;
          data[index + 1] = value;
          data[index + 2] = value;
          data[index + 3] = 255;
        }
      }
      return { width: canvas.width, height: canvas.height, data } as ImageData;
    }),
  } as unknown as CanvasRenderingContext2D);
  return canvas;
}

function createThrowingCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 20;
  canvas.height = 10;
  vi.spyOn(canvas, "getContext").mockReturnValue({
    getImageData: vi.fn(() => {
      throw new Error("readback blocked");
    }),
  } as unknown as CanvasRenderingContext2D);
  return canvas;
}
