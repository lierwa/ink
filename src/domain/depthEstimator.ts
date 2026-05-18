import {
  estimateDepthFieldFromCanvas,
  estimateDepthFieldQuality,
  estimateMaskPriorDepthField,
  fuseDepthWithMaskPrior,
} from "./depthField";
import type { DepthFieldData, Rect, Size, SkinMask } from "./types";
import ortWasmMainUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import ortWasmMainMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";

interface OrtTensor {
  dims: readonly number[];
  data: Float32Array | number[] | Float64Array;
}

interface OrtSession {
  inputNames: string[];
  outputNames: string[];
  inputMetadata?: Record<string, { dimensions?: Array<number | string | null | undefined> }>;
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}

interface OrtApi {
  env?: {
    wasm?: {
      wasmPaths?: {
        wasm?: string | URL;
        mjs?: string | URL;
      } | string;
    };
  };
  InferenceSession: {
    create(
      modelUrl: string,
      options?: {
        executionProviders?: string[];
      },
    ): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: Float32Array, dims: readonly number[]) => unknown;
}

export interface DepthEstimateInput {
  sourceCanvas: HTMLCanvasElement;
  stageSize: Size;
  placementRect: Rect;
  mask: SkinMask;
}

export interface DepthEstimateResult {
  depthField: DepthFieldData;
  source: "onnx" | "luma";
  qualityScore: number;
  warning?: string;
}

export interface DepthFieldEstimator {
  estimate(input: DepthEstimateInput): Promise<DepthEstimateResult>;
}

interface DepthFieldEstimatorOptions {
  modelUrl?: string;
  runtimeLoader?: () => Promise<OrtApi>;
  modelProbe?: (modelUrl: string) => Promise<void>;
}

export const fallbackDepthModelUrl = "/models/depth-anything-v2-small.onnx";
const defaultModelSize = 518;
const imagenetMean = [0.485, 0.456, 0.406] as const;
const imagenetStd = [0.229, 0.224, 0.225] as const;

export function createDepthFieldEstimator(options?: DepthFieldEstimatorOptions): DepthFieldEstimator {
  const modelUrl = options?.modelUrl ?? fallbackDepthModelUrl;
  const runtimeLoader = options?.runtimeLoader ?? defaultOrtLoader;
  const modelProbe = options?.modelProbe ?? defaultModelProbe;
  let sessionPromise: Promise<OrtSession> | null = null;

  return {
    async estimate(input) {
      try {
        if (!sessionPromise) {
          sessionPromise = createSession(runtimeLoader, modelUrl, modelProbe).catch((error) => {
            sessionPromise = null;
            throw error;
          });
        }
        const session = await sessionPromise;
        const onnxDepthField = await estimateDepthFieldWithOnnx(input, session, runtimeLoader);
        const qualityScore = estimateDepthFieldQuality({
          depthField: onnxDepthField,
          placementRect: input.placementRect,
          mask: input.mask,
        });
        const priorDepthField = estimateMaskPriorDepthField({
          stageSize: input.stageSize,
          placementRect: input.placementRect,
          mask: input.mask,
          blurPasses: 1,
        });
        const fused = fuseDepthWithMaskPrior({
          onnxDepthField,
          priorDepthField,
          qualityScore,
        });
        return {
          depthField: fused.depthField,
          source: "onnx",
          qualityScore,
          warning: qualityScore < 0.22
            ? `onnx depth confidence low (${Math.round(qualityScore * 100)}%), blended with mask prior`
            : undefined,
        };
      } catch (error) {
        const fallback = estimateDepthFieldFromCanvas(input);
        const message = error instanceof Error ? error.message : "unknown error";
        return {
          depthField: fallback,
          source: "luma",
          qualityScore: 0,
          warning: `depth onnx fallback: ${message}`,
        };
      }
    },
  };
}

async function defaultOrtLoader(): Promise<OrtApi> {
  return import("onnxruntime-web") as unknown as Promise<OrtApi>;
}

