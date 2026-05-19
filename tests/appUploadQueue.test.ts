// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createFabricUpdateQueue,
  getUploadCommitTransform,
  isSameTattooTransform,
} from "../src/appUploadQueue";
import type { Texture } from "pixi.js";
import type { TattooTransform } from "../src/domain/types";
import type { UploadWorkflowState } from "../src/appUploadWorkflow";

const openUploadConfirmModal = vi.fn();

vi.mock("../src/editor/uploadConfirmModal", () => ({
  openUploadConfirmModal,
}));

vi.mock("pixi.js", () => ({
  Texture: {
    from: vi.fn((source: unknown) => ({ source })),
  },
}));

const transform: TattooTransform = {
  x: 10,
  y: 20,
  scale: 0.4,
  rotation: 0.1,
  opacity: 0.8,
};

describe("upload transform commit helpers", () => {
  test("upload resets scale only when transform revision did not change", () => {
    expect(getUploadCommitTransform({
      tattooTransform: transform,
      transformRevision: 2,
    }, 2)).toEqual({ ...transform, scale: 1 });

    expect(getUploadCommitTransform({
      tattooTransform: { ...transform, scale: 0.7 },
      transformRevision: 3,
    }, 2)).toEqual({ ...transform, scale: 0.7 });
  });

  test("same transform comparison ignores tiny no-op deltas", () => {
    expect(isSameTattooTransform(transform, {
      ...transform,
      x: transform.x + 0.0000001,
    })).toBe(true);
  });
});

describe("createFabricUpdateQueue", () => {
  test("skips stale queued updates", async () => {
    let currentRequest = 1;
    const queue = createFabricUpdateQueue((requestId) => requestId === currentRequest);
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => true);

    const firstPromise = queue(1, first);
    currentRequest = 2;
    const secondPromise = queue(2, second);

    await expect(firstPromise).resolves.toBe(false);
    await expect(secondPromise).resolves.toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });
});

