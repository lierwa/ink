import type { SkinMask } from "../domain/types";

export function createSkinMaskFromCanvasAlpha(canvas: HTMLCanvasElement): SkinMask {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return createSkinMaskFromImageData(imageData);
}

export function createSkinMaskFromImageData(imageData: ImageData): SkinMask {
  const probabilities = new Float32Array(imageData.width * imageData.height);

  // WHY: adapter 层把像素源转成统一概率掩码，domain 只消费 SkinMask，避免把浏览器 API 依赖带入领域逻辑。
  // TRADE-OFF: 这里仍是 alpha 启发式，不等同语义分割；后续替换 MediaPipe 时可复用同一 domain 管线。
  for (let i = 0; i < probabilities.length; i += 1) {
    probabilities[i] = imageData.data[i * 4 + 3] / 255;
  }

  return {
    width: imageData.width,
    height: imageData.height,
    probabilities,
  };
}
