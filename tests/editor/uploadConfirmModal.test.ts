// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  openUploadConfirmModal,
  sourceCropRectToCropperSelection,
  cropperSelectionToSourceCropRect,
  type ProcessedTattooOption,
} from "../../src/editor/uploadConfirmModal";

describe("openUploadConfirmModal", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4).fill(255),
        })),
      })),
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: originalGetContext,
    });
    vi.restoreAllMocks();
  });

  test("Cancel resolves null and removes the modal", async () => {
    const option = createOption("line-art", createCanvasStub(12, 10));
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [option],
      cropCanvas: vi.fn(),
    });

    getButton("Cancel").click();

    await expect(promise).resolves.toBeNull();
    expect(document.querySelector("[data-upload-confirm-modal]")).toBeNull();
  });

  test("Apply resolves the cropped canvas from the selected mode", async () => {
    const source = createCanvasStub(20, 18);
    const cropped = createCanvasStub(8, 7);
    const cropCanvas = vi.fn(() => cropped);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });

    getButton("Apply").click();

    await expect(promise).resolves.toEqual({
      canvas: cropped,
      mode: "line-art",
    });
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 0, y: 0, width: 20, height: 18 });
    expect(document.querySelector("[data-upload-confirm-modal]")).toBeNull();
  });

  test("renders mode buttons and marks the initial line-art mode as active", async () => {
    const source = createCanvasStub(20, 18);
    const cropCanvas = vi.fn((canvas: HTMLCanvasElement) => canvas);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [
        createOption("line-art", source),
        createOption("original", source),
      ],
      cropCanvas,
    });

    expect(getModeButton("Line-Art").classList.contains("is-active")).toBe(true);
    expect(getModeButton("Original").classList.contains("is-active")).toBe(false);
    getButton("Apply").click();

    await expect(promise).resolves.toEqual({
      canvas: source,
      mode: "line-art",
    });
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 0, y: 0, width: 20, height: 18 });
  });

  test("renders eight resize handles for the tattoo crop selection", async () => {
    const source = createCanvasStub(20, 18);
    const cropCanvas = vi.fn((canvas: HTMLCanvasElement) => canvas);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });

    expect(Array.from(document.querySelectorAll("[data-cropper-handle]")).map((handle) => handle.getAttribute("action"))).toEqual([
      "n-resize",
      "e-resize",
      "s-resize",
      "w-resize",
      "ne-resize",
      "nw-resize",
      "se-resize",
      "sw-resize",
    ]);
    getButton("Apply").click();

    await promise;
  });

  test("switching to original changes applied mode while keeping same crop rect", async () => {
    const lineArt = createCanvasStub(100, 80);
    const original = createCanvasStub(100, 80);
    const cropCanvas = vi.fn((canvas: HTMLCanvasElement) => canvas);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [
        createOption("line-art", lineArt),
        createOption("original", original),
      ],
      cropCanvas,
    });

    setCropperSelection({ x: 4, y: 6, width: 82, height: 68 });
    getModeButton("Original").click();
    getButton("Apply").click();

    await expect(promise).resolves.toEqual({
      canvas: original,
      mode: "original",
    });
    expect(cropCanvas).toHaveBeenCalledWith(original, { x: 4, y: 6, width: 82, height: 68 });
  });

  test("Apply rejects and removes the modal when crop export fails", async () => {
    const cropError = new Error("crop failed");
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", createCanvasStub(20, 18))],
      cropCanvas: vi.fn(() => {
        throw cropError;
      }),
    });

    getButton("Apply").click();

    await expect(promise).rejects.toThrow("crop failed");
    expect(document.querySelector("[data-upload-confirm-modal]")).toBeNull();
  });

  test("Apply reads the current cropper selection in source pixels", async () => {
    const source = createCanvasStub(100, 80);
    const cropCanvas = vi.fn(() => source);
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", source)],
      cropCanvas,
    });

    setCropperSelection({ x: 25, y: 10, width: 75, height: 70 });
    getButton("Apply").click();

    await promise;
    expect(cropCanvas).toHaveBeenCalledWith(source, { x: 25, y: 10, width: 75, height: 70 });
  });

  test("converts a scaled and centered Cropper selection back to source pixels", () => {
    const crop = cropperSelectionToSourceCropRect(
      { x: 70, y: 45, width: 160, height: 120 },
      [0.5, 0, 0, 0.5, 20, 15],
      createCanvasStub(500, 400),
    );

    expect(crop).toEqual({ x: 100, y: 60, width: 320, height: 240 });
  });

  test("maps a source crop rect to Cropper display coordinates with the same matrix contract", () => {
    const selection = sourceCropRectToCropperSelection(
      { x: 100, y: 60, width: 320, height: 240 },
      [0.5, 0, 0, 0.5, 20, 15],
      createCanvasStub(500, 400),
    );

    expect(selection).toEqual({ x: 70, y: 45, width: 160, height: 120 });
  });

  test("Escape cancels the modal", async () => {
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [createOption("line-art", createCanvasStub(12, 10))],
      cropCanvas: vi.fn(),
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    await expect(promise).resolves.toBeNull();
    expect(document.querySelector("[data-upload-confirm-modal]")).toBeNull();
  });

  test("falls back to original when selected line-art crop is nearly transparent", async () => {
    const lineArt = createCanvasStub(20, 18);
    const source = createCanvasStub(20, 18);
    const cropCanvas = vi
      .fn((canvas: HTMLCanvasElement): HTMLCanvasElement => {
        if (canvas === lineArt) {
          return createAlphaCoverageCanvas(20, 18, 0.002);
        }
        return source;
      });
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [
        createOption("line-art", lineArt),
        createOption("original", source),
      ],
      cropCanvas,
    });

    getButton("Apply").click();

    await expect(promise).resolves.toEqual({
      canvas: source,
      mode: "original",
      fallbackFrom: "line-art",
    });
    expect(cropCanvas).toHaveBeenCalledTimes(2);
    expect(cropCanvas).toHaveBeenNthCalledWith(1, lineArt, { x: 0, y: 0, width: 20, height: 18 });
    expect(cropCanvas).toHaveBeenNthCalledWith(2, source, { x: 0, y: 0, width: 20, height: 18 });
  });

  test("line-art transparent fallback reuses the selected source crop rect for original", async () => {
    const lineArt = createCanvasStub(100, 80);
    const source = createCanvasStub(100, 80);
    const croppedOriginal = createCanvasStub(40, 30);
    const cropCanvas = vi
      .fn((canvas: HTMLCanvasElement): HTMLCanvasElement => {
        if (canvas === lineArt) {
          return createAlphaCoverageCanvas(40, 30, 0);
        }
        return croppedOriginal;
      });
    const promise = openUploadConfirmModal({
      fileName: "tattoo.png",
      initialMode: "line-art",
      options: [
        createOption("line-art", lineArt),
        createOption("original", source),
      ],
      cropCanvas,
    });

    setCropperSelection({ x: 14, y: 12, width: 40, height: 30 });
    getButton("Apply").click();

    await expect(promise).resolves.toEqual({
      canvas: croppedOriginal,
      mode: "original",
      fallbackFrom: "line-art",
    });
    expect(cropCanvas).toHaveBeenNthCalledWith(1, lineArt, { x: 14, y: 12, width: 40, height: 30 });
    expect(cropCanvas).toHaveBeenNthCalledWith(2, source, { x: 14, y: 12, width: 40, height: 30 });
  });
});