describe("installUploadWorkflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    openUploadConfirmModal.mockReset();
  });

  test("stale modal cancel does not overwrite current request status", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const tattooUploadInput = document.createElement("input");
    const statusLabel = document.createElement("div");
    const fabric = createFabricStub();
    let resolveModal: ((value: null) => void) | undefined;

    installImageDecodeStubs(80, 60);
    installCanvasDocumentStub();
    openUploadConfirmModal.mockImplementation(() => new Promise<null>((resolve) => {
      resolveModal = resolve;
    }));

    installUploadWorkflow({
      state: createWorkflowState(),
      elements: {
        tattooUploadInput,
        statusLabel,
        editTattooButton: document.createElement("button"),
        removeTattooButton: document.createElement("button"),
      },
      fabric,
      initialTransform: transform,
      renderTattoo: vi.fn(),
      syncPanelFromTransform: vi.fn(),
    });

    setInputFiles(tattooUploadInput, [new File(["image"], "tattoo.png", { type: "image/png" })]);
    tattooUploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(openUploadConfirmModal).toHaveBeenCalledTimes(1));

    setInputFiles(tattooUploadInput, []);
    tattooUploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(statusLabel.textContent).toBe("Upload tattoo to enable transform controls"));

    expect(resolveModal).toBeTypeOf("function");
    (resolveModal as (value: null) => void)(null);
    await Promise.resolve();

    expect(statusLabel.textContent).toBe("Upload tattoo to enable transform controls");
  });

  test("builds original and line-art options with normalized preview dimensions", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const tattooUploadInput = document.createElement("input");
    const statusLabel = document.createElement("div");

    installImageDecodeStubs(900, 600);
    installCanvasDocumentStub();
    openUploadConfirmModal.mockResolvedValue(null);

    installUploadWorkflow({
      state: createWorkflowState(),
      elements: {
        tattooUploadInput,
        statusLabel,
        editTattooButton: document.createElement("button"),
        removeTattooButton: document.createElement("button"),
      },
      fabric: createFabricStub(),
      initialTransform: transform,
      renderTattoo: vi.fn(),
      syncPanelFromTransform: vi.fn(),
    });

    setInputFiles(tattooUploadInput, [new File(["image"], "large.png", { type: "image/png" })]);
    tattooUploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(openUploadConfirmModal).toHaveBeenCalledTimes(1));

    const modalInput = openUploadConfirmModal.mock.calls[0]?.[0];
    expect(modalInput.initialMode).toBe("line-art");
    expect(modalInput.options.map((option: { mode: string }) => option.mode)).toEqual(["original", "line-art"]);
    expect(modalInput.options[0].canvas).toMatchObject({ width: 520, height: 347 });
    expect(modalInput.options[1].canvas).toMatchObject({ width: 520, height: 347 });
  });

  test("updates status message after tattoo apply", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const tattooUploadInput = document.createElement("input");
    const statusLabel = document.createElement("div");
    const confirmedCanvas = createCanvasStub(320, 240);

    installImageDecodeStubs(320, 240);
    installCanvasDocumentStub();
    openUploadConfirmModal.mockResolvedValue({
      canvas: confirmedCanvas,
      mode: "original",
      cropRect: { x: 0, y: 0, width: 320, height: 240 },
    });

    installUploadWorkflow({
      state: createWorkflowState(),
      elements: {
        tattooUploadInput,
        statusLabel,
        editTattooButton: document.createElement("button"),
        removeTattooButton: document.createElement("button"),
      },
      fabric: createFabricStub(),
      initialTransform: transform,
      renderTattoo: vi.fn(),
      syncPanelFromTransform: vi.fn(),
    });

    setInputFiles(tattooUploadInput, [new File(["image"], "fast.png", { type: "image/png" })]);
    tattooUploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(statusLabel.textContent).toBe("applied tattoo (original)"));
  });

  test("updates current tattoo file label and renders Pixi-visible asset after apply", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const tattooUploadInput = document.createElement("input");
    const tattooUploadStatus = document.createElement("div");
    const statusLabel = document.createElement("div");
    const confirmedCanvas = createCanvasStub(128, 96);
    const state = createWorkflowState();
    const renderTattoo = vi.fn(() => {
      expect(state.tattooAsset?.texture).toMatchObject({ source: confirmedCanvas });
      expect(state.tattooAsset?.size).toEqual({ width: 128, height: 96 });
      expect(state.tattooTransform.opacity).toBeGreaterThan(0);
    });

    installImageDecodeStubs(128, 96);
    installCanvasDocumentStub();
    openUploadConfirmModal.mockResolvedValue({
      canvas: confirmedCanvas,
      mode: "original",
      cropRect: { x: 0, y: 0, width: 128, height: 96 },
    });

    installUploadWorkflow({
      state,
      elements: {
        tattooUploadInput,
        tattooUploadStatus,
        statusLabel,
        editTattooButton: document.createElement("button"),
        removeTattooButton: document.createElement("button"),
      },
      fabric: createFabricStub(),
      initialTransform: transform,
      renderTattoo,
      syncPanelFromTransform: vi.fn(),
    });

    setInputFiles(tattooUploadInput, [new File(["image"], "rose.png", { type: "image/png" })]);
    tattooUploadInput.dispatchEvent(new Event("change"));

    await waitFor(() => expect(renderTattoo).toHaveBeenCalledTimes(1));
    expect(tattooUploadStatus.textContent).toBe("Current: rose.png");
  });

  test("shows fallback status when line-art result falls back to original", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const tattooUploadInput = document.createElement("input");
    const statusLabel = document.createElement("div");
    const confirmedCanvas = createCanvasStub(320, 240);

    installImageDecodeStubs(320, 240);
    installCanvasDocumentStub();
    openUploadConfirmModal.mockResolvedValue({
      canvas: confirmedCanvas,
      mode: "original",
      cropRect: { x: 0, y: 0, width: 320, height: 240 },
      fallbackFrom: "line-art",
    });

    installUploadWorkflow({
      state: createWorkflowState(),
      elements: {
        tattooUploadInput,
        statusLabel,
        editTattooButton: document.createElement("button"),
        removeTattooButton: document.createElement("button"),
      },
      fabric: createFabricStub(),
      initialTransform: transform,
      renderTattoo: vi.fn(),
      syncPanelFromTransform: vi.fn(),
    });

    setInputFiles(tattooUploadInput, [new File(["image"], "fallback.png", { type: "image/png" })]);
    tattooUploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(statusLabel.textContent).toBe("applied tattoo (line-art -> original fallback)"));
  });

  test("clears file input value after handling so the same file can be selected again", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const tattooUploadInput = document.createElement("input");
    const statusLabel = document.createElement("div");
    const confirmedCanvas = createCanvasStub(320, 240);

    installImageDecodeStubs(320, 240);
    installCanvasDocumentStub();
    openUploadConfirmModal.mockResolvedValue({
      canvas: confirmedCanvas,
      mode: "original",
      cropRect: { x: 0, y: 0, width: 320, height: 240 },
    });

    installUploadWorkflow({
      state: createWorkflowState(),
      elements: {
        tattooUploadInput,
        statusLabel,
        editTattooButton: document.createElement("button"),
        removeTattooButton: document.createElement("button"),
      },
      fabric: createFabricStub(),
      initialTransform: transform,
      renderTattoo: vi.fn(),
      syncPanelFromTransform: vi.fn(),
    });

    Object.defineProperty(tattooUploadInput, "value", {
      configurable: true,
      writable: true,
      value: "C:\\fakepath\\same.png",
    });
    setInputFiles(tattooUploadInput, [new File(["image"], "same.png", { type: "image/png" })]);
    tattooUploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(statusLabel.textContent).toBe("applied tattoo (original)"));

    expect(tattooUploadInput.value).toBe("");
  });

  test("remove tattoo clears fabric, state, and render output", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const tattooUploadInput = document.createElement("input");
    const editTattooButton = document.createElement("button");
    const removeTattooButton = document.createElement("button");
    const statusLabel = document.createElement("div");
    const tattooUploadStatus = document.createElement("div");
    const fabric = createFabricStub();
    const state = createWorkflowState();
    const renderTattoo = vi.fn();

    installUploadWorkflow({
      state,
      elements: { tattooUploadInput, tattooUploadStatus, statusLabel, editTattooButton, removeTattooButton },
      fabric,
      initialTransform: transform,
      renderTattoo,
      syncPanelFromTransform: vi.fn(),
    });

    removeTattooButton.click();

    expect(fabric.clearTattoo).toHaveBeenCalled();
    expect(state.tattooAsset).toBeNull();
    expect(renderTattoo).toHaveBeenCalled();
    expect(statusLabel.textContent).toBe("Upload tattoo to enable transform controls");
    expect(tattooUploadStatus.textContent).toBe("No tattoo uploaded");
  });

  test("edit crop preserves existing transform scale and re-renders the confirmed tattoo asset", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const tattooUploadInput = document.createElement("input");
    const editTattooButton = document.createElement("button");
    const removeTattooButton = document.createElement("button");
    const statusLabel = document.createElement("div");
    const fabric = createFabricStub();
    const renderTattoo = vi.fn(() => {
      expect(state.tattooAsset?.texture).toMatchObject({ source: confirmedCanvas });
      expect(state.tattooAsset?.size).toEqual({ width: 48, height: 32 });
    });
    const previousCropRect = { x: 2, y: 3, width: 7, height: 8 };
    const confirmedCropRect = { x: 1, y: 1, width: 6, height: 6 };
    const confirmedCanvas = createCanvasStub(48, 32);
    const state = createWorkflowState();
    const existingAsset = state.tattooAsset;
    if (!existingAsset) {
      throw new Error("Expected workflow test state to include an existing tattoo asset.");
    }

    state.tattooTransform = { ...state.tattooTransform, scale: 0.42 };
    state.tattooAsset = {
      ...existingAsset,
      selectedMode: "line-art",
      cropRect: previousCropRect,
    };

    installCanvasDocumentStub();
    openUploadConfirmModal.mockResolvedValue({
      canvas: confirmedCanvas,
      mode: "original",
      cropRect: confirmedCropRect,
    });

    installUploadWorkflow({
      state,
      elements: { tattooUploadInput, statusLabel, editTattooButton, removeTattooButton },
      fabric,
      initialTransform: transform,
      renderTattoo,
      syncPanelFromTransform: vi.fn(),
    });

    editTattooButton.click();
    await waitFor(() => expect(renderTattoo).toHaveBeenCalledTimes(1));

    const modalInput = openUploadConfirmModal.mock.calls[0]?.[0];
    expect(modalInput.initialMode).toBe("line-art");
    expect(modalInput.initialCropRect).toEqual(previousCropRect);
    expect(fabric.setImage.mock.calls[0]?.[1].scale).toBe(0.42);
    expect(state.tattooTransform.scale).toBe(0.42);
  });
});

