import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import type { SkinMask } from "./types";

export interface SkinSegmentationConfig {
  wasmPath: string;
  modelPath: string;
  delegate: "CPU" | "GPU";
}

export const DEFAULT_SKIN_SEGMENTATION_WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

export const DEFAULT_SKIN_SEGMENTATION_MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

export const defaultSkinSegmentationConfig: SkinSegmentationConfig = {
  wasmPath: DEFAULT_SKIN_SEGMENTATION_WASM_PATH,
  modelPath: DEFAULT_SKIN_SEGMENTATION_MODEL_PATH,
  delegate: "CPU",
};

interface MaskLike {
  width: number;
  height: number;
  getAsFloat32Array(): Float32Array;
  getAsUint8Array(): Uint8Array;
  close?(): void;
}

interface SegmentResultLike {
  confidenceMasks?: MaskLike[];
  categoryMask?: MaskLike;
  close?(): void;
}

interface SegmenterLike {
  segment(image: TexImageSource): SegmentResultLike;
  getLabels(): string[] | null | undefined;
}

interface SkinSegmentationDependencies {
  createVisionFileset(wasmPath: string): Promise<unknown>;
  createSegmenter(visionFileset: unknown, config: SkinSegmentationConfig): Promise<SegmenterLike>;
}

export interface SkinSegmentationService {
  segmentSkinFromImageSource(image: TexImageSource): Promise<SkinMask>;
}

const defaultDependencies: SkinSegmentationDependencies = {
  createVisionFileset(wasmPath) {
    return FilesetResolver.forVisionTasks(wasmPath);
  },
  createSegmenter(visionFileset, config) {
    return ImageSegmenter.createFromOptions(visionFileset as never, {
      baseOptions: {
        modelAssetPath: config.modelPath,
        delegate: config.delegate,
      },
      runningMode: "IMAGE",
      outputConfidenceMasks: true,
      outputCategoryMask: true,
    });
  },
};

const skinLabelHints = ["skin", "face", "body", "person", "human", "hand", "arm"];
const backgroundLabelHints = ["background", "bg"];

export function createSkinSegmentationService(
  dependencies: SkinSegmentationDependencies = defaultDependencies,
  config: SkinSegmentationConfig = defaultSkinSegmentationConfig,
): SkinSegmentationService {
  let segmenterPromise: Promise<SegmenterLike> | null = null;

  const loadSegmenter = async (): Promise<SegmenterLike> => {
    if (!segmenterPromise) {
      segmenterPromise = dependencies.createVisionFileset(config.wasmPath)
        .then((visionFileset) => dependencies.createSegmenter(visionFileset, config))
        .catch((error) => {
          segmenterPromise = null;
          throw error;
        });
    }

    return segmenterPromise;
  };

  return {
    async segmentSkinFromImageSource(image: TexImageSource): Promise<SkinMask> {
      const segmenter = await loadSegmenter();
      const result = segmenter.segment(image);

      try {
        return mapSegmenterResultToSkinMask(result, normalizeSegmenterLabels(segmenter.getLabels()));
      } finally {
        closeSegmentResultSafely(result);
      }
    },
  };
}

const defaultSkinSegmentationService = createSkinSegmentationService();

export async function segmentSkinFromImageSource(image: TexImageSource): Promise<SkinMask> {
  return defaultSkinSegmentationService.segmentSkinFromImageSource(image);
}

function mapSegmenterResultToSkinMask(result: SegmentResultLike, labels: string[]): SkinMask {
  const confidenceMasks = result.confidenceMasks;

  if (confidenceMasks && confidenceMasks.length > 0) {
    const maskIndex = pickSkinLikeMaskIndex(confidenceMasks, labels);
    const selectedMask = confidenceMasks[maskIndex];
    const probabilities = new Float32Array(selectedMask.getAsFloat32Array());

    return {
      width: selectedMask.width,
      height: selectedMask.height,
      probabilities,
    };
  }

  if (!result.categoryMask) {
    throw new Error("MediaPipe segmentation returned no confidence/category masks.");
  }

  return mapCategoryMaskToSkinMask(result.categoryMask, labels);
}

function normalizeSegmenterLabels(labels: string[] | null | undefined): string[] {
  // WHY: MediaPipe 类型声明写的是 string[]，但浏览器运行时在部分模型/加载状态下会返回 null。
  // TRADE-OFF: 缺失标签时退回覆盖率启发式，精度略低，但 Apply Body 不会被第三方元数据异常阻断。
  return Array.isArray(labels) ? labels : [];
}

