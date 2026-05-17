import { describe, expect, test, vi } from "vitest";
import { cropCanvasToCanvas, normalizeCropRect } from "../../src/image/cropCanvas";

describe("normalizeCropRect", () => {
  test("clamps crop rectangle to source bounds and rounds to pixels", () => {
    expect(normalizeCropRect(
      { x: -2.4, y: 3.6, width: 9.2, height: 20.1 },
      { width: 10, height: 12 },
    )).toEqual({ x: 0, y: 4, width: 7, height: 8 });
  });

  test("keeps at least one pixel in each dimension", () => {
    expect(normalizeCropRect(
      { x: 4, y: 4, width: 0, height: 0 },
      { width: 10, height: 10 },
    )).toEqual({ x: 4, y: 4, width: 1, height: 1 });
  });

  test("normalizes negative dimensions by treating the crop as two edges", () => {
    expect(normalizeCropRect(
      { x: 8, y: 2, width: -5, height: 4 },
      { width: 10, height: 10 },
    )).toEqual({ x: 3, y: 2, width: 5, height: 4 });
  });
});

describe("cropCanvasToCanvas", () => {
  test("exports the selected transparent crop with expected drawImage arguments", () => {
    const source = createCanvasStub(20, 16);
    const output = createCanvasStub();
    const result = cropCanvasToCanvas(source, { x: 3, y: 4, width: 8, height: 6 }, () => output);

    expect(result.width).toBe(8);
    expect(result.height).toBe(6);
    expect(output.context.drawImage).toHaveBeenCalledWith(source, 3, 4, 8, 6, 0, 0, 8, 6);
  });

  test("clears the output before drawing the selected crop", () => {
    const source = createCanvasStub(20, 16);
    const output = createCanvasStub();

    cropCanvasToCanvas(source, { x: 3, y: 4, width: 8, height: 6 }, () => output);

    expect(output.context.clearRect).toHaveBeenCalledWith(0, 0, 8, 6);
    expect(output.context.clearRect.mock.invocationCallOrder[0])
      .toBeLessThan(output.context.drawImage.mock.invocationCallOrder[0]);
  });

  test("throws when a 2D canvas context cannot be created", () => {
    const source = createCanvasStub(20, 16);
    const output = createCanvasWithoutContext();

    expect(() => cropCanvasToCanvas(source, { x: 3, y: 4, width: 8, height: 6 }, () => output))
      .toThrow("Could not create a 2D canvas context.");
  });
});

type CanvasStub = HTMLCanvasElement & {
  context: {
    clearRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
  };
};

function createCanvasStub(width = 0, height = 0): CanvasStub {
  const context = { clearRect: vi.fn(), drawImage: vi.fn() };
  return {
    width,
    height,
    context,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement & { context: typeof context };
}

function createCanvasWithoutContext(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => null),
  } as unknown as HTMLCanvasElement;
}
