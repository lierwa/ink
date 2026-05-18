import { describe, expect, test } from "vitest";
import { createDepthFieldEstimator } from "../../src/domain/depthEstimator";
import type { SkinMask } from "../../src/domain/types";

describe("createDepthFieldEstimator", () => {
  test("uses onnx output when runtime is available", async () => {
    installCanvasFactoryStub(new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 0, 0, 0, 255,
    ]));
    const estimator = createDepthFieldEstimator({
      runtimeLoader: async () => createFakeOrt({
        dims: [1, 1, 2, 2],
        data: new Float32Array([
          0.1, 0.2,
          0.7, 0.9,
        ]),
      }),
      modelProbe: async () => undefined,
    });
    const sourceCanvas = createMockCanvas(2, 2, new Uint8ClampedArray([
      0, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 0, 0, 0, 255,
    ]));
    const mask: SkinMask = {
      width: 2,
      height: 2,
      probabilities: new Float32Array([1, 1, 1, 1]),
    };

    const result = await estimator.estimate({
      sourceCanvas,
      stageSize: { width: 2, height: 2 },
      placementRect: { x: 0, y: 0, width: 2, height: 2 },
      mask,
    });

    expect(result.source).toBe("onnx");
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.depthField.depth[0]).toBeLessThan(result.depthField.depth[3]);
  });

  test("falls back to luma depth when onnx runtime fails", async () => {
    installCanvasFactoryStub(new Uint8ClampedArray([
      20, 20, 20, 255,
      200, 200, 200, 255,
    ]));
    const estimator = createDepthFieldEstimator({
      runtimeLoader: async () => {
        throw new Error("model load failed");
      },
      modelProbe: async () => undefined,
    });
    const sourceCanvas = createMockCanvas(2, 1, new Uint8ClampedArray([
      20, 20, 20, 255,
      200, 200, 200, 255,
    ]));
    const mask: SkinMask = {
      width: 2,
      height: 1,
      probabilities: new Float32Array([1, 1]),
    };

    const result = await estimator.estimate({
      sourceCanvas,
      stageSize: { width: 2, height: 1 },
      placementRect: { x: 0, y: 0, width: 2, height: 1 },
      mask,
    });

    expect(result.source).toBe("luma");
    expect(result.qualityScore).toBe(0);
    expect(result.warning).toContain("depth onnx fallback:");
    expect(result.depthField.depth[0]).toBeLessThan(result.depthField.depth[1]);
  });
});

function createFakeOrt(output: { dims: number[]; data: Float32Array }) {
  return {
    InferenceSession: {
      create: async (_url: string) => ({
        inputNames: ["input"],
        outputNames: ["output"],
        run: async (_feeds: Record<string, unknown>) => ({
          output: {
            dims: output.dims,
            data: output.data,
          },
        }),
      }),
    },
    Tensor: class {
      constructor(_type: string, _data: Float32Array, _dims: readonly number[]) {}
    },
  };
}

function createMockCanvas(width: number, height: number, rgba: Uint8ClampedArray): HTMLCanvasElement {
  const context = {
    getImageData: () => ({ data: rgba }),
    drawImage: () => undefined,
  };
  const canvas = {
    width,
    height,
    getContext: (_id: string) => context,
  } as unknown as HTMLCanvasElement;
  return canvas;
}

function installCanvasFactoryStub(rgba: Uint8ClampedArray): void {
  const documentStub = {
    createElement: (_tag: string) =>
      ({
        width: 256,
        height: 256,
        getContext: (_id: string) => ({
          drawImage: () => undefined,
          getImageData: () => ({ data: rgba }),
        }),
      }) as unknown as HTMLCanvasElement,
  };
  (globalThis as { document?: unknown }).document = documentStub;
}
