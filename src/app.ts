import { Texture } from "pixi.js";
import { createFabricTattooController, type FabricTattooController } from "./editor/fabricController";
import { radiansToDegrees, degreesToRadians } from "./editorTransform";
import {
  createPixiTattooRenderer,
  type BodySurfaceRenderState,
  type PixiTattooRenderer,
} from "./render/pixiRenderer";
import { createAppMarkup, createCanvasMarkup } from "./appMarkup";
import { isSameTattooTransform } from "./appUploadQueue";
import { installUploadWorkflow } from "./appUploadWorkflow";
import {
  buildSkinMeshFromMask,
  createSkinMeshPipelineOptionsFromBodyParams,
  defaultBodyMeshPipelineParams,
} from "./domain/skinMeshPipeline";
import { segmentSkinFromImageSource } from "./domain/skinSegmentation";
import { createSkinMaskFromCanvasAlpha } from "./image/skinMaskAdapter";
import { meshResolution, sphere, stageSize } from "./sphereConfig";
import { buildSphereMesh } from "./domain/sphereMesh";
import { openBodyUploadModal } from "./editor/bodyUploadModal";
import type {
  BodyMeshPipelineParams,
  Rect,
  Size,
  SkinMask,
  SkinMeshData,
  TattooTransform,
} from "./domain/types";

const initialTransform: TattooTransform = {
  x: stageSize.width / 2,
  y: stageSize.height / 2,
  scale: 0.42,
  rotation: -0.18,
  opacity: 0.84,
};

interface BodySurfaceState {
  texture: Texture;
  placementRect: Rect;
  sourceSize: Size;
  mask: SkinMask;
  mesh: SkinMeshData;
  pipelineParams: BodyMeshPipelineParams;
  revision: number;
}

interface TattooAssetState {
  texture: Texture;
  size: Size;
  dataUrl: string;
}

interface AppState {
  tattooTransform: TattooTransform;
  tattooAsset: TattooAssetState | null;
  transformRevision: number;
  bodySurfaceState: BodySurfaceState;
}

interface AppElements {
  pixiLayer: HTMLDivElement;
  fabricLayer: HTMLCanvasElement;
  bodyUploadInput: HTMLInputElement;
  tattooUploadInput: HTMLInputElement;
  debugMeshInput: HTMLInputElement;
  opacityInput: HTMLInputElement;
  paramX: HTMLInputElement;
  paramY: HTMLInputElement;
  paramScale: HTMLInputElement;
  paramRotation: HTMLInputElement;
  paramOpacity: HTMLInputElement;
  resetButton: HTMLButtonElement;
  transformPanel: HTMLDivElement;
  statusLabel: HTMLDivElement;
}

type SetTattooTransform = (transform: TattooTransform, source: "fabric" | "panel" | "body-apply") => void;

export async function startApp(): Promise<void> {
  const elements = initializeAppShell();
  const defaultBodyCanvas = createDefaultBodyCanvas();
  const state = initializeAppState(defaultBodyCanvas);

  const pixi = await createPixiTattooRenderer({
    mount: elements.pixiLayer,
    stageSize,
    sphere,
    mesh: meshResolution,
  });

  let fabric: FabricTattooController;
  const setTransform = createTransformSetter(state, elements, pixi, () => fabric);

  fabric = await createFabricTattooController({
    canvas: elements.fabricLayer,
    stageSize,
    initialTransform,
    onTransformChange(transform) {
      setTransform(transform, "fabric");
    },
  });

  renderBodySurface(state, pixi);
  renderTattoo(state, pixi);
  syncPanelFromTransform(state, elements);

  installTransformControls(state, elements, setTransform);
  installUploadWorkflow({
    state,
    elements: {
      tattooUploadInput: elements.tattooUploadInput,
      statusLabel: elements.statusLabel,
    },
    fabric,
    initialTransform,
    renderTattoo: () => renderTattoo(state, pixi),
    syncPanelFromTransform: () => syncPanelFromTransform(state, elements),
  });
  installBodyUploadWorkflow(state, elements, pixi, setTransform);
  installDebugAndResetControls(elements, pixi, fabric, setTransform);

  void pixi.canvas;
}

