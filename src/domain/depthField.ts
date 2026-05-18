import type { DepthFieldData, Rect, Size, SkinMask } from "./types";

export interface DepthFieldEstimateInput {
  sourceCanvas: HTMLCanvasElement;
  stageSize: Size;
  placementRect: Rect;
  mask: SkinMask;
  threshold?: number;
  blurPasses?: number;
}

export interface DepthFieldPriorInput {
  stageSize: Size;
  placementRect: Rect;
  mask: SkinMask;
  threshold?: number;
  blurPasses?: number;
}

export interface DepthFieldQualityInput {
  depthField: DepthFieldData;
  placementRect: Rect;
  mask: SkinMask;
  threshold?: number;
}

export interface DepthFieldFuseInput {
  onnxDepthField: DepthFieldData;
  priorDepthField: DepthFieldData;
  qualityScore: number;
}

const defaultMaskThreshold = 0.4;
const defaultBlurPasses = 2;
const infinityDistance = 1e6;

export function estimateDepthFieldFromCanvas(input: DepthFieldEstimateInput): DepthFieldData {
  const width = Math.max(1, Math.round(input.stageSize.width));
  const height = Math.max(1, Math.round(input.stageSize.height));
  const depth = new Float32Array(width * height);
  const threshold = input.threshold ?? defaultMaskThreshold;
  const blurPasses = Math.max(0, Math.round(input.blurPasses ?? defaultBlurPasses));

  if (input.sourceCanvas.width <= 0 || input.sourceCanvas.height <= 0) {
    return { width, height, depth };
  }
  if (input.placementRect.width <= 0 || input.placementRect.height <= 0) {
    return { width, height, depth };
  }

  const context = requiredContext(input.sourceCanvas);
  const rgba = context.getImageData(0, 0, input.sourceCanvas.width, input.sourceCanvas.height).data;
  const safeMaskWidth = Math.max(input.mask.width, 1);
  const safeMaskHeight = Math.max(input.mask.height, 1);

  const startX = clampInt(Math.floor(input.placementRect.x), 0, width - 1);
  const startY = clampInt(Math.floor(input.placementRect.y), 0, height - 1);
  const endX = clampInt(Math.ceil(input.placementRect.x + input.placementRect.width), 0, width);
  const endY = clampInt(Math.ceil(input.placementRect.y + input.placementRect.height), 0, height);
  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = Number.NEGATIVE_INFINITY;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const normalizedX = (x + 0.5 - input.placementRect.x) / input.placementRect.width;
      const normalizedY = (y + 0.5 - input.placementRect.y) / input.placementRect.height;
      const maskX = clampInt(Math.floor(normalizedX * safeMaskWidth), 0, safeMaskWidth - 1);
      const maskY = clampInt(Math.floor(normalizedY * safeMaskHeight), 0, safeMaskHeight - 1);
      const maskIndex = maskY * safeMaskWidth + maskX;
      if (input.mask.probabilities[maskIndex] < threshold) {
        continue;
      }

      const sourceX = clampInt(Math.floor(normalizedX * input.sourceCanvas.width), 0, input.sourceCanvas.width - 1);
      const sourceY = clampInt(Math.floor(normalizedY * input.sourceCanvas.height), 0, input.sourceCanvas.height - 1);
      const sourceIndex = (sourceY * input.sourceCanvas.width + sourceX) * 4;
      const luma = rgbToLuma(rgba[sourceIndex], rgba[sourceIndex + 1], rgba[sourceIndex + 2]);
      const stageIndex = y * width + x;
      depth[stageIndex] = luma;
      minDepth = Math.min(minDepth, luma);
      maxDepth = Math.max(maxDepth, luma);
    }
  }

  if (!Number.isFinite(minDepth) || !Number.isFinite(maxDepth) || maxDepth - minDepth < 1e-6) {
    return { width, height, depth };
  }

  const span = maxDepth - minDepth;
  for (let i = 0; i < depth.length; i += 1) {
    if (depth[i] <= 0) {
      continue;
    }
    depth[i] = (depth[i] - minDepth) / span;
  }

  if (blurPasses > 0) {
    blurDepthInPlace(depth, width, height, blurPasses);
  }

  // WHY: 单目明暗深度不是几何真值，与 skin mask 融合前先做归一化和平滑，可减少衣纹/高光造成的法线噪声。
  // TRADE-OFF: 细小结构会被抹平，但能换来更稳定的肩颈胸廓连续弯曲。
  return { width, height, depth };
}

