import type { DepthFieldData, Rect, Size, SkinMask, SurfaceFieldData } from "./types";

const insideThreshold = 0.4;
const defaultNormalStrength = 1.65;
const defaultBlurPasses = 2;
const defaultDepthBlendWeight = 0.75;
const infinityDistance = 1e6;
const flatNormalRgb = { r: 128, g: 128, b: 255 };

export interface SurfaceFieldBuildOptions {
  threshold?: number;
  normalStrength?: number;
  blurPasses?: number;
  depthBlendWeight?: number;
}

export interface SurfaceFieldBuildInput {
  mask: SkinMask;
  stageSize: Size;
  placementRect: Rect;
  depthField?: DepthFieldData | null;
  options?: SurfaceFieldBuildOptions;
}

export function buildSurfaceFieldFromSkinMask(
  input: SurfaceFieldBuildInput,
): SurfaceFieldData {
  const width = Math.max(1, Math.round(input.stageSize.width));
  const height = Math.max(1, Math.round(input.stageSize.height));
  const threshold = input.options?.threshold ?? insideThreshold;
  const normalStrength = Math.max(0, input.options?.normalStrength ?? defaultNormalStrength);
  const blurPasses = Math.max(0, Math.round(input.options?.blurPasses ?? defaultBlurPasses));
  const depthBlendWeight = clamp(input.options?.depthBlendWeight ?? defaultDepthBlendWeight, 0, 1);
  const binary = rasterizeMaskToStage(input.mask, width, height, input.placementRect, threshold);
  const distance = computeInteriorDistance(binary, width, height);
  const heightField = normalizeHeightField(distance, binary);
  const smoothHeightField = blurHeightField(heightField, binary, width, height, blurPasses);
  const fusedHeightField = mergeDepthHeightField(
    smoothHeightField,
    binary,
    width,
    height,
    input.depthField ?? null,
    depthBlendWeight,
  );
  return encodeNormalTexture(fusedHeightField, binary, width, height, normalStrength);
}

function mergeDepthHeightField(
  base: Float32Array,
  binary: Uint8Array,
  width: number,
  height: number,
  depthField: DepthFieldData | null,
  depthBlendWeight: number,
): Float32Array {
  if (!depthField || depthBlendWeight <= 0) {
    return base;
  }
  if (depthField.width !== width || depthField.height !== height || depthField.depth.length !== base.length) {
    return base;
  }

  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < depthField.depth.length; i += 1) {
    if (binary[i] === 0 || !Number.isFinite(depthField.depth[i])) {
      continue;
    }
    minDepth = Math.min(minDepth, depthField.depth[i]);
    maxDepth = Math.max(maxDepth, depthField.depth[i]);
  }
  if (!Number.isFinite(minDepth) || !Number.isFinite(maxDepth) || maxDepth - minDepth < 1e-6) {
    return base;
  }

  const span = maxDepth - minDepth;
  const output = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 1) {
    if (binary[i] === 0) {
      output[i] = 0;
      continue;
    }
    const normalizedDepth = clamp((depthField.depth[i] - minDepth) / span, 0, 1);
    output[i] = base[i] * (1 - depthBlendWeight) + normalizedDepth * depthBlendWeight;
  }

  // WHY: depth 与 mask 距离场融合，可把仅依赖轮廓的法线提升为更接近人体明暗结构的体积起伏。
  // TRADE-OFF: depth 估计噪声会轻微影响局部细节，但整体贴合感显著好于纯 mask 法线。
  return blurHeightField(output, binary, width, height, 1);
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
      const stageIndex = y * stageWidth + x;
      binary[stageIndex] = mask.probabilities[maskIndex] >= threshold ? 1 : 0;
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

function normalizeHeightField(distance: Float32Array, binary: Uint8Array): Float32Array {
  const heightField = new Float32Array(distance.length);
  let maxDistance = 0;

  for (let i = 0; i < distance.length; i += 1) {
    if (binary[i] === 0 || !Number.isFinite(distance[i])) {
      continue;
    }
    maxDistance = Math.max(maxDistance, distance[i]);
  }

  if (maxDistance <= 0) {
    return heightField;
  }

  for (let i = 0; i < distance.length; i += 1) {
    if (binary[i] === 1) {
      heightField[i] = distance[i] / maxDistance;
    }
  }

  return heightField;
}

function blurHeightField(
  source: Float32Array,
  binary: Uint8Array,
  width: number,
  height: number,
  passes: number,
): Float32Array {
  if (passes <= 0) {
    return source;
  }

  let horizontal = new Float32Array(source);
  let vertical = new Float32Array(source.length);

  for (let pass = 0; pass < passes; pass += 1) {
    horizontalBlur(horizontal, vertical, binary, width, height);
    verticalBlur(vertical, horizontal, binary, width, height);
  }

  return horizontal;
}

function horizontalBlur(
  source: Float32Array,
  output: Float32Array,
  binary: Uint8Array,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (binary[index] === 0) {
        output[index] = 0;
        continue;
      }

      const left = x > 0 ? source[index - 1] : source[index];
      const center = source[index];
      const right = x < width - 1 ? source[index + 1] : source[index];
      output[index] = (left + center * 2 + right) * 0.25;
    }
  }
}

function verticalBlur(
  source: Float32Array,
  output: Float32Array,
  binary: Uint8Array,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (binary[index] === 0) {
        output[index] = 0;
        continue;
      }

      const top = y > 0 ? source[index - width] : source[index];
      const center = source[index];
      const bottom = y < height - 1 ? source[index + width] : source[index];
      output[index] = (top + center * 2 + bottom) * 0.25;
    }
  }
}

function encodeNormalTexture(
  heightField: Float32Array,
  binary: Uint8Array,
  width: number,
  height: number,
  normalStrength: number,
): SurfaceFieldData {
  const normalRgba = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const rgbaIndex = index * 4;
      if (binary[index] === 0) {
        normalRgba[rgbaIndex] = flatNormalRgb.r;
        normalRgba[rgbaIndex + 1] = flatNormalRgb.g;
        normalRgba[rgbaIndex + 2] = flatNormalRgb.b;
        normalRgba[rgbaIndex + 3] = 0;
        continue;
      }

      const left = x > 0 ? heightField[index - 1] : heightField[index];
      const right = x < width - 1 ? heightField[index + 1] : heightField[index];
      const top = y > 0 ? heightField[index - width] : heightField[index];
      const bottom = y < height - 1 ? heightField[index + width] : heightField[index];
      const dx = (right - left) * 0.5;
      const dy = (bottom - top) * 0.5;
      const normal = normalize3(-dx * normalStrength, -dy * normalStrength, 1);

      // WHY: 法线贴图编码沿用通用 tangent-space 约定，便于 shader 直接复用标准解码逻辑。
      // TRADE-OFF: 这是 2.5D 伪法线，不是严格 3D 重建，极端姿态下会更平滑但可显著提升体积观感。
      normalRgba[rgbaIndex] = encodeSignedNormal(normal.x);
      normalRgba[rgbaIndex + 1] = encodeSignedNormal(normal.y);
      normalRgba[rgbaIndex + 2] = encodeSignedNormal(normal.z);
      normalRgba[rgbaIndex + 3] = 255;
    }
  }

  return {
    width,
    height,
    normalRgba,
  };
}

function encodeSignedNormal(value: number): number {
  return Math.round((clamp(value, -1, 1) * 0.5 + 0.5) * 255);
}

function normalize3(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length < 1e-6) {
    return { x: 0, y: 0, z: 1 };
  }

  return {
    x: x / length,
    y: y / length,
    z: z / length,
  };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}