async function createSession(
  loader: () => Promise<OrtApi>,
  modelUrl: string,
  modelProbe: (modelUrl: string) => Promise<void>,
): Promise<OrtSession> {
  await modelProbe(modelUrl);
  return createSessionWithRuntime(loader, modelUrl);
}

async function createSessionWithRuntime(loader: () => Promise<OrtApi>, modelUrl: string): Promise<OrtSession> {
  const ort = await loader();
  if (ort.env?.wasm) {
    ort.env.wasm.wasmPaths = {
      wasm: ortWasmMainUrl,
      mjs: ortWasmMainMjsUrl,
    };
  }
  return ort.InferenceSession.create(modelUrl, {
    executionProviders: ["wasm"],
  });
}

async function defaultModelProbe(modelUrl: string): Promise<void> {
  const response = await fetch(modelUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`model fetch failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 1024) {
    throw new Error(`model file too small: ${bytes.length} bytes`);
  }

  const headText = new TextDecoder("utf-8").decode(bytes.slice(0, 120)).trim().toLowerCase();
  if (
    contentType.includes("text/html")
    || headText.startsWith("<!doctype html")
    || headText.startsWith("<html")
  ) {
    throw new Error(`model URL returned HTML: ${modelUrl}`);
  }
}

async function estimateDepthFieldWithOnnx(
  input: DepthEstimateInput,
  session: OrtSession,
  runtimeLoader: () => Promise<OrtApi>,
): Promise<DepthFieldData> {
  const ort = await runtimeLoader();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    throw new Error("onnx session missing input/output names");
  }

  const { modelWidth, modelHeight } = resolveModelInputSize(session, inputName);
  const resized = resizeCanvas(input.sourceCanvas, modelWidth, modelHeight);
  const resizedContext = requiredContext(resized);
  const rgba = resizedContext.getImageData(0, 0, modelWidth, modelHeight).data;
  const chw = new Float32Array(modelWidth * modelHeight * 3);
  for (let y = 0; y < modelHeight; y += 1) {
    for (let x = 0; x < modelWidth; x += 1) {
      const pixelIndex = (y * modelWidth + x);
      const rgbaIndex = pixelIndex * 4;
      const red = rgba[rgbaIndex] / 255;
      const green = rgba[rgbaIndex + 1] / 255;
      const blue = rgba[rgbaIndex + 2] / 255;
      chw[pixelIndex] = (red - imagenetMean[0]) / imagenetStd[0];
      chw[modelWidth * modelHeight + pixelIndex] = (green - imagenetMean[1]) / imagenetStd[1];
      chw[modelWidth * modelHeight * 2 + pixelIndex] = (blue - imagenetMean[2]) / imagenetStd[2];
    }
  }

  const tensor = new ort.Tensor("float32", chw, [1, 3, modelHeight, modelWidth]);
  const feeds = { [inputName]: tensor };
  const outputs = await session.run(feeds);
  const output = outputs[outputName];
  if (!output) {
    throw new Error("onnx session returned empty depth output");
  }

  const depthMap = normalizeModelDepth(output.data, output.dims, modelWidth, modelHeight);
  return projectModelDepthToStage(depthMap, modelWidth, modelHeight, input);
}

function resolveModelInputSize(session: OrtSession, inputName: string): { modelWidth: number; modelHeight: number } {
  const inputDims = session.inputMetadata?.[inputName]?.dimensions;
  if (!inputDims || inputDims.length < 4) {
    return { modelWidth: defaultModelSize, modelHeight: defaultModelSize };
  }

  const maybeHeight = normalizeInputDim(inputDims[inputDims.length - 2]);
  const maybeWidth = normalizeInputDim(inputDims[inputDims.length - 1]);
  return {
    modelWidth: maybeWidth ?? defaultModelSize,
    modelHeight: maybeHeight ?? defaultModelSize,
  };
}

function normalizeModelDepth(
  output: Float32Array | number[] | Float64Array,
  dims: readonly number[],
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  const flattened = output instanceof Float32Array ? output : Float32Array.from(output);
  const mapWidth = dims.length >= 2 ? Number(dims[dims.length - 1]) || targetWidth : targetWidth;
  const mapHeight = dims.length >= 2 ? Number(dims[dims.length - 2]) || targetHeight : targetHeight;
  const sampleWidth = mapWidth > 0 ? mapWidth : targetWidth;
  const sampleHeight = mapHeight > 0 ? mapHeight : targetHeight;
  const rawDepth = new Float32Array(targetWidth * targetHeight);

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = (x / Math.max(targetWidth - 1, 1)) * (sampleWidth - 1);
      const sy = (y / Math.max(targetHeight - 1, 1)) * (sampleHeight - 1);
      rawDepth[y * targetWidth + x] = bilinearSample(flattened, sampleWidth, sampleHeight, sx, sy);
    }
  }

  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < rawDepth.length; i += 1) {
    minDepth = Math.min(minDepth, rawDepth[i]);
    maxDepth = Math.max(maxDepth, rawDepth[i]);
  }
  const span = maxDepth - minDepth;
  if (!Number.isFinite(span) || span < 1e-6) {
    return rawDepth;
  }

  for (let i = 0; i < rawDepth.length; i += 1) {
    rawDepth[i] = (rawDepth[i] - minDepth) / span;
  }
  return rawDepth;
}

function projectModelDepthToStage(
  modelDepth: Float32Array,
  modelWidth: number,
  modelHeight: number,
  input: DepthEstimateInput,
): DepthFieldData {
  const width = Math.max(1, Math.round(input.stageSize.width));
  const height = Math.max(1, Math.round(input.stageSize.height));
  const depth = new Float32Array(width * height);
  const safeMaskWidth = Math.max(input.mask.width, 1);
  const safeMaskHeight = Math.max(input.mask.height, 1);

  const startX = clampInt(Math.floor(input.placementRect.x), 0, width - 1);
  const startY = clampInt(Math.floor(input.placementRect.y), 0, height - 1);
  const endX = clampInt(Math.ceil(input.placementRect.x + input.placementRect.width), 0, width);
  const endY = clampInt(Math.ceil(input.placementRect.y + input.placementRect.height), 0, height);

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const normalizedX = (x + 0.5 - input.placementRect.x) / input.placementRect.width;
      const normalizedY = (y + 0.5 - input.placementRect.y) / input.placementRect.height;
      const maskX = clampInt(Math.floor(normalizedX * safeMaskWidth), 0, safeMaskWidth - 1);
      const maskY = clampInt(Math.floor(normalizedY * safeMaskHeight), 0, safeMaskHeight - 1);
      const maskIndex = maskY * safeMaskWidth + maskX;
      if (input.mask.probabilities[maskIndex] < 0.4) {
        continue;
      }

      const sampleX = clamp(normalizedX * (modelWidth - 1), 0, modelWidth - 1);
      const sampleY = clamp(normalizedY * (modelHeight - 1), 0, modelHeight - 1);
      depth[y * width + x] = bilinearSample(modelDepth, modelWidth, modelHeight, sampleX, sampleY);
    }
  }

  // WHY: ONNX 只负责估计 source 空间深度，最终仍需映射回 stage 坐标才能与贴图/mesh 共用同一渲染域。
  // TRADE-OFF: 多一次重采样会损失少量高频细节，但能保持变换链路一致并避免错位。
  return { width, height, depth };
}

function bilinearSample(buffer: Float32Array, width: number, height: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = buffer[y0 * width + x0] * (1 - tx) + buffer[y0 * width + x1] * tx;
  const bottom = buffer[y1 * width + x0] * (1 - tx) + buffer[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function resizeCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = requiredContext(canvas);
  context.drawImage(source, 0, 0, width, height);
  return canvas;
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

function normalizeInputDim(value: number | string | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.max(1, Math.round(value));
}