export function estimateDepthFieldQuality(input: DepthFieldQualityInput): number {
  const threshold = input.threshold ?? defaultMaskThreshold;
  const width = input.depthField.width;
  const height = input.depthField.height;
  if (width <= 1 || height <= 1 || input.depthField.depth.length !== width * height) {
    return 0;
  }
  if (input.placementRect.width <= 0 || input.placementRect.height <= 0) {
    return 0;
  }

  const safeMaskWidth = Math.max(input.mask.width, 1);
  const safeMaskHeight = Math.max(input.mask.height, 1);
  const startX = clampInt(Math.floor(input.placementRect.x), 0, width - 1);
  const startY = clampInt(Math.floor(input.placementRect.y), 0, height - 1);
  const endX = clampInt(Math.ceil(input.placementRect.x + input.placementRect.width), 0, width);
  const endY = clampInt(Math.ceil(input.placementRect.y + input.placementRect.height), 0, height);

  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let gradEnergy = 0;
  let gradCount = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const normalizedX = (x + 0.5 - input.placementRect.x) / input.placementRect.width;
      const normalizedY = (y + 0.5 - input.placementRect.y) / input.placementRect.height;
      const maskX = clampInt(Math.floor(normalizedX * safeMaskWidth), 0, safeMaskWidth - 1);
      const maskY = clampInt(Math.floor(normalizedY * safeMaskHeight), 0, safeMaskHeight - 1);
      const maskIndex = maskY * safeMaskWidth + maskX;
      if (input.mask.probabilities[maskIndex] < threshold) {
        continue;
      }

      const index = y * width + x;
      const depthValue = input.depthField.depth[index];
      if (!Number.isFinite(depthValue)) {
        continue;
      }

      count += 1;
      sum += depthValue;
      sumSq += depthValue * depthValue;
      if (x > startX && y > startY && x < endX - 1 && y < endY - 1) {
        const dx = (input.depthField.depth[index + 1] - input.depthField.depth[index - 1]) * 0.5;
        const dy = (input.depthField.depth[index + width] - input.depthField.depth[index - width]) * 0.5;
        gradEnergy += Math.sqrt(dx * dx + dy * dy);
        gradCount += 1;
      }
    }
  }

  if (count <= 8) {
    return 0;
  }

  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  const varianceScore = clamp(Math.sqrt(variance) / 0.2, 0, 1);
  const gradientScore = clamp((gradEnergy / Math.max(gradCount, 1)) / 0.065, 0, 1);
  const placementArea = Math.max((endX - startX) * (endY - startY), 1);
  const coverageScore = clamp(count / (placementArea * 0.22), 0, 1);

  return clamp(varianceScore * 0.45 + gradientScore * 0.45 + coverageScore * 0.1, 0, 1);
}

export function estimateMaskPriorDepthField(input: DepthFieldPriorInput): DepthFieldData {
  const width = Math.max(1, Math.round(input.stageSize.width));
  const height = Math.max(1, Math.round(input.stageSize.height));
  const depth = new Float32Array(width * height);
  const threshold = input.threshold ?? defaultMaskThreshold;
  const blurPasses = Math.max(0, Math.round(input.blurPasses ?? defaultBlurPasses));
  const binary = rasterizeMaskToStage(input.mask, width, height, input.placementRect, threshold);
  const distance = computeInteriorDistance(binary, width, height);

  let maxDistance = 0;
  for (let i = 0; i < distance.length; i += 1) {
    if (binary[i] === 0 || !Number.isFinite(distance[i])) {
      continue;
    }
    maxDistance = Math.max(maxDistance, distance[i]);
  }

  if (maxDistance <= 0) {
    return { width, height, depth };
  }

  for (let i = 0; i < depth.length; i += 1) {
    if (binary[i] === 0) {
      continue;
    }
    const normalizedDistance = clamp(distance[i] / maxDistance, 0, 1);
    depth[i] = Math.pow(normalizedDistance, 0.72);
  }

  if (blurPasses > 0) {
    blurDepthInPlace(depth, width, height, blurPasses);
  }

  // WHY: ONNX 深度过平时使用 mask 距离场生成通用曲率先验，保证任何人体区域都有稳定体积趋势。
  // TRADE-OFF: 它不携带细节解剖信息，但能显著降低“完全平贴”风险并保持通用性。
  return { width, height, depth };
}

export function fuseDepthWithMaskPrior(input: DepthFieldFuseInput): { depthField: DepthFieldData; onnxWeight: number } {
  if (!isDepthShapeEqual(input.onnxDepthField, input.priorDepthField)) {
    return {
      depthField: input.onnxDepthField,
      onnxWeight: 1,
    };
  }

  const onnxWeight = clamp(0.35 + input.qualityScore * 0.55, 0.35, 0.9);
  const priorWeight = 1 - onnxWeight;
  const output = new Float32Array(input.onnxDepthField.depth.length);

  for (let i = 0; i < output.length; i += 1) {
    output[i] = input.onnxDepthField.depth[i] * onnxWeight + input.priorDepthField.depth[i] * priorWeight;
  }

  return {
    depthField: {
      width: input.onnxDepthField.width,
      height: input.onnxDepthField.height,
      depth: output,
    },
    onnxWeight,
  };
}

