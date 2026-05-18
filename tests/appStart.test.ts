// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

const createFabricTattooController = vi.fn(async () => ({
  setImage: vi.fn(async () => true),
  setTransform: vi.fn(),
  getTransform: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
}));

const renderer = {
  canvas: document.createElement("canvas"),
  setBodySurface: vi.fn(),
  setSurfaceIntensity: vi.fn(),
  setTattoo: vi.fn(),
  clearTattoo: vi.fn(),
  setDebugMeshVisible: vi.fn(),
  setSkinDebugMesh: vi.fn(),
  destroy: vi.fn(),
};

const canvasTextCalls: string[] = [];

vi.mock("../src/editor/fabricController", () => ({
  createFabricTattooController,
}));

vi.mock("../src/render/pixiRenderer", () => ({
  createPixiTattooRenderer: vi.fn(async () => renderer),
  tattooBlendMode: "normal",
}));

vi.mock("pixi.js", () => ({
  Texture: {
    EMPTY: { empty: true },
    from: vi.fn((source: unknown) => ({ source })),
  },
}));

describe("startApp initial tattoo state", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    canvasTextCalls.length = 0;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("starts without a Fabric tattoo object or visible transform panel", async () => {
    document.body.innerHTML = `<div id="app"></div>`;
    installImageDecodeStub();
    installCanvasContextStub();

    const { startApp } = await import("../src/app");
    await startApp();

    const fabricCalls = createFabricTattooController.mock.calls as unknown as Array<[{
      initialImageDataUrl?: string;
    }]>;
    const fabricInput = fabricCalls[0]?.[0];
    if (!fabricInput) {
      throw new Error("Missing Fabric controller input.");
    }
    expect(fabricInput.initialImageDataUrl).toBeUndefined();
    expect(renderer.setTattoo).not.toHaveBeenCalled();
    expect(renderer.clearTattoo).toHaveBeenCalled();

    const transformPanel = document.querySelector<HTMLElement>("[data-tattoo-transform-panel]");
    expect(transformPanel).toBeInstanceOf(HTMLElement);
    expect(transformPanel?.hidden).toBe(true);
    expect(document.querySelector("#status")?.textContent).toContain("Upload tattoo");
  });

  test("does not draw body-upload prompt text into the default sphere placeholder", async () => {
    document.body.innerHTML = `<div id="app"></div>`;
    installImageDecodeStub();
    installCanvasContextStub();

    const { startApp } = await import("../src/app");
    await startApp();

    expect(canvasTextCalls).not.toContain("Upload body photo");
  });
});

function installImageDecodeStub(): void {
  class FakeImage {
    width = 32;
    height = 32;
    onload: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => {
        this.onload?.();
      });
    }
  }

  vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
}

function installCanvasContextStub(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((contextId: string) => {
    if (contextId !== "2d") {
      return null;
    }

    return {
      drawImage: vi.fn(),
      fill: vi.fn(),
      beginPath: vi.fn(),
      ellipse: vi.fn(),
      createImageData: vi.fn((width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      })),
      putImageData: vi.fn(),
      fillText: vi.fn((text: string) => {
        canvasTextCalls.push(text);
      }),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      arc: vi.fn(),
      clearRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  }) as typeof HTMLCanvasElement.prototype.getContext);
}
