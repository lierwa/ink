// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import {
  createSkinSegmentationService,
  defaultSkinSegmentationConfig,
} from "../../src/domain/skinSegmentation";

describe("createSkinSegmentationService", () => {
  test("uses confidence masks and selects skin-like class label", async () => {
    const backgroundMask = createMockMask(2, 2, [0.99, 0.99, 0.99, 0.99]);
    const hairMask = createMockMask(2, 2, [0.8, 0.1, 0.1, 0.8]);
    const bodySkinMask = createMockMask(2, 2, [0.2, 0.3, 0.2, 0.3]);
    const faceSkinMask = createMockMask(2, 2, [0.95, 0.92, 0.91, 0.93]);
    const resultClose = vi.fn();
    const segmenter = {
      segment: vi.fn(() => ({
        confidenceMasks: [backgroundMask, hairMask, bodySkinMask, faceSkinMask],
        close: resultClose,
      })),
      getLabels: vi.fn(() => ["background", "hair", "body-skin", "face-skin"]),
    };
    const createSegmenter = vi.fn(async () => segmenter);
    const service = createSkinSegmentationService({
      createVisionFileset: vi.fn(async () => ({})),
      createSegmenter,
    });

    const mask = await service.segmentSkinFromImageSource(document.createElement("canvas"));

    expect(mask.width).toBe(2);
    expect(mask.height).toBe(2);
    expect(mask.probabilities[0]).toBeCloseTo(0.95, 6);
    expect(mask.probabilities[1]).toBeCloseTo(0.92, 6);
    expect(mask.probabilities[2]).toBeCloseTo(0.91, 6);
    expect(mask.probabilities[3]).toBeCloseTo(0.93, 6);
    expect(resultClose).toHaveBeenCalledTimes(1);
    expect(backgroundMask.close).toHaveBeenCalledTimes(1);
    expect(hairMask.close).toHaveBeenCalledTimes(1);
    expect(bodySkinMask.close).toHaveBeenCalledTimes(1);
    expect(faceSkinMask.close).toHaveBeenCalledTimes(1);
    expect(createSegmenter).toHaveBeenCalledTimes(1);
  });

  test("lazily creates singleton segmenter per service instance", async () => {
    const createSegmenter = vi.fn(async () => ({
      segment: vi.fn(() => ({
        confidenceMasks: [createMockMask(1, 1, [0.3])],
        close: vi.fn(),
      })),
      getLabels: vi.fn(() => ["person"]),
    }));
    const service = createSkinSegmentationService({
      createVisionFileset: vi.fn(async () => ({})),
      createSegmenter,
    });
    const source = document.createElement("canvas");

    await service.segmentSkinFromImageSource(source);
    await service.segmentSkinFromImageSource(source);

    expect(createSegmenter).toHaveBeenCalledTimes(1);
  });

  test("uses project default config when omitted", () => {
    expect(defaultSkinSegmentationConfig.modelPath).toContain("selfie_multiclass_256x256");
    expect(defaultSkinSegmentationConfig.wasmPath).toContain("@mediapipe/tasks-vision");
  });

  test("falls back to categoryMask when confidence masks are missing", async () => {
    const categoryMask = {
      width: 2,
      height: 2,
      close: vi.fn(),
      getAsFloat32Array: vi.fn(() => new Float32Array([0, 1, 2, 3])),
      getAsUint8Array: vi.fn(() => new Uint8Array([0, 3, 1, 3])),
    };
    const segmenter = {
      segment: vi.fn(() => ({
        categoryMask,
        close: vi.fn(),
      })),
      getLabels: vi.fn(() => ["background", "hair", "body-skin", "face-skin"]),
    };
    const service = createSkinSegmentationService({
      createVisionFileset: vi.fn(async () => ({})),
      createSegmenter: vi.fn(async () => segmenter),
    });

    const mask = await service.segmentSkinFromImageSource(document.createElement("canvas"));
    expect(mask.width).toBe(2);
    expect(mask.height).toBe(2);
    expect(Array.from(mask.probabilities)).toEqual([0, 1, 0, 1]);
  });

  test("retries segmenter initialization after previous init failure", async () => {
    const initError = new Error("init failed");
    const segmenter = {
      segment: vi.fn(() => ({
        confidenceMasks: [createMockMask(1, 1, [0.8])],
        close: vi.fn(),
      })),
      getLabels: vi.fn(() => ["person"]),
    };
    const createSegmenter = vi.fn()
      .mockRejectedValueOnce(initError)
      .mockResolvedValueOnce(segmenter);
    const service = createSkinSegmentationService({
      createVisionFileset: vi.fn(async () => ({})),
      createSegmenter,
    });
    const canvas = document.createElement("canvas");

    await expect(service.segmentSkinFromImageSource(canvas)).rejects.toThrow("init failed");
    await expect(service.segmentSkinFromImageSource(canvas)).resolves.toMatchObject({
      width: 1,
      height: 1,
    });
    expect(createSegmenter).toHaveBeenCalledTimes(2);
  });

  test("does not fail successful segmentation when close throws", async () => {
    const segmenter = {
      segment: vi.fn(() => ({
        confidenceMasks: [{
          ...createMockMask(1, 1, [0.8]),
          close: vi.fn(() => {
            throw new Error("mask close failed");
          }),
        }],
        close: vi.fn(() => {
          throw new Error("result close failed");
        }),
      })),
      getLabels: vi.fn(() => ["person"]),
    };
    const service = createSkinSegmentationService({
      createVisionFileset: vi.fn(async () => ({})),
      createSegmenter: vi.fn(async () => segmenter),
    });

    await expect(service.segmentSkinFromImageSource(document.createElement("canvas"))).resolves.toMatchObject({
      width: 1,
      height: 1,
    });
  });
});

function createMockMask(width: number, height: number, values: number[]) {
  const floatData = new Float32Array(values);
  const close = vi.fn();

  return {
    width,
    height,
    close,
    getAsFloat32Array: vi.fn(() => floatData),
    getAsUint8Array: vi.fn(() => new Uint8Array(values.map((value) => (value > 0.5 ? 1 : 0)))),
  };
}