function pickSkinLikeMaskIndex(confidenceMasks: MaskLike[], labels: string[]): number {
  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let index = 0; index < confidenceMasks.length; index += 1) {
    const probabilities = confidenceMasks[index].getAsFloat32Array();
    const label = labels[index] ?? "";
    const score = computeSkinLikelihoodScore(probabilities, label, index, confidenceMasks.length);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function computeSkinLikelihoodScore(
  probabilities: Float32Array,
  label: string,
  index: number,
  totalMasks: number,
): number {
  const normalizedLabel = label.toLowerCase();
  let confidenceSum = 0;
  let strongPixelCount = 0;

  for (let i = 0; i < probabilities.length; i += 1) {
    const value = probabilities[i];
    confidenceSum += value;
    if (value > 0.6) {
      strongPixelCount += 1;
    }
  }

  const meanConfidence = probabilities.length > 0 ? confidenceSum / probabilities.length : 0;
  const strongCoverage = probabilities.length > 0 ? strongPixelCount / probabilities.length : 0;
  const labelBoost = skinLabelHints.some((hint) => normalizedLabel.includes(hint)) ? 1 : 0;
  const backgroundPenalty = backgroundLabelHints.some((hint) => normalizedLabel.includes(hint)) ? 1 : 0;
  const isLikelyBackgroundSlot = index === 0 && totalMasks > 1 ? 1 : 0;

  // WHY: 线上模型标签可能缺失或被改名，不能只依赖“固定索引”；这里组合标签命中+覆盖率做鲁棒选择。
  // TRADE-OFF: 启发式在特殊服饰/肤色场景可能误选，但比硬编码单一 class index 的回归风险更低。
  return (
    meanConfidence * 1.8 +
    strongCoverage * 1.2 +
    labelBoost * 1.5 -
    backgroundPenalty * 2.5 -
    isLikelyBackgroundSlot * 0.4
  );
}

function mapCategoryMaskToSkinMask(categoryMask: MaskLike, labels: string[]): SkinMask {
  const categoryIndex = pickSkinCategoryIndex(labels);
  const categoryValues = categoryMask.getAsUint8Array();
  const probabilities = new Float32Array(categoryValues.length);

  for (let i = 0; i < categoryValues.length; i += 1) {
    probabilities[i] = categoryValues[i] === categoryIndex ? 1 : 0;
  }

  return {
    width: categoryMask.width,
    height: categoryMask.height,
    probabilities,
  };
}

function pickSkinCategoryIndex(labels: string[]): number {
  let bestIndex = -1;
  let bestScore = -Infinity;

  for (let index = 0; index < labels.length; index += 1) {
    const normalized = labels[index].toLowerCase();
    const score = computeSkinCategoryLabelScore(normalized);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  if (bestIndex >= 0 && bestScore > 0) {
    return bestIndex;
  }

  return labels.length > 1 ? 1 : 0;
}

function computeSkinCategoryLabelScore(label: string): number {
  let score = 0;

  if (label.includes("face")) {
    score += 3.5;
  }
  if (label.includes("body")) {
    score += 2.5;
  }
  if (label.includes("skin")) {
    score += 1.5;
  }
  if (label.includes("person") || label.includes("human")) {
    score += 1.2;
  }
  if (backgroundLabelHints.some((hint) => label.includes(hint))) {
    score -= 4;
  }

  return score;
}

function closeSegmentResultSafely(result: SegmentResultLike): void {
  closeResourceSafely(() => result.close?.(), "segmenter result");

  for (const [index, mask] of (result.confidenceMasks ?? []).entries()) {
    closeResourceSafely(() => mask.close?.(), `confidence mask #${index}`);
  }

  closeResourceSafely(() => result.categoryMask?.close?.(), "category mask");
}

function closeResourceSafely(close: () => void, resourceName: string): void {
  try {
    close();
  } catch (error) {
    // WHY: 分割主路径成功后，资源释放失败不应反向污染结果返回；只记录告警，避免影响 Apply 体验。
    // TRADE-OFF: 可能掩盖偶发资源管理问题，因此保留带上下文的 warning 便于后续排查。
    console.warn(`MediaPipe resource cleanup failed: ${resourceName}`, error);
  }
}
