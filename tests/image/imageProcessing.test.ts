import { afterEach, describe, expect, test, vi } from "vitest";
import {
  imageFileToCanvas,
  processTattooImageData,
  removeWhiteBackgroundFromPixels,
} from "../../src/image/imageProcessing";

describe("removeWhiteBackgroundFromPixels", () => {
  test("sets bright pixels transparent and leaves dark ink opaque", () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255,
      242, 241, 240, 255,
      18, 20, 22, 255,
    ]);

    removeWhiteBackgroundFromPixels(pixels, 235);

    expect(Array.from(pixels.slice(0, 4))).toEqual([255, 255, 255, 0]);
    expect(Array.from(pixels.slice(4, 8))).toEqual([242, 241, 240, 0]);
    expect(Array.from(pixels.slice(8, 12))).toEqual([18, 20, 22, 255]);
  });

  test("does not rewrite already transparent pixels while removing white", () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 0,
      252, 252, 252, 255,
      252, 252, 252, 80,
    ]);

    removeWhiteBackgroundFromPixels(pixels, 235);

    expect(Array.from(pixels.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(pixels.slice(4, 8))).toEqual([252, 252, 252, 0]);
    expect(Array.from(pixels.slice(8, 12))).toEqual([252, 252, 252, 80]);
  });

  test("respects custom high threshold when preserving bright gray pixels", () => {
    const pixels = new Uint8ClampedArray([
      240, 240, 240, 255,
      252, 252, 252, 255,
    ]);

    removeWhiteBackgroundFromPixels(pixels, 250);

    expect(Array.from(pixels.slice(0, 4))).toEqual([240, 240, 240, 255]);
    expect(Array.from(pixels.slice(4, 8))).toEqual([252, 252, 252, 0]);
  });

  test("respects custom opaque alpha threshold when preserving translucent white pixels", () => {
    const pixels = new Uint8ClampedArray([
      252, 252, 252, 199,
      252, 252, 252, 200,
    ]);

    removeWhiteBackgroundFromPixels(pixels, 235, 200);

    expect(Array.from(pixels.slice(0, 4))).toEqual([252, 252, 252, 199]);
    expect(Array.from(pixels.slice(4, 8))).toEqual([252, 252, 252, 0]);
  });
});

describe("processTattooImageData", () => {
  test("crops transparent padding and scales long content to the target size", () => {
    const imageData = createImageDataStub(8, 12, (x, y) => {
      if (x >= 3 && x <= 4 && y >= 1 && y <= 10) {
        return [12, 14, 16, 255];
      }

      return [0, 0, 0, 0];
    });

    const result = processTattooImageData(imageData, {
      removeWhite: true,
      maxContentSize: 5,
      createCanvas: createRecordingCanvas,
    });

    expect(result.sourceWidth).toBe(8);
    expect(result.sourceHeight).toBe(12);
    expect(result.contentBounds).toEqual({ x: 3, y: 1, width: 2, height: 10 });
    expect(result.hadTransparency).toBe(true);
    expect(result.canvas.width).toBe(1);
    expect(result.canvas.height).toBe(5);
    expect((result.canvas as HTMLCanvasElement & { drawImageCall?: number[] }).drawImageCall).toEqual([
      3, 1, 2, 10, 0, 0, 1, 5,
    ]);
  });
});

describe("imageFileToCanvas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("decodes image uploads through FileReader, Image, and canvas", async () => {
    const canvas = createCanvasStub();
    const createElement = vi.fn((tagName: string) => {
      if (tagName === "canvas") {
        return canvas;
      }

      throw new Error(`Unexpected element: ${tagName}`);
    });

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
      width = 12;
      height = 8;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("FileReader", TestFileReader);
    vi.stubGlobal("Image", TestImage);
    vi.stubGlobal("createImageBitmap", undefined);

    const result = await imageFileToCanvas(new File(["image"], "tattoo.png", { type: "image/png" }), false);

    expect(result.canvas).toBe(canvas);
    expect(result.sourceWidth).toBe(12);
    expect(result.sourceHeight).toBe(8);
    expect(canvas.context.drawImage).toHaveBeenCalled();
  });

  test("rejects with a useful message when FileReader cannot read the upload", async () => {
    const canvas = createCanvasStub();

    class FailingFileReader {
      result: string | ArrayBuffer | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      readAsDataURL(): void {
        queueMicrotask(() => this.onerror?.());
      }
    }

    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal("FileReader", FailingFileReader);
    vi.stubGlobal("createImageBitmap", undefined);

    await expect(
      imageFileToCanvas(new File(["image"], "tattoo.png", { type: "image/png" }), false),
    ).rejects.toThrow("Could not read tattoo.png");
  });
});

function createCanvasStub(): HTMLCanvasElement & {
  context: {
    drawImage: ReturnType<typeof vi.fn>;
    getImageData: ReturnType<typeof vi.fn>;
    putImageData: ReturnType<typeof vi.fn>;
  };
} {
  const context = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      width,
      height,
      data: createOpaqueBlackPixels(width, height),
    })),
    putImageData: vi.fn(),
  };

  return {
    width: 0,
    height: 0,
    context,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement & { context: typeof context };
}

function createOpaqueBlackPixels(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = 255;
  }

  return data;
}

function createImageDataStub(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = pixelAt(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = alpha;
    }
  }

  return { width, height, data } as ImageData;
}

function createRecordingCanvas(): HTMLCanvasElement & {
  drawImageCall?: number[];
} {
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({
      putImageData: vi.fn(),
      drawImage: vi.fn((...args: unknown[]) => {
        canvas.drawImageCall = args.slice(1) as number[];
      }),
    })),
  } as {
    width: number;
    height: number;
    drawImageCall?: number[];
    getContext: ReturnType<typeof vi.fn>;
  };

  return canvas as unknown as HTMLCanvasElement & { drawImageCall?: number[] };
}
