import { describe, expect, test } from "vitest";
import {
  estimateDepthFieldFromCanvas,
  estimateDepthFieldQuality,
  estimateMaskPriorDepthField,
  fuseDepthWithMaskPrior,
} from "../../src/domain/depthField";
import type { SkinMask } from "../../src/domain/types";

describe("estimateDepthFieldFromCanvas", () => {
  test("maps source luminance to stage-aligned depth inside mask", () => {
    const sourceCanvas = createMockCanvas(4, 2, new Uint8ClampedArray([
      20, 20, 20, 255, 80, 80, 80, 255, 160, 160, 160, 255, 220, 220, 220, 255,
      20, 20, 20, 255, 80, 80, 80, 255, 160, 160, 160, 255, 220, 220, 220, 255,
    ]));
    const mask: SkinMask = {
      width: 4,
      height: 2,
      probabilities: new Float32Array(8).fill(1),
    };

    const depth = estimateDepthFieldFromCanvas({
      sourceCanvas,
      stageSize: { width: 8, height: 4 },
      placementRect: { x: 0, y: 0, width: 8, height: 4 },
      mask,
      blurPasses: 0,
    });

    expect(depth.width).toBe(8);
    expect(depth.height).toBe(4);
    expect(depth.depth[2 * 8 + 1]).toBeLessThan(depth.depth[2 * 8 + 6]);
  });

  test("keeps outside-mask depth as zero", () => {
    const sourceCanvas = createMockCanvas(2, 2, new Uint8ClampedArray([
      200, 200, 200, 255, 50, 50, 50, 255,
      200, 200, 200, 255, 50, 50, 50, 255,
    ]));
    const mask: SkinMask = {
      width: 2,
      height: 2,
      probabilities: new Float32Array([1, 0, 1, 0]),
    };

    const depth = estimateDepthFieldFromCanvas({
      sourceCanvas,
      stageSize: { width: 2, height: 2 },
      placementRect: { x: 0, y: 0, width: 2, height: 2 },
      mask,
      blurPasses: 0,
    });

    expect(depth.depth[1]).toBe(0);
    expect(depth.depth[3]).toBe(0);
  });

  test("builds mask prior depth with center higher than boundary", () => {
    const mask: SkinMask = {
      width: 8,
      height: 8,
      probabilities: new Float32Array(64).fill(1),
    };
    const prior = estimateMaskPriorDepthField({
      stageSize: { width: 8, height: 8 },
      placementRect: { x: 0, y: 0, width: 8, height: 8 },
      mask,
      blurPasses: 0,
    });

    const center = prior.depth[4 * 8 + 4];
    const edge = prior.depth[4 * 8];
    expect(center).toBeGreaterThan(edge);
  });

  test("reports lower quality for flat depth than for gradient depth", () => {
    const mask: SkinMask = {
      width: 4,
      height: 4,
      probabilities: new Float32Array(16).fill(1),
    };
    const flatDepth = {
      width: 4,
      height: 4,
      depth: new Float32Array(16).fill(0.5),
    };
    const gradientDepth = {
      width: 4,
      height: 4,
      depth: new Float32Array([
        0, 0.3, 0.6, 1,
        0, 0.3, 0.6, 1,
        0, 0.3, 0.6, 1,
        0, 0.3, 0.6, 1,
      ]),
    };

    const flatScore = estimateDepthFieldQuality({
      depthField: flatDepth,
      placementRect: { x: 0, y: 0, width: 4, height: 4 },
      mask,
    });
    const gradientScore = estimateDepthFieldQuality({
      depthField: gradientDepth,
      placementRect: { x: 0, y: 0, width: 4, height: 4 },
      mask,
    });

    expect(gradientScore).toBeGreaterThan(flatScore);
  });

  test("blends onnx depth with prior using quality-controlled weight", () => {
    const onnxDepth = {
      width: 2,
      height: 2,
      depth: new Float32Array([0, 0, 1, 1]),
    };
    const priorDepth = {
      width: 2,
      height: 2,
      depth: new Float32Array([0.2, 0.2, 0.8, 0.8]),
    };
    const fusedLow = fuseDepthWithMaskPrior({
      onnxDepthField: onnxDepth,
      priorDepthField: priorDepth,
      qualityScore: 0,
    });
    const fusedHigh = fuseDepthWithMaskPrior({
      onnxDepthField: onnxDepth,
      priorDepthField: priorDepth,
      qualityScore: 1,
    });

    expect(fusedLow.onnxWeight).toBeLessThan(fusedHigh.onnxWeight);
    expect(fusedLow.depthField.depth[0]).toBeGreaterThan(fusedHigh.depthField.depth[0]);
  });
});

function createMockCanvas(width: number, height: number, rgba: Uint8ClampedArray): HTMLCanvasElement {
  const canvas = {
    width,
    height,
    getContext: (_id: string) => ({
      getImageData: () => ({ data: rgba }),
    }),
  } as unknown as HTMLCanvasElement;
  return canvas;
}
