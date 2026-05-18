import type { BinaryMask, SkinMask, SkinMaskProcessOptions } from "./types";

interface NormalizedMorphologyOptions {
  enabled: boolean;
  kernelSize: number;
  openIterations: number;
  closeIterations: number;
}

interface NormalizedSkinMaskProcessOptions {
  threshold: number;
  morphology: NormalizedMorphologyOptions;
  minComponentArea: number;
  keepLargestComponent: boolean;
}

const defaultOptions: NormalizedSkinMaskProcessOptions = {
  threshold: 0.55,
  morphology: {
    enabled: true,
    kernelSize: 3,
    openIterations: 1,
    closeIterations: 1,
  },
  minComponentArea: 32,
  keepLargestComponent: true,
};

export function postProcessSkinMask(
  mask: SkinMask,
  options?: SkinMaskProcessOptions,
): BinaryMask {
  validateMask(mask);
  const normalized = normalizeOptions(options);
  const thresholded = thresholdMask(mask, normalized.threshold);
  const morphed = normalized.morphology.enabled
    ? applyMorphology(thresholded, normalized.morphology)
    : thresholded;

  return removeSmallComponents(morphed, normalized.minComponentArea, normalized.keepLargestComponent);
}

function validateMask(mask: SkinMask): void {
  const expectedLength = mask.width * mask.height;
  if (mask.width <= 0 || mask.height <= 0 || expectedLength !== mask.probabilities.length) {
    throw new Error("Invalid skin mask dimensions or probability buffer length.");
  }
}

function normalizeOptions(options?: SkinMaskProcessOptions): NormalizedSkinMaskProcessOptions {
  const mergedMorphology = {
    ...defaultOptions.morphology,
    ...(options?.morphology ?? {}),
  };

  return {
    ...defaultOptions,
    ...options,
    threshold: clamp(options?.threshold ?? defaultOptions.threshold, 0, 1),
    minComponentArea: Math.max(1, Math.round(options?.minComponentArea ?? defaultOptions.minComponentArea)),
    morphology: {
      enabled: mergedMorphology.enabled ?? defaultOptions.morphology.enabled,
      kernelSize: normalizeKernelSize(mergedMorphology.kernelSize),
      openIterations: normalizeIteration(mergedMorphology.openIterations),
      closeIterations: normalizeIteration(mergedMorphology.closeIterations),
    },
    keepLargestComponent: options?.keepLargestComponent ?? defaultOptions.keepLargestComponent,
  };
}

function thresholdMask(mask: SkinMask, threshold: number): BinaryMask {
  const data = new Uint8Array(mask.probabilities.length);

  for (let i = 0; i < mask.probabilities.length; i += 1) {
    data[i] = mask.probabilities[i] >= threshold ? 1 : 0;
  }

  return { width: mask.width, height: mask.height, data };
}

function applyMorphology(
  mask: BinaryMask,
  morphology: NormalizedMorphologyOptions,
): BinaryMask {
  let current = mask.data;

  for (let i = 0; i < morphology.openIterations; i += 1) {
    current = dilateBinary(erodeBinary(current, mask.width, mask.height, morphology.kernelSize), mask.width, mask.height, morphology.kernelSize);
  }

  for (let i = 0; i < morphology.closeIterations; i += 1) {
    current = erodeBinary(dilateBinary(current, mask.width, mask.height, morphology.kernelSize), mask.width, mask.height, morphology.kernelSize);
  }

  return { width: mask.width, height: mask.height, data: current };
}

function erodeBinary(data: Uint8Array, width: number, height: number, kernelSize: number): Uint8Array {
  const output = new Uint8Array(data.length);
  const radius = Math.floor(kernelSize / 2);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let allOnes = true;
      for (let ky = -radius; ky <= radius && allOnes; ky += 1) {
        for (let kx = -radius; kx <= radius; kx += 1) {
          const nx = x + kx;
          const ny = y + ky;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || data[ny * width + nx] === 0) {
            allOnes = false;
            break;
          }
        }
      }
      output[y * width + x] = allOnes ? 1 : 0;
    }
  }

  return output;
}

function dilateBinary(data: Uint8Array, width: number, height: number, kernelSize: number): Uint8Array {
  const output = new Uint8Array(data.length);
  const radius = Math.floor(kernelSize / 2);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let hasOne = false;
      for (let ky = -radius; ky <= radius && !hasOne; ky += 1) {
        for (let kx = -radius; kx <= radius; kx += 1) {
          const nx = x + kx;
          const ny = y + ky;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && data[ny * width + nx] === 1) {
            hasOne = true;
            break;
          }
        }
      }
      output[y * width + x] = hasOne ? 1 : 0;
    }
  }

  return output;
}

interface Component {
  size: number;
  indices: number[];
}

function removeSmallComponents(mask: BinaryMask, minArea: number, keepLargest: boolean): BinaryMask {
  const components = collectComponents(mask.data, mask.width, mask.height);
  if (components.length === 0) {
    return mask;
  }

  const output = new Uint8Array(mask.data.length);
  const largest = findLargestComponent(components);

  for (const component of components) {
    const keepByLargest = keepLargest ? component === largest : true;
    const keepByArea = component.size >= minArea;
    if (!keepByLargest || !keepByArea) {
      continue;
    }

    for (const index of component.indices) {
      output[index] = 1;
    }
  }

  return { width: mask.width, height: mask.height, data: output };
}

function collectComponents(data: Uint8Array, width: number, height: number): Component[] {
  const visited = new Uint8Array(data.length);
  const components: Component[] = [];

  for (let index = 0; index < data.length; index += 1) {
    if (data[index] === 0 || visited[index] === 1) {
      continue;
    }

    const stack = [index];
    const indices: number[] = [];
    visited[index] = 1;

    // WHY: 4 邻域避免对角线误连通，边界会更稳；TRADE-OFF: 对斜向细桥接更保守，可能切断极细连接。
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) {
        break;
      }

      indices.push(current);
      const x = current % width;
      const y = Math.floor(current / width);

      pushNeighbor(data, visited, stack, x - 1, y, width, height);
      pushNeighbor(data, visited, stack, x + 1, y, width, height);
      pushNeighbor(data, visited, stack, x, y - 1, width, height);
      pushNeighbor(data, visited, stack, x, y + 1, width, height);
    }

    components.push({ size: indices.length, indices });
  }

  return components;
}

function pushNeighbor(
  data: Uint8Array,
  visited: Uint8Array,
  stack: number[],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  const index = y * width + x;
  if (data[index] === 0 || visited[index] === 1) {
    return;
  }
  visited[index] = 1;
  stack.push(index);
}

function findLargestComponent(components: Component[]): Component {
  let largest = components[0];

  for (let i = 1; i < components.length; i += 1) {
    if (components[i].size > largest.size) {
      largest = components[i];
    }
  }

  return largest;
}

function normalizeKernelSize(value: number | undefined): number {
  const safe = Math.max(1, Math.round(value ?? defaultOptions.morphology.kernelSize ?? 3));
  return safe % 2 === 0 ? safe + 1 : safe;
}

function normalizeIteration(value: number | undefined): number {
  return Math.max(0, Math.round(value ?? 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
