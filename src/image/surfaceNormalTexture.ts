import { Texture } from "pixi.js";
import type { Size, SurfaceFieldData } from "../domain/types";

export function createSurfaceNormalTexture(field: SurfaceFieldData): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = field.width;
  canvas.height = field.height;
  const context = requiredContext(canvas);
  const image = context.createImageData(field.width, field.height);
  image.data.set(field.normalRgba);
  context.putImageData(image, 0, 0);
  return Texture.from(canvas);
}

export function createFlatSurfaceNormalTexture(size: Size): Texture {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const normalRgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < normalRgba.length; i += 4) {
    normalRgba[i] = 128;
    normalRgba[i + 1] = 128;
    normalRgba[i + 2] = 255;
    normalRgba[i + 3] = 255;
  }

  // WHY: 默认法线贴图统一返回平面法线，确保无 body/surface 数据时 shader 路径稳定一致。
  // TRADE-OFF: 默认态不会产生额外体积感，但避免了条件分支切换导致的视觉跳变。
  return createSurfaceNormalTexture({ width, height, normalRgba });
}

function requiredContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }
  return context;
}