function initializeAppShell(): AppElements {
  const root = document.querySelector<HTMLDivElement>("#app");

  if (!root) {
    throw new Error("Missing #app root.");
  }

  root.innerHTML = createAppMarkup(initialTransform);
  getElement<HTMLDivElement>("canvasFrame").innerHTML = createCanvasMarkup();
  return getAppElements();
}

function getAppElements(): AppElements {
  return {
    pixiLayer: getElement<HTMLDivElement>("pixiLayer"),
    fabricLayer: getElement<HTMLCanvasElement>("fabricLayer"),
    bodyUploadInput: getElement<HTMLInputElement>("bodyUpload"),
    tattooUploadInput: getElement<HTMLInputElement>("tattooUpload"),
    debugMeshInput: getElement<HTMLInputElement>("debugMesh"),
    opacityInput: getElement<HTMLInputElement>("opacity"),
    paramX: getElement<HTMLInputElement>("paramX"),
    paramY: getElement<HTMLInputElement>("paramY"),
    paramScale: getElement<HTMLInputElement>("paramScale"),
    paramRotation: getElement<HTMLInputElement>("paramRotation"),
    paramOpacity: getElement<HTMLInputElement>("paramOpacity"),
    resetButton: getElement<HTMLButtonElement>("reset"),
    transformPanel: getElement<HTMLDivElement>("tattooTransformPanel"),
    statusLabel: getElement<HTMLDivElement>("status"),
  };
}

function initializeAppState(
  defaultBodyCanvas: HTMLCanvasElement,
): AppState {
  const defaultMask = createFullImageMask(defaultBodyCanvas.width, defaultBodyCanvas.height);
  const defaultMesh = buildSphereMesh({ sphere, resolution: meshResolution });

  return {
    tattooTransform: { ...initialTransform },
    tattooAsset: null,
    transformRevision: 0,
    bodySurfaceState: {
      texture: Texture.from(defaultBodyCanvas),
      placementRect: { x: 0, y: 0, width: stageSize.width, height: stageSize.height },
      sourceSize: { width: stageSize.width, height: stageSize.height },
      mask: defaultMask,
      mesh: defaultMesh,
      pipelineParams: { ...defaultBodyMeshPipelineParams },
      revision: 0,
    },
  };
}

function createTransformSetter(
  state: AppState,
  elements: AppElements,
  pixi: PixiTattooRenderer,
  getFabric: () => FabricTattooController,
): SetTattooTransform {
  return (transform, source) => {
    const nextTransform = {
      ...transform,
      scale: clamp(transform.scale, 0.1, 2.4),
      opacity: clamp(transform.opacity, 0.25, 1),
    };
    const didTransformChange = !isSameTattooTransform(state.tattooTransform, nextTransform);
    state.tattooTransform = nextTransform;

    if (didTransformChange) {
      state.transformRevision += 1;
    }

    if (source === "panel" || source === "body-apply") {
      getFabric().setTransform(state.tattooTransform);
    }

    syncPanelFromTransform(state, elements);
    renderTattoo(state, pixi);
  };
}

function installTransformControls(
  state: AppState,
  elements: AppElements,
  setTransform: SetTattooTransform,
): void {
  const setOpacity = (opacity: number): void => {
    setTransform({
      ...state.tattooTransform,
      opacity,
    }, "panel");
  };

  const applyPanelTransform = (): void => {
    setTransform({
      x: Number(elements.paramX.value) || initialTransform.x,
      y: Number(elements.paramY.value) || initialTransform.y,
      scale: Number(elements.paramScale.value) || initialTransform.scale,
      rotation: degreesToRadians(Number(elements.paramRotation.value) || 0),
      opacity: Number(elements.paramOpacity.value) || initialTransform.opacity,
    }, "panel");
  };

  elements.opacityInput.addEventListener("input", () => setOpacity(Number(elements.opacityInput.value)));
  elements.paramOpacity.addEventListener("input", () => setOpacity(Number(elements.paramOpacity.value)));

  for (const input of [elements.paramX, elements.paramY, elements.paramScale, elements.paramRotation]) {
    input.addEventListener("input", applyPanelTransform);
  }
}

