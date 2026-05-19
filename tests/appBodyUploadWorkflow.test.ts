// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { installBodyUploadWorkflow } from "../src/appBodyUploadWorkflow";
import { defaultBodyMeshPipelineParams } from "../src/domain/skinMeshPipeline";
import type { BodyUploadModalInput } from "../src/editor/bodyUploadModal";

const mocks = vi.hoisted(() => ({
  openBodyUploadModal: vi.fn(),
  textureFrom: vi.fn((source: unknown) => ({ source })),
}));

vi.mock("../src/editor/bodyUploadModal", () => ({
  openBodyUploadModal: mocks.openBodyUploadModal,
}));

vi.mock("pixi.js", () => ({
  Texture: {
    from: mocks.textureFrom,
  },
}));

describe("installBodyUploadWorkflow", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.restoreAllMocks();
    installCanvasContextStub();
    installFileReaderStub();
    installImageStub();
  });

  test("unbinds previous normal texture before destroying it on Apply Body", async () => {
    const lifecycleCalls: string[] = [];
    const previousNormalTexture = {
      source: { id: "previous-normal" },
      destroy: vi.fn(() => lifecycleCalls.push("destroy previous normal")),
    };
    const state = {
      tattooTransform: {
        x: 450,
        y: 310,
        scale: 0.42,
        rotation: 0,
        opacity: 1,
      },
      bodySurfaceState: {
        texture: { source: { id: "old-body" } },
        surfaceNormalTexture: previousNormalTexture,
        placementRect: { x: 0, y: 0, width: 900, height: 620 },
        sourceSize: { width: 900, height: 620 },
        mask: { width: 2, height: 2, probabilities: new Float32Array(4).fill(1) },
        mesh: createTriangleMesh(900, 620),
        pipelineParams: { ...defaultBodyMeshPipelineParams },
        analysisDebug: null,
        revision: 0,
      },
    };
    const bodyUploadInput = document.createElement("input");
    bodyUploadInput.type = "file";
    Object.defineProperty(bodyUploadInput, "files", {
      value: [new File(["body"], "body.png", { type: "image/png" })],
    });
    const pixi = {
      setSurfaceNormalTexture: vi.fn(() => lifecycleCalls.push("unbind normal")),
      setBodyAnalysisDebug: vi.fn(),
    };
    mocks.openBodyUploadModal.mockImplementation(async (input: BodyUploadModalInput) => ({
      sourceCanvas: input.sourceCanvas,
      params: { ...defaultBodyMeshPipelineParams },
      preview: {
        mask: { width: 2, height: 2, probabilities: new Float32Array(4).fill(1) },
        mesh: createTriangleMesh(64, 32),
      },
    }));

    installBodyUploadWorkflow({
      state: state as never,
      elements: {
        bodyUploadInput,
        editBodyButton: document.createElement("button"),
        removeBodyButton: document.createElement("button"),
        statusLabel: document.createElement("div"),
      } as never,
      pixi: pixi as never,
      initialTransform: state.tattooTransform,
      setTransform: vi.fn(),
      renderBodySurface: vi.fn(),
      resetBodySurface: vi.fn(),
    });

    bodyUploadInput.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(previousNormalTexture.destroy).toHaveBeenCalledWith(true);
    });
    expect(lifecycleCalls.slice(0, 2)).toEqual(["unbind normal", "destroy previous normal"]);
  });

  test("edit body reopens modal with stored source canvas and params", async () => {
    const state = createBodyWorkflowState();
    const editBodyButton = document.createElement("button");
    installBodyUploadWorkflow({
      state: state as never,
      elements: {
        bodyUploadInput: document.createElement("input"),
        editBodyButton,
        removeBodyButton: document.createElement("button"),
        statusLabel: document.createElement("div"),
      } as never,
      pixi: { setSurfaceNormalTexture: vi.fn(), setBodyAnalysisDebug: vi.fn() } as never,
      initialTransform: state.tattooTransform,
      setTransform: vi.fn(),
      renderBodySurface: vi.fn(),
      resetBodySurface: vi.fn(),
    });

    editBodyButton.click();

    await vi.waitFor(() => expect(mocks.openBodyUploadModal).toHaveBeenCalledTimes(1));
    expect(mocks.openBodyUploadModal.mock.calls[0][0].sourceCanvas).toBe(state.bodySurfaceState.sourceCanvas);
    expect(mocks.openBodyUploadModal.mock.calls[0][0].initialParams).toEqual(state.bodySurfaceState.pipelineParams);
  });

  test("remove body delegates to app-level body reset", () => {
    const state = createBodyWorkflowState();
    const removeBodyButton = document.createElement("button");
    const resetBodySurface = vi.fn();
    installBodyUploadWorkflow({
      state: state as never,
      elements: {
        bodyUploadInput: document.createElement("input"),
        editBodyButton: document.createElement("button"),
        removeBodyButton,
        statusLabel: document.createElement("div"),
      } as never,
      pixi: { setSurfaceNormalTexture: vi.fn(), setBodyAnalysisDebug: vi.fn() } as never,
      initialTransform: state.tattooTransform,
      setTransform: vi.fn(),
      renderBodySurface: vi.fn(),
      resetBodySurface,
    });

    removeBodyButton.click();

    expect(resetBodySurface).toHaveBeenCalledTimes(1);
  });
});

function createBodyWorkflowState() {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = 64;
  sourceCanvas.height = 32;
  return {
    tattooTransform: { x: 450, y: 310, scale: 0.42, rotation: 0, opacity: 1 },
    bodySurfaceState: {
      texture: { source: { id: "body" } },
      sourceCanvas,
      fileName: "body.png",
      surfaceNormalTexture: null,
      placementRect: { x: 0, y: 0, width: 900, height: 620 },
      sourceSize: { width: 64, height: 32 },
      mask: { width: 2, height: 2, probabilities: new Float32Array(4).fill(1) },
      mesh: createTriangleMesh(64, 32),
      pipelineParams: { ...defaultBodyMeshPipelineParams },
      analysisDebug: null,
      revision: 0,
    },
  };
}

function createTriangleMesh(width: number, height: number) {
  return {
    positions: new Float32Array([0, 0, width, 0, 0, height]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

function installCanvasContextStub(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((contextId: string) => {
    if (contextId !== "2d") {
      return null;
    }

    return {
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  }) as typeof HTMLCanvasElement.prototype.getContext);
}

function installFileReaderStub(): void {
  class FakeFileReader {
    result: string | ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL(): void {
      this.result = "data:image/png;base64,body";
      queueMicrotask(() => this.onload?.());
    }
  }

  vi.stubGlobal("FileReader", FakeFileReader);
}

function installImageStub(): void {
  class FakeImage {
    width = 64;
    height = 32;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  vi.stubGlobal("Image", FakeImage);
}
