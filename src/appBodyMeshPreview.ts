import {
  buildSkinMeshFromMask,
  createSkinMeshPipelineOptionsFromBodyParams,
} from "./domain/skinMeshPipeline";
import { segmentSkinFromImageSource } from "./domain/skinSegmentation";
import { createSkinMaskFromCanvasAlpha } from "./image/skinMaskAdapter";
import type {
  BodyMeshPipelineParams,
  Rect,
  Size,
  SkinMask,
  SkinMeshData,
} from "./domain/types";

const skinMeshMaxEdge = 1024;

interface SkinMaskAdapters {
  segmentSkinFromImageSource(image: TexImageSource): Promise<SkinMask>;
  createSkinMaskFromCanvasAlpha(canvas: HTMLCanvasElement): SkinMask;
}

interface BodyMeshPreviewSession {
  sourceCanvas: HTMLCanvasElement;
  workingCanvas: HTMLCanvasElement;
  mask: SkinMask;
}

type BodyMeshPreviewBuilder = (
  sourceCanvas: HTMLCanvasElement,
  params: BodyMeshPipelineParams,
) => Promise<{ mask: SkinMask; mesh: SkinMeshData; warning?: string }>;

const defaultSkinMaskAdapters: SkinMaskAdapters = {
  segmentSkinFromImageSource,
  createSkinMaskFromCanvasAlpha,
};

