// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { createAppMarkup } from "../src/appMarkup";
import {
  computeContainPlacementRect,
  createBodyMeshPreviewBuilder,
  createSkinMaskWithFallback,
  mapSkinMeshToPlacementRect,
  normalizeSkinMeshImageSize,
} from "../src/app";
import type { BodyMeshPipelineParams, SkinMeshData } from "../src/domain/types";
import { defaultBodyMeshPipelineParams } from "../src/domain/skinMeshPipeline";

describe("createAppMarkup", () => {
  test("renders body edit remove controls and shading assist toggle", () => {
    const host = document.createElement("div");

    host.innerHTML = createAppMarkup({
      x: 450,
      y: 310,
      scale: 0.42,
      rotation: 0,
      opacity: 1,
    });

    expect(host.querySelector("#editBody")).toBeInstanceOf(HTMLButtonElement);
    expect(host.querySelector("#removeBody")).toBeInstanceOf(HTMLButtonElement);
    expect(host.querySelector("#shadingGeometryAssist")).toBeInstanceOf(HTMLInputElement);
    expect(host.querySelector("#bodyUploadStatus")?.textContent).toBe("No body uploaded");
    expect(host.querySelector("#tattooUploadStatus")?.textContent).toBe("No tattoo uploaded");
    expect(host.textContent).toContain("光影曲面辅助");
    expect(host.querySelector("#surfaceFitStrength")).toBeNull();
    expect(host.querySelector("#surfaceFitStrengthValue")).toBeNull();
    expect(host.textContent).not.toContain("Fit strength");
  });
});

describe("normalizeSkinMeshImageSize", () => {
  test("scales long edge to 1024 for stable meshing budget", () => {
    const size = normalizeSkinMeshImageSize({ width: 3000, height: 1000 });
    expect(size).toEqual({ width: 1024, height: 341 });
  });
});

describe("computeContainPlacementRect", () => {
  test("fits image inside stage with centered letterboxing", () => {
    const rect = computeContainPlacementRect(
      { width: 200, height: 100 },
      { width: 900, height: 620 },
    );

    expect(rect.width).toBe(900);
    expect(rect.height).toBe(450);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(85);
  });
});

describe("mapSkinMeshToPlacementRect", () => {
  test("maps image-space skin mesh into body placement rectangle coordinates", () => {
    const mesh: SkinMeshData = {
      positions: new Float32Array([
        0, 0,
        200, 0,
        200, 100,
        0, 100,
      ]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      boundaryFlags: new Uint8Array([1, 1, 1, 1]),
    };

    const mapped = mapSkinMeshToPlacementRect(
      mesh,
      { width: 200, height: 100 },
      { x: 100, y: 200, width: 400, height: 300 },
    );

    expect(mapped.positions).toEqual(new Float32Array([
      100, 200,
      500, 200,
      500, 500,
      100, 500,
    ]));
    expect(mapped.indices).toEqual(mesh.indices);
    expect(mapped.boundaryFlags).toEqual(mesh.boundaryFlags);
  });
});

describe("createSkinMaskWithFallback", () => {
  test("falls back to alpha adapter when MediaPipe segmentation throws", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 1;
    const fallbackMask = {
      width: 2,
      height: 1,
      probabilities: new Float32Array([0.1, 0.7]),
    };
    const segmentSkinFromImageSource = async (): Promise<never> => {
      throw new Error("segmenter failed");
    };
    const createSkinMaskFromCanvasAlpha = () => fallbackMask;

    const mask = await createSkinMaskWithFallback(canvas, {
      segmentSkinFromImageSource,
      createSkinMaskFromCanvasAlpha,
    });

    expect(mask).toBe(fallbackMask);
  });

  test("falls back to full-image mask when both segmentation and alpha extraction fail", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 3;
    canvas.height = 2;
    const segmentSkinFromImageSource = vi.fn(async (): Promise<never> => {
      throw new Error("segmenter failed");
    });
    const createSkinMaskFromCanvasAlpha = vi.fn((): never => {
      throw new Error("alpha failed");
    });

    const mask = await createSkinMaskWithFallback(canvas, {
      segmentSkinFromImageSource,
      createSkinMaskFromCanvasAlpha,
    });

    expect(mask.width).toBe(3);
    expect(mask.height).toBe(2);
    expect(Array.from(mask.probabilities)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

describe("createBodyMeshPreviewBuilder", () => {
  test("reuses one segmentation session for repeated param rebuilds", async () => {
    const source = document.createElement("canvas");
    source.width = 16;
    source.height = 12;
    const createSession = vi.fn(async (sourceCanvas: HTMLCanvasElement) => ({
      sourceCanvas,
      workingCanvas: sourceCanvas,
      mask: {
        width: sourceCanvas.width,
        height: sourceCanvas.height,
        probabilities: new Float32Array(sourceCanvas.width * sourceCanvas.height).fill(1),
      },
    }));

    const buildPreview = createBodyMeshPreviewBuilder(createSession);
    const firstParams: BodyMeshPipelineParams = { ...defaultBodyMeshPipelineParams, threshold: 0.4 };
    const secondParams: BodyMeshPipelineParams = { ...defaultBodyMeshPipelineParams, threshold: 0.7 };

    await buildPreview(source, firstParams);
    await buildPreview(source, secondParams);

    expect(createSession).toHaveBeenCalledTimes(1);
  });

  test("returns warning text when mesh triangulation falls back", async () => {
    const source = document.createElement("canvas");
    source.width = 12;
    source.height = 10;
    const createSession = vi.fn(async (sourceCanvas: HTMLCanvasElement) => ({
      sourceCanvas,
      workingCanvas: sourceCanvas,
      mask: {
        width: sourceCanvas.width,
        height: sourceCanvas.height,
        probabilities: new Float32Array(sourceCanvas.width * sourceCanvas.height).fill(0),
      },
    }));

    const buildPreview = createBodyMeshPreviewBuilder(createSession);
    const preview = await buildPreview(source, { ...defaultBodyMeshPipelineParams });

    expect(preview.warning).toContain("mesh rebuild failed:");
    expect(preview.mesh.indices.length).toBe(6);
  });
});