function installBodyUploadWorkflow(
  state: AppState,
  elements: AppElements,
  pixi: PixiTattooRenderer,
  setTransform: SetTattooTransform,
): void {
  let latestRequestToken = 0;

  elements.bodyUploadInput.addEventListener("change", () => {
    const file = elements.bodyUploadInput.files?.[0] ?? null;

    if (!file) {
      return;
    }

    const requestToken = latestRequestToken + 1;
    latestRequestToken = requestToken;
    const isCurrentRequest = (): boolean => requestToken === latestRequestToken;

    void (async () => {
      try {
        elements.statusLabel.textContent = "processing body upload...";
        const sourceCanvas = await fileToCanvas(file);

        if (!isCurrentRequest()) {
          return;
        }

        const modalResult = await openBodyUploadModal({
          fileName: file.name,
          sourceCanvas,
          initialParams: state.bodySurfaceState.pipelineParams,
          buildPreview: createBodyMeshPreviewBuilder(),
        });

        if (!isCurrentRequest()) {
          return;
        }

        if (!modalResult) {
          elements.statusLabel.textContent = "body upload cancelled";
          return;
        }

        applyBodySurfaceResult(state, pixi, modalResult);
        const centeredTransform = createBodyCenteredTattooTransform(state.bodySurfaceState.placementRect, state.tattooTransform.opacity);

        // WHY: Apply Body 后重置贴图中心，避免旧 body 的位置语义遗留到新 body 导致“贴图飞离人体”的错觉。
        // TRADE-OFF: 用户需再次微调位置，但获得稳定且可预测的初始贴附点。
        setTransform(centeredTransform, "body-apply");
        elements.statusLabel.textContent = "applied body mesh";
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }

        elements.statusLabel.textContent = `body upload failed: ${getErrorMessage(error)}`;
      }
    })();
  });
}

function applyBodySurfaceResult(
  state: AppState,
  pixi: PixiTattooRenderer,
  result: {
    sourceCanvas: HTMLCanvasElement;
    params: BodyMeshPipelineParams;
    preview: {
      mask: SkinMask;
      mesh: SkinMeshData;
    };
  },
): void {
  const placementRect = computeContainPlacementRect(
    { width: result.sourceCanvas.width, height: result.sourceCanvas.height },
    stageSize,
  );
  const mappedMesh = mapSkinMeshToPlacementRect(
    result.preview.mesh,
    { width: result.sourceCanvas.width, height: result.sourceCanvas.height },
    placementRect,
  );
  const revision = state.bodySurfaceState.revision + 1;

  state.bodySurfaceState = {
    texture: Texture.from(result.sourceCanvas),
    placementRect,
    sourceSize: { width: result.sourceCanvas.width, height: result.sourceCanvas.height },
    mask: result.preview.mask,
    mesh: mappedMesh,
    pipelineParams: { ...result.params },
    revision,
  };

  renderBodySurface(state, pixi);
}

function renderBodySurface(state: AppState, pixi: PixiTattooRenderer): void {
  const body: BodySurfaceRenderState = {
    texture: state.bodySurfaceState.texture,
    placementRect: state.bodySurfaceState.placementRect,
    mesh: state.bodySurfaceState.mesh,
  };

  pixi.setBodySurface(body);
}

function installDebugAndResetControls(
  elements: AppElements,
  pixi: PixiTattooRenderer,
  fabric: FabricTattooController,
  setTransform: SetTattooTransform,
): void {
  elements.debugMeshInput.addEventListener("change", () => {
    pixi.setDebugMeshVisible(elements.debugMeshInput.checked);
  });
  elements.resetButton.addEventListener("click", () => {
    setTransform({ ...initialTransform }, "panel");
    fabric.render();
  });
}

function renderTattoo(state: AppState, pixi: PixiTattooRenderer): void {
  if (!state.tattooAsset) {
    pixi.clearTattoo();
    return;
  }

  pixi.setTattoo({
    texture: state.tattooAsset.texture,
    tattooSize: state.tattooAsset.size,
    transform: state.tattooTransform,
  });
}

