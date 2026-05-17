import type { Size } from "../domain/types";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CanvasFactory = () => HTMLCanvasElement;

export function normalizeCropRect(rect: CropRect, sourceSize: Size): CropRect {
  // WHY: 把裁剪框归一化为两条边后再裁剪，能统一处理拖拽反向产生的负宽高；取舍是越界部分直接丢弃。
  const leftEdge = Math.round(Math.min(rect.x, rect.x + rect.width));
  const rightEdge = Math.round(Math.max(rect.x, rect.x + rect.width));
  const topEdge = Math.round(Math.min(rect.y, rect.y + rect.height));
  const bottomEdge = Math.round(Math.max(rect.y, rect.y + rect.height));
  const x = clamp(leftEdge, 0, Math.max(0, sourceSize.width - 1));
  const y = clamp(topEdge, 0, Math.max(0, sourceSize.height - 1));
  const right = clamp(rightEdge, x + 1, sourceSize.width);
  const bottom = clamp(bottomEdge, y + 1, sourceSize.height);
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);

  return { x, y, width, height };
}

export function cropCanvasToCanvas(
  source: HTMLCanvasElement,
  crop: CropRect,
  createCanvas: CanvasFactory = () => document.createElement("canvas"),
): HTMLCanvasElement {
  const rect = normalizeCropRect(crop, {
    width: source.width,
    height: source.height,
  });
  const output = createCanvas();
  output.width = rect.width;
  output.height = rect.height;
  const context = output.getContext("2d");

  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }

  context.clearRect(0, 0, output.width, output.height);
  context.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );

  return output;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