export function normalizeSkinMeshImageSize(size: Size): Size {
  const longEdge = Math.max(size.width, size.height);
  if (longEdge <= skinMeshMaxEdge) {
    return { width: size.width, height: size.height };
  }

  const scale = skinMeshMaxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

export async function buildBodyMeshPreview(
  sourceCanvas: HTMLCanvasElement,
  params: BodyMeshPipelineParams,
): Promise<{ mask: SkinMask; mesh: SkinMeshData; warning?: string }> {
  const session = await createBodyMeshPreviewSession(sourceCanvas);
  return buildBodyMeshPreviewFromSession(session, params);
}

export function createBodyMeshPreviewBuilder(
  createSession: (sourceCanvas: HTMLCanvasElement) => Promise<BodyMeshPreviewSession> = createBodyMeshPreviewSession,
): BodyMeshPreviewBuilder {
  let activeSource: HTMLCanvasElement | null = null;
  let activeSessionPromise: Promise<BodyMeshPreviewSession> | null = null;

  return async (sourceCanvas: HTMLCanvasElement, params: BodyMeshPipelineParams) => {
    if (activeSource !== sourceCanvas || !activeSessionPromise) {
      activeSource = sourceCanvas;
      activeSessionPromise = createSession(sourceCanvas);
    }

    try {
      const session = await activeSessionPromise;
      return buildBodyMeshPreviewFromSession(session, params);
    } catch (error) {
      // WHY: segmentation 首次失败后清空缓存，避免后续调参永远复用失败 promise。
      // TRADE-OFF: 失败后下一次会触发新的 segmentation，但用户可以继续恢复流程。
      if (activeSource === sourceCanvas) {
        activeSessionPromise = null;
      }
      throw error;
    }
  };
}

export async function createSkinMaskWithFallback(
  canvas: HTMLCanvasElement,
  adapters: SkinMaskAdapters = defaultSkinMaskAdapters,
): Promise<SkinMask> {
  try {
    return await adapters.segmentSkinFromImageSource(canvas);
  } catch (segmentationError) {
    console.warn("MediaPipe segmentation failed, fallback to alpha mask.", segmentationError);

    try {
      return adapters.createSkinMaskFromCanvasAlpha(canvas);
    } catch (alphaError) {
      console.warn("Alpha mask extraction failed, fallback to full-image mask.", alphaError);

      // WHY: 两级回退都失败时仍返回 full-image mask，保证 Apply Body 主流程可继续。
      // TRADE-OFF: 结果精度最低，但能避免用户因依赖异常被完全阻塞。
      return createFullImageMask(canvas.width, canvas.height);
    }
  }
}

export function mapSkinMeshToPlacementRect(
  mesh: SkinMeshData,
  sourceSize: Size,
  placementRect: Rect,
): SkinMeshData {
  if (sourceSize.width <= 0 || sourceSize.height <= 0) {
    return {
      positions: new Float32Array(mesh.positions),
      indices: new Uint32Array(mesh.indices),
      uvs: mesh.uvs ? new Float32Array(mesh.uvs) : undefined,
      boundaryFlags: mesh.boundaryFlags ? new Uint8Array(mesh.boundaryFlags) : undefined,
    };
  }

  const xScale = placementRect.width / sourceSize.width;
  const yScale = placementRect.height / sourceSize.height;
  const mappedPositions = new Float32Array(mesh.positions.length);

  for (let i = 0; i < mesh.positions.length; i += 2) {
    mappedPositions[i] = placementRect.x + mesh.positions[i] * xScale;
    mappedPositions[i + 1] = placementRect.y + mesh.positions[i + 1] * yScale;
  }

  return {
    positions: mappedPositions,
    indices: new Uint32Array(mesh.indices),
    uvs: mesh.uvs ? new Float32Array(mesh.uvs) : undefined,
    boundaryFlags: mesh.boundaryFlags ? new Uint8Array(mesh.boundaryFlags) : undefined,
  };
}

export function computeContainPlacementRect(sourceSize: Size, containerSize: Size): Rect {
  if (sourceSize.width <= 0 || sourceSize.height <= 0) {
    return {
      x: 0,
      y: 0,
      width: containerSize.width,
      height: containerSize.height,
    };
  }

  const scale = Math.min(containerSize.width / sourceSize.width, containerSize.height / sourceSize.height);
  const width = sourceSize.width * scale;
  const height = sourceSize.height * scale;

  return {
    x: (containerSize.width - width) * 0.5,
    y: (containerSize.height - height) * 0.5,
    width,
    height,
  };
}

async function createBodyMeshPreviewSession(
  sourceCanvas: HTMLCanvasElement,
): Promise<BodyMeshPreviewSession> {
  const workingCanvas = resizeCanvasForSkinMesh(sourceCanvas);
  const mask = await createSkinMaskWithFallback(workingCanvas);
  return { sourceCanvas, workingCanvas, mask };
}

function buildBodyMeshPreviewFromSession(
  session: BodyMeshPreviewSession,
  params: BodyMeshPipelineParams,
): { mask: SkinMask; mesh: SkinMeshData; warning?: string } {
  const options = createSkinMeshPipelineOptionsFromBodyParams(params);

  try {
    const workingMesh = buildSkinMeshFromMask(session.mask, options);

    if (
      session.workingCanvas.width === session.sourceCanvas.width &&
      session.workingCanvas.height === session.sourceCanvas.height
    ) {
      return { mask: session.mask, mesh: workingMesh };
    }

    const scaledMesh = scaleMesh(
      workingMesh,
      session.sourceCanvas.width / session.workingCanvas.width,
      session.sourceCanvas.height / session.workingCanvas.height,
    );

    return { mask: session.mask, mesh: scaledMesh };
  } catch (error) {
    return {
      mask: session.mask,
      mesh: createRectangleMesh(
        { width: session.sourceCanvas.width, height: session.sourceCanvas.height },
        { width: session.sourceCanvas.width, height: session.sourceCanvas.height },
      ),
      warning: `mesh rebuild failed: ${getErrorMessage(error)}`,
    };
  }
}

function resizeCanvasForSkinMesh(source: HTMLCanvasElement): HTMLCanvasElement {
  const normalized = normalizeSkinMeshImageSize({ width: source.width, height: source.height });
  if (normalized.width === source.width && normalized.height === source.height) {
    return source;
  }

  const canvas = document.createElement("canvas");
  canvas.width = normalized.width;
  canvas.height = normalized.height;
  const context = requiredContext(canvas);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function createFullImageMask(width: number, height: number): SkinMask {
  return {
    width,
    height,
    probabilities: new Float32Array(width * height).fill(1),
  };
}

function scaleMesh(mesh: SkinMeshData, scaleX: number, scaleY: number): SkinMeshData {
  const positions = new Float32Array(mesh.positions.length);

  for (let i = 0; i < mesh.positions.length; i += 2) {
    positions[i] = mesh.positions[i] * scaleX;
    positions[i + 1] = mesh.positions[i + 1] * scaleY;
  }

  return {
    positions,
    indices: new Uint32Array(mesh.indices),
    uvs: mesh.uvs ? new Float32Array(mesh.uvs) : undefined,
    boundaryFlags: mesh.boundaryFlags ? new Uint8Array(mesh.boundaryFlags) : undefined,
  };
}

function createRectangleMesh(sourceSize: Size, targetSize: Size): SkinMeshData {
  const xScale = targetSize.width / sourceSize.width;
  const yScale = targetSize.height / sourceSize.height;

  return {
    positions: new Float32Array([
      0,
      0,
      sourceSize.width * xScale,
      0,
      sourceSize.width * xScale,
      sourceSize.height * yScale,
      0,
      sourceSize.height * yScale,
    ]),
    uvs: new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    boundaryFlags: new Uint8Array([1, 1, 1, 1]),
  };
}

function requiredContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }
  return context;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
