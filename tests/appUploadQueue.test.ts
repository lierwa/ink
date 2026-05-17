// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createFabricUpdateQueue,
  getUploadCommitTransform,
  isSameTattooTransform,
} from "../src/appUploadQueue";
import type { Texture } from "pixi.js";
import type { TattooTransform } from "../src/domain/types";

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
    const uploadInput = document.createElement("input");
    const removeWhiteInput = document.createElement("input");
    const statusLabel = document.createElement("div");
    const defaultCanvas = createCanvasStub(16, 12);
    const fabric = createFabricStub();
    let resolveModal: ((value: null) => void) | undefined;

    removeWhiteInput.type = "checkbox";
    removeWhiteInput.checked = false;
    installImageDecodeStubs(80, 60);
    installCanvasDocumentStub();
    openUploadConfirmModal.mockImplementation(() => new Promise<null>((resolve) => {
      resolveModal = resolve;
    }));

    installUploadWorkflow({
      state: createWorkflowState(),
      elements: { uploadInput, removeWhiteInput, statusLabel },
      fabric,
      pixi: createPixiStub(),
      initialTransform: transform,
      renderTattoo: vi.fn(),
      syncPanelFromTransform: vi.fn(),
      createDefaultTattooCanvas: vi.fn(async () => defaultCanvas),
    });

    setInputFiles(uploadInput, [new File(["image"], "tattoo.png", { type: "image/png" })]);
    uploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(openUploadConfirmModal).toHaveBeenCalledTimes(1));

    setInputFiles(uploadInput, []);
    uploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(statusLabel.textContent).toBe("default linework"));

    expect(resolveModal).toBeTypeOf("function");
    (resolveModal as (value: null) => void)(null);
    await Promise.resolve();

    expect(statusLabel.textContent).toBe("default linework");
  });

  test("keeps local line-art canvas at source dimensions", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const uploadInput = document.createElement("input");
    const removeWhiteInput = document.createElement("input");
    const statusLabel = document.createElement("div");

    removeWhiteInput.type = "checkbox";
    removeWhiteInput.checked = true;
    installImageDecodeStubs(900, 600);
    installCanvasDocumentStub();
    openUploadConfirmModal.mockResolvedValue(null);

    installUploadWorkflow({
      state: createWorkflowState({ removeWhiteUpload: true }),
      elements: { uploadInput, removeWhiteInput, statusLabel },
      fabric: createFabricStub(),
      pixi: createPixiStub(),
      initialTransform: transform,
      renderTattoo: vi.fn(),
      syncPanelFromTransform: vi.fn(),
      createDefaultTattooCanvas: vi.fn(async () => createCanvasStub(16, 12)),
    });

    setInputFiles(uploadInput, [new File(["image"], "large.png", { type: "image/png" })]);
    uploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(openUploadConfirmModal).toHaveBeenCalledTimes(1));

    const modalInput = openUploadConfirmModal.mock.calls[0]?.[0];
    expect(modalInput.initialMode).toBe("line-art");
    expect(modalInput.options.map((option: { mode: string }) => option.mode)).toEqual(["line-art"]);
    expect(modalInput.options[0].canvas).toMatchObject({ width: 900, height: 600 });
  });

  test("opens confirmation modal with line-art even when cleanup toggle is disabled", async () => {
    const { installUploadWorkflow } = await import("../src/appUploadWorkflow");
    const uploadInput = document.createElement("input");
    const removeWhiteInput = document.createElement("input");
    const statusLabel = document.createElement("div");

    removeWhiteInput.type = "checkbox";
    removeWhiteInput.checked = false;
    installImageDecodeStubs(320, 240);
    installCanvasDocumentStub();
    openUploadConfirmModal.mockResolvedValue(null);

    installUploadWorkflow({
      state: createWorkflowState(),
      elements: { uploadInput, removeWhiteInput, statusLabel },
      fabric: createFabricStub(),
      pixi: createPixiStub(),
      initialTransform: transform,
      renderTattoo: vi.fn(),
      syncPanelFromTransform: vi.fn(),
      createDefaultTattooCanvas: vi.fn(async () => createCanvasStub(16, 12)),
    });

    setInputFiles(uploadInput, [new File(["image"], "fast.png", { type: "image/png" })]);
    uploadInput.dispatchEvent(new Event("change"));
    await waitFor(() => expect(openUploadConfirmModal).toHaveBeenCalledTimes(1));

    const modalInput = openUploadConfirmModal.mock.calls[0]?.[0];
    expect(modalInput.initialMode).toBe("line-art");
    expect(modalInput.options.map((option: { mode: string }) => option.mode)).toEqual(["line-art"]);
  });
});

function createWorkflowState(overrides: Partial<{
  removeWhiteUpload: boolean;
}> = {}) {
  return {
    tattooTransform: { ...transform },
    tattooSize: { width: 10, height: 10 },
    tattooTexture: {} as Texture,
    tattooDataUrl: "data:image/png;base64,old",
    transformRevision: 1,
    removeWhiteUpload: overrides.removeWhiteUpload ?? false,
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
    render: vi.fn(),
    dispose: vi.fn(),
  };
}

function createPixiStub() {
  return {
    canvas: document.createElement("canvas"),
    setTattoo: vi.fn(),
    setMeshResolution: vi.fn(),
    setDebugMeshVisible: vi.fn(),
    destroy: vi.fn(),
  };
}

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
      return createCanvasStub(0, 0);
    }

    return originalCreateElement(tagName);
  });
}

const originalCreateElement = document.createElement.bind(document);

function installImageDecodeStubs(width: number, height: number): void {
  class TestFileReader {
    result: string | ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL(): void {
      this.result = "data:image/png;base64,AA==";
      queueMicrotask(() => this.onload?.());
    }
  }

  class TestImage {
    width = width;
    height = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  vi.stubGlobal("FileReader", TestFileReader);
  vi.stubGlobal("Image", TestImage);
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (attempt === 19) {
        throw error;
      }
    }
  }
}