function rasterizeMaskToStage(
  mask: SkinMask,
  stageWidth: number,
  stageHeight: number,
  placementRect: Rect,
  threshold: number,
): Uint8Array {
  const binary = new Uint8Array(stageWidth * stageHeight);
  const startX = clampInt(Math.floor(placementRect.x), 0, stageWidth - 1);
  const startY = clampInt(Math.floor(placementRect.y), 0, stageHeight - 1);
  const endX = clampInt(Math.ceil(placementRect.x + placementRect.width), 0, stageWidth);
  const endY = clampInt(Math.ceil(placementRect.y + placementRect.height), 0, stageHeight);
  if (placementRect.width <= 0 || placementRect.height <= 0 || endX <= startX || endY <= startY) {
    return binary;
  }

  const safeMaskWidth = Math.max(mask.width, 1);
  const safeMaskHeight = Math.max(mask.height, 1);
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const normalizedX = (x + 0.5 - placementRect.x) / placementRect.width;
      const normalizedY = (y + 0.5 - placementRect.y) / placementRect.height;
      const maskX = clampInt(Math.floor(normalizedX * safeMaskWidth), 0, safeMaskWidth - 1);
      const maskY = clampInt(Math.floor(normalizedY * safeMaskHeight), 0, safeMaskHeight - 1);
      const maskIndex = maskY * safeMaskWidth + maskX;
      if (mask.probabilities[maskIndex] >= threshold) {
        binary[y * stageWidth + x] = 1;
      }
    }
  }

  return binary;
}

function computeInteriorDistance(binary: Uint8Array, width: number, height: number): Float32Array {
  const distance = new Float32Array(binary.length);
  distance.fill(infinityDistance);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (binary[index] === 0 || isBoundaryPixel(binary, width, height, x, y)) {
        distance[index] = 0;
      }
    }
  }

  const forwardOffsets = [
    [-1, 0, 1],
    [0, -1, 1],
    [-1, -1, Math.SQRT2],
    [1, -1, Math.SQRT2],
  ] as const;
  const backwardOffsets = [
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
  ] as const;

  scanDistance(binary, distance, width, height, forwardOffsets, 0, height, 1, 0, width, 1);
  scanDistance(binary, distance, width, height, backwardOffsets, height - 1, -1, -1, width - 1, -1, -1);
  return distance;
}

function scanDistance(
  binary: Uint8Array,
  distance: Float32Array,
  width: number,
  height: number,
  offsets: ReadonlyArray<readonly [number, number, number]>,
  startY: number,
  endYExclusive: number,
  stepY: number,
  startX: number,
  endXExclusive: number,
  stepX: number,
): void {
  for (let y = startY; y !== endYExclusive; y += stepY) {
    for (let x = startX; x !== endXExclusive; x += stepX) {
      const index = y * width + x;
      if (binary[index] === 0) {
        continue;
      }

      let best = distance[index];
      for (const [offsetX, offsetY, cost] of offsets) {
        const nx = x + offsetX;
        const ny = y + offsetY;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }

        const neighborIndex = ny * width + nx;
        if (binary[neighborIndex] === 0) {
          continue;
        }
        best = Math.min(best, distance[neighborIndex] + cost);
      }

      distance[index] = best;
    }
  }
}

function blurDepthInPlace(depth: Float32Array, width: number, height: number, passes: number): void {
  const temp = new Float32Array(depth.length);
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const left = x > 0 ? depth[index - 1] : depth[index];
        const right = x < width - 1 ? depth[index + 1] : depth[index];
        const top = y > 0 ? depth[index - width] : depth[index];
        const bottom = y < height - 1 ? depth[index + width] : depth[index];
        temp[index] = (left + right + top + bottom + depth[index] * 2) / 6;
      }
    }
    depth.set(temp);
  }
}

function isBoundaryPixel(binary: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  if (binary[y * width + x] === 0) {
    return false;
  }

  const neighbors = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ] as const;
  for (const [nx, ny] of neighbors) {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
      return true;
    }
    if (binary[ny * width + nx] === 0) {
      return true;
    }
  }

  return false;
}

function isDepthShapeEqual(left: DepthFieldData, right: DepthFieldData): boolean {
  return left.width === right.width
    && left.height === right.height
    && left.depth.length === right.depth.length;
}

function rgbToLuma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function requiredContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }
  return context;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}
