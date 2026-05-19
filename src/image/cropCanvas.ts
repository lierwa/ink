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
  return drawCropToCanvas(source, rect, 0, createCanvas);
}

export function cropCanvasToPaddedCanvas(
  source: HTMLCanvasElement,
  crop: CropRect,
  padding: number,
  createCanvas: CanvasFactory = () => document.createElement("canvas"),
): HTMLCanvasElement {
  const rect = normalizeCropRect(crop, {
    width: source.width,
    height: source.height,
  });
  return drawCropToCanvas(source, rect, Math.max(0, Math.round(padding)), createCanvas);
}

export function cropCanvasToProjectionSafeCanvas(
  source: HTMLCanvasElement,
  crop: CropRect,
  createCanvas: CanvasFactory = () => document.createElement("canvas"),
): HTMLCanvasElement {
  const rect = normalizeCropRect(crop, {
    width: source.width,
    height: source.height,
  });
  const padding = getProjectionSafePadding(rect);
  return drawCropToCanvas(source, rect, padding, createCanvas);
}

function drawCropToCanvas(
  source: HTMLCanvasElement,
  rect: CropRect,
  padding: number,
  createCanvas: CanvasFactory,
): HTMLCanvasElement {
  const output = createCanvas();
  output.width = rect.width + padding * 2;
  output.height = rect.height + padding * 2;
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
    padding,
    padding,
    rect.width,
    rect.height,
  );

  return output;
}

function getProjectionSafePadding(rect: CropRect): number {
  // WHY: Pixi shader/Fabric 控制框都会按 texture 边界裁剪；给 tattoo 透明边距可避免头发、文字等贴边像素被线性采样和控制框硬边吃掉。
  // TRADE-OFF: 控制框会比可见 tattoo 略大，但可见内容尺寸保持不变，比让用户反复手动多裁一圈更稳定。
  return clamp(Math.round(Math.max(rect.width, rect.height) * 0.04), 8, 32);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