function createWorkflowState(): UploadWorkflowState {
  return {
    tattooTransform: { ...transform },
    tattooAsset: {
      size: { width: 10, height: 10 },
      texture: {} as Texture,
      dataUrl: "data:image/png;base64,old",
      sourceCanvas: createCanvasStub(10, 10),
      fileName: "old.png",
      selectedMode: "original" as const,
      cropRect: { x: 0, y: 0, width: 10, height: 10 },
    },
    transformRevision: 1,
  };
}

function createFabricStub() {
  return {
    setImage: vi.fn(async (
      _dataUrl: string,
      _transform: TattooTransform,
      shouldCommit = () => true,
      getCommitTransform?: () => TattooTransform,
    ) => {
      if (!shouldCommit()) {
        return false;
      }

      getCommitTransform?.();
      return true;
    }),
    setTransform: vi.fn(),
    getTransform: vi.fn(() => transform),
    clearTattoo: vi.fn(),
    hasTattoo: vi.fn(() => true),
    render: vi.fn(),
    dispose: vi.fn(),
  };
}

const originalCreateElement = document.createElement.bind(document);

function createCanvasStub(width: number, height: number): HTMLCanvasElement & {
  context: {
    drawImage: ReturnType<typeof vi.fn>;
    getImageData: ReturnType<typeof vi.fn>;
    putImageData: ReturnType<typeof vi.fn>;
  };
} {
  const canvas = originalCreateElement("canvas") as HTMLCanvasElement & {
    context: {
      drawImage: ReturnType<typeof vi.fn>;
      getImageData: ReturnType<typeof vi.fn>;
      putImageData: ReturnType<typeof vi.fn>;
    };
  };
  const context = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, sourceWidth: number, sourceHeight: number) => ({
      width: sourceWidth,
      height: sourceHeight,
      data: new Uint8ClampedArray(sourceWidth * sourceHeight * 4),
    })),
    putImageData: vi.fn(),
  };

  canvas.width = width;
  canvas.height = height;
  canvas.context = context;
  Object.defineProperty(canvas, "getContext", {
    configurable: true,
    value: vi.fn((contextId: string) => (
      contextId === "2d" ? context as unknown as CanvasRenderingContext2D : null
    )),
  });
  vi.spyOn(canvas, "toDataURL").mockReturnValue(`data:image/png;base64,${width}x${height}`);
  return canvas;
}

function installCanvasDocumentStub(): void {
  vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
    if (tagName.toLowerCase() === "canvas") {
      return createCanvasStub(1, 1);
    }

    return originalCreateElement(tagName);
  });
}

function installImageDecodeStubs(width: number, height: number): void {
  class FakeFileReader {
    static DONE = 2;
    readyState = 0;
    result: string | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsDataURL(file: File): void {
      this.readyState = FakeFileReader.DONE;
      this.result = `data:image/png;base64,${file.name}`;
      queueMicrotask(() => {
        this.onload?.({ target: this as unknown as FileReader } as ProgressEvent<FileReader>);
      });
    }
  }

  class FakeImage {
    width = width;
    height = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => {
        this.onload?.();
      });
    }
  }

  vi.stubGlobal("FileReader", FakeFileReader as unknown as typeof FileReader);
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    get() {
      return files as unknown as FileList;
    },
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    try {
      assertion();
      return;
    } catch {
      await Promise.resolve();
    }
  }

  assertion();
}