function createOption(mode: ProcessedTattooOption["mode"], canvas: HTMLCanvasElement): ProcessedTattooOption {
  return { mode, label: mode, canvas };
}

function createCanvasStub(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent === name);

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button ${name}`);
  }

  return button;
}

function getModeButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll(".upload-confirm-mode-switch button"))
    .find((candidate) => candidate.textContent === name);

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing mode button ${name}`);
  }

  return button;
}

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);

  if (!element) {
    throw new Error(`Missing element ${selector}`);
  }

  return element as T;
}

function setCropperSelection(crop: { x: number; y: number; width: number; height: number }): void {
  const selection = getRequiredElement<HTMLElement & { x?: number; y?: number; width?: number; height?: number }>("cropper-selection");

  selection.x = crop.x;
  selection.y = crop.y;
  selection.width = crop.width;
  selection.height = crop.height;
}

function createAlphaCoverageCanvas(
  width: number,
  height: number,
  coverage: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const total = width * height;
  const visibleCount = Math.max(0, Math.min(total, Math.round(total * coverage)));
  const alpha = new Uint8ClampedArray(total * 4);

  for (let i = 0; i < visibleCount; i += 1) {
    alpha[i * 4 + 3] = 255;
  }

  Object.defineProperty(canvas, "getContext", {
    configurable: true,
    value: vi.fn((contextId: string) => {
      if (contextId !== "2d") {
        return null;
      }

      return {
        getImageData: vi.fn(() => ({ data: alpha })),
      };
    }),
  });
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