function syncPanelFromTransform(state: AppState, elements: AppElements): void {
  elements.transformPanel.hidden = state.tattooAsset === null;
  elements.transformPanel.setAttribute("aria-hidden", String(state.tattooAsset === null));
  elements.paramX.value = String(Math.round(state.tattooTransform.x));
  elements.paramY.value = String(Math.round(state.tattooTransform.y));
  elements.paramScale.value = state.tattooTransform.scale.toFixed(2);
  elements.paramRotation.value = String(Math.round(radiansToDegrees(state.tattooTransform.rotation)));
  elements.paramOpacity.value = state.tattooTransform.opacity.toFixed(2);
  elements.opacityInput.value = state.tattooTransform.opacity.toFixed(2);
}

function createDefaultBodyCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = stageSize.width;
  canvas.height = stageSize.height;
  const context = requiredContext(canvas);

  const gradient = context.createRadialGradient(
    sphere.cx - sphere.r * 0.35,
    sphere.cy - sphere.r * 0.45,
    sphere.r * 0.12,
    sphere.cx,
    sphere.cy,
    sphere.r,
  );
  gradient.addColorStop(0, "rgba(250, 226, 205, 0.94)");
  gradient.addColorStop(0.58, "rgba(202, 160, 142, 0.88)");
  gradient.addColorStop(1, "rgba(112, 76, 66, 0.82)");

  // WHY: 无 body 上传时保留球体占位，明确这是贴附预览的默认曲面而非真实人体照片。
  // TRADE-OFF: 占位体不参与 skin segmentation，但能保持首屏空间参照和 Show body mesh 回归稳定。
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(sphere.cx, sphere.cy, sphere.r, 0, Math.PI * 2);
  context.fill();

  return canvas;
}

function requiredContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create a 2D canvas context.");
  }
  return context;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing #${id}.`);
  }

  return element as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const skinMeshMaxEdge = 1024;

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

interface SkinMaskAdapters {
  segmentSkinFromImageSource(image: TexImageSource): Promise<SkinMask>;
  createSkinMaskFromCanvasAlpha(canvas: HTMLCanvasElement): SkinMask;
}

const defaultSkinMaskAdapters: SkinMaskAdapters = {
  segmentSkinFromImageSource,
  createSkinMaskFromCanvasAlpha,
};

interface BodyMeshPreviewSession {
  sourceCanvas: HTMLCanvasElement;
  workingCanvas: HTMLCanvasElement;
  mask: SkinMask;
}

type BodyMeshPreviewBuilder = (
  sourceCanvas: HTMLCanvasElement,
  params: BodyMeshPipelineParams,
) => Promise<{ mask: SkinMask; mesh: SkinMeshData; warning?: string }>;

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
      // WHY: segmentation 首次失败后清空会话缓存，避免后续调参永远复用失败 promise。
      // TRADE-OFF: 失败后下一次会触发一次新的 segmentation，但用户可以继续恢复流程。
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

      // WHY: 两级回退都失败时，仍返回 full-image mask 保证 Apply Body 主流程可继续。
      // TRADE-OFF: 结果精度最低，但能避免用户因依赖异常被完全阻塞。
      return createFullImageMask(canvas.width, canvas.height);
    }
  }
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
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    boundaryFlags: new Uint8Array([1, 1, 1, 1]),
  };
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

function createBodyCenteredTattooTransform(placementRect: Rect, opacity: number): TattooTransform {
  return {
    x: placementRect.x + placementRect.width / 2,
    y: placementRect.y + placementRect.height / 2,
    scale: initialTransform.scale,
    rotation: initialTransform.rotation,
    opacity,
  };
}

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const image = await fileToImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = requiredContext(canvas);
  context.drawImage(image, 0, 0);
  return canvas;
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not read ${file.name}: unsupported file data.`));
        return;
      }

      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not decode ${file.name} as PNG, JPG, or WebP.`));
      image.src = reader.result;
    };

    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
