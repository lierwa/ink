import type { Rect, ShadingGeometryAssistDebug, Vector2 } from "./types";

export interface ResolveShadingGeometryAssistInput {
  enabled: boolean;
  sourceCanvas?: HTMLCanvasElement;
  localBounds: Rect;
  crossAxis: Vector2;
  maxAdjustmentRatio?: number;
}

export interface ShadingGeometryAssistResult {
  curvatureMultiplier: number;
  debug: ShadingGeometryAssistDebug;
}

export function resolveShadingGeometryAssist(
  input: ResolveShadingGeometryAssistInput,
): ShadingGeometryAssistResult {
  if (!input.enabled || !input.sourceCanvas) {
    return disabledResult("disabled");
  }

  const context = input.sourceCanvas.getContext("2d");
  if (!context) {
    return disabledResult("low-confidence");
  }

  const bounds = clampBounds(input.localBounds, input.sourceCanvas.width, input.sourceCanvas.height);
  if (bounds.width < 4 || bounds.height < 4) {
    return disabledResult("low-confidence");
  }

  let image: ImageData;
  try {
    image = context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
  } catch {
    return disabledResult("low-confidence");
  }
  const gradient = estimateLuminanceGradient(image.data, bounds.width, bounds.height);
  const gradientLength = Math.hypot(gradient.x, gradient.y);
  const confidence = clamp(gradientLength / 80, 0, 1);
  const crossLength = Math.hypot(input.crossAxis.x, input.crossAxis.y) || 1;
  const agreement = Math.abs(
    (gradient.x * input.crossAxis.x + gradient.y * input.crossAxis.y) / (gradientLength * crossLength || 1),
  );

  if (confidence < 0.18) {
    return disabledResult("low-confidence", confidence, agreement);
  }

  if (agreement < 0.35) {
    return disabledResult("geometry-conflict", confidence, agreement);
  }

  const maxAdjustmentRatio = clamp(input.maxAdjustmentRatio ?? 0.25, 0, 0.3);
  const appliedStrength = maxAdjustmentRatio * confidence * agreement;

  // WHY: 单张图光影无法唯一反推出真实法线，只能作为与几何方向一致时的弱投票。
  // TRADE-OFF: 有效照片上的提升会被限制，但能避免纹理/阴影把曲面方向带偏。
  return {
    curvatureMultiplier: 1 + appliedStrength,
    debug: {
      enabled: true,
      used: true,
      confidence,
      agreement,
      appliedStrength,
      reason: "used",
    },
  };
}

function estimateLuminanceGradient(data: Uint8ClampedArray, width: number, height: number): Vector2 {
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  let halfWidthSamples = 0;
  let halfHeightSamples = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const luminance = readLuminance(data, y * width + x);
      if (x < width / 2) {
        left += luminance;
        halfWidthSamples += 1;
      } else {
        right += luminance;
      }
      if (y < height / 2) {
        top += luminance;
        halfHeightSamples += 1;
      } else {
        bottom += luminance;
      }
    }
  }

  return {
    x: right / Math.max(1, width * height - halfWidthSamples) - left / Math.max(1, halfWidthSamples),
    y: bottom / Math.max(1, width * height - halfHeightSamples) - top / Math.max(1, halfHeightSamples),
  };
}

function readLuminance(data: Uint8ClampedArray, pixelIndex: number): number {
  const index = pixelIndex * 4;
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

function clampBounds(rect: Rect, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const x = clamp(Math.floor(rect.x), 0, Math.max(0, width - 1));
  const y = clamp(Math.floor(rect.y), 0, Math.max(0, height - 1));
  const right = clamp(Math.ceil(rect.x + rect.width), x + 1, width);
  const bottom = clamp(Math.ceil(rect.y + rect.height), y + 1, height);
  return { x, y, width: right - x, height: bottom - y };
}

function disabledResult(
  reason: ShadingGeometryAssistDebug["reason"],
  confidence = 0,
  agreement = 0,
): ShadingGeometryAssistResult {
  return {
    curvatureMultiplier: 1,
    debug: {
      enabled: reason !== "disabled",
      used: false,
      confidence,
      agreement,
      appliedStrength: 0,
      reason,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
