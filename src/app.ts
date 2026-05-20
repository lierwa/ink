import { Texture } from "pixi.js";
import { createFabricTattooController, type FabricTattooController } from "./editor/fabricController";
import { installStageFitController } from "./editor/stageFitController";
import { radiansToDegrees, degreesToRadians } from "./editorTransform";
import {
  createPixiTattooRenderer,
  type BodySurfaceRenderState,
  type PixiTattooRenderer,
  type PixiTattooState,
} from "./render/pixiRenderer";
import { createAppMarkup, createCanvasMarkup } from "./appMarkup";
import { isSameTattooTransform } from "./appUploadQueue";
import { installUploadWorkflow } from "./appUploadWorkflow";
import { installBodyUploadWorkflow } from "./appBodyUploadWorkflow";
import type { CropRect } from "./image/cropCanvas";
import type { UploadProcessingMode } from "./editor/uploadConfirmModal";
import {
  createLiveSurfaceRefreshScheduler,
  replaceTextureBindingBeforeDestroy,
  type LiveSurfaceRefreshScheduler,
} from "./appSurfaceRuntime";
import {
  defaultBodyMeshPipelineParams,
} from "./domain/skinMeshPipeline";
import { buildLocalMeshSurface } from "./domain/localMeshSurface";
import { buildTattooWarpMesh } from "./domain/tattooWarpMesh";
import { createFlatSurfaceNormalTexture, createSurfaceNormalTexture } from "./image/surfaceNormalTexture";
import { meshResolution, sphere, stageSize } from "./sphereConfig";
import { buildSphereMesh } from "./domain/sphereMesh";
import type {
  BodySurfaceAnalysisDebugState,
  BodyMeshPipelineParams,
  Rect,
  Size,
  SkinMask,
  SkinMeshData,
  TattooTransform,
  TattooWarpMeshData,
} from "./domain/types";

export {
  buildBodyMeshPreview,
  computeContainPlacementRect,
  createBodyMeshPreviewBuilder,
  createSkinMaskWithFallback,
  mapSkinMeshToPlacementRect,
  normalizeSkinMeshImageSize,
} from "./appBodyMeshPreview";

const initialTransform: TattooTransform = {
  x: stageSize.width / 2,
  y: stageSize.height / 2,
  scale: 0.42,
  rotation: 0,
  opacity: 1,
};
interface BodySurfaceState {
  texture: Texture;
  sourceCanvas: HTMLCanvasElement;
  fileName: string;
  surfaceNormalTexture: Texture | null;
  placementRect: Rect;
  sourceSize: Size;
  mask: SkinMask;
  mesh: SkinMeshData;
  pipelineParams: BodyMeshPipelineParams;
  analysisDebug: BodySurfaceAnalysisDebugState | null;
  revision: number;
}

interface TattooAssetState {
  texture: Texture;
  size: Size;
  dataUrl: string;
  sourceCanvas: HTMLCanvasElement;
  fileName: string;
  selectedMode: UploadProcessingMode;
  cropRect: CropRect;
}

interface AppState {
  tattooTransform: TattooTransform;
  tattooAsset: TattooAssetState | null;
  tattooWarpMesh: TattooWarpMeshData | null;
  transformRevision: number;
  shadingGeometryAssistEnabled: boolean;
  bodySurfaceState: BodySurfaceState;
}

interface TattooRenderStateInput {
  tattooAsset: Pick<TattooAssetState, "texture" | "size"> | null;
  tattooTransform: TattooTransform;
  tattooWarpMesh: TattooWarpMeshData | null;
}

interface SurfaceStatusElements {
  statusLabel: HTMLElement;
}

type TattooSurfaceRefreshRenderer = Pick<
  PixiTattooRenderer,
  "clearTattoo" | "setSurfaceNormalTexture" | "setTattoo"
>;

interface AppElements {
  canvasFrame: HTMLDivElement;
  stageStack: HTMLDivElement;
  pixiLayer: HTMLDivElement;
  fabricLayer: HTMLCanvasElement;
  bodyUploadInput: HTMLInputElement;
  tattooUploadInput: HTMLInputElement;
  bodyUploadStatus: HTMLDivElement;
  tattooUploadStatus: HTMLDivElement;
  editBodyButton: HTMLButtonElement;
  removeBodyButton: HTMLButtonElement;
  editTattooButton: HTMLButtonElement;
  removeTattooButton: HTMLButtonElement;
  debugMeshInput: HTMLInputElement;
  shadingGeometryAssistInput: HTMLInputElement;
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

type TransformUpdatePhase = "live" | "commit";
type SetTattooTransform = (
  transform: TattooTransform,
  source: "fabric" | "panel" | "body-apply",
  phase?: TransformUpdatePhase,
) => void;

export async function startApp(): Promise<void> {
  const elements = initializeAppShell();
  const defaultBodyCanvas = createDefaultBodyCanvas();
  const state = initializeAppState(defaultBodyCanvas);
  let pixi: PixiTattooRenderer;
  const refreshLocalSurfaceAndRenderTattoo = (): void => refreshLocalSurfaceForTattooRender(state, elements, pixi);
  const scheduleLiveSurfaceRefresh = createLiveSurfaceRefreshScheduler(refreshLocalSurfaceAndRenderTattoo);

  pixi = await createPixiTattooRenderer({
    mount: elements.pixiLayer,
    stageSize,
    sphere,
    mesh: meshResolution,
    onContextLost: () => {
      elements.statusLabel.textContent = "render context lost; restoring...";
    },
    onContextRestored: () => {
      renderBodySurface(state, pixi);
      refreshLocalSurfaceAndRenderTattoo();
    },
  });

  let fabric: FabricTattooController;
  const setTransform = createTransformSetter(state, elements, pixi, () => fabric, scheduleLiveSurfaceRefresh);

  fabric = await createFabricTattooController({
    canvas: elements.fabricLayer,
    stageSize,
    initialTransform,
    onTransformChange(transform, phase) {
      setTransform(transform, "fabric", phase);
    },
  });

  renderBodySurface(state, pixi);
  renderTattoo(state, pixi);
  syncPanelFromTransform(state, elements);

  installTransformControls(state, elements, pixi, setTransform);
  installUploadWorkflow({
    state,
    elements: {
      tattooUploadInput: elements.tattooUploadInput,
      tattooUploadStatus: elements.tattooUploadStatus,
      statusLabel: elements.statusLabel,
      editTattooButton: elements.editTattooButton,
      removeTattooButton: elements.removeTattooButton,
    },
    fabric,
    initialTransform,
    renderTattoo: refreshLocalSurfaceAndRenderTattoo,
    syncPanelFromTransform: () => syncPanelFromTransform(state, elements),
  });
  installBodyUploadWorkflow({
    state,
    elements: {
      bodyUploadInput: elements.bodyUploadInput,
      bodyUploadStatus: elements.bodyUploadStatus,
      editBodyButton: elements.editBodyButton,
      removeBodyButton: elements.removeBodyButton,
      statusLabel: elements.statusLabel,
    },
    pixi,
    initialTransform,
    setTransform,
    renderBodySurface: () => {
      scheduleLiveSurfaceRefresh.cancel();
      renderBodySurface(state, pixi);
    },
    resetBodySurface: () => {
      scheduleLiveSurfaceRefresh.cancel();
      resetBodySurface(state, pixi);
      renderBodySurface(state, pixi);
      refreshLocalSurfaceAndRenderTattoo();
    },
  });
  installDebugAndResetControls(elements, pixi, fabric, setTransform);

  void pixi.canvas;
}

function initializeAppShell(): AppElements {
  const root = document.querySelector<HTMLDivElement>("#app");

  if (!root) {
    throw new Error("Missing #app root.");
  }

  root.innerHTML = createAppMarkup(initialTransform);
  const canvasFrame = getElement<HTMLDivElement>("canvasFrame");
  canvasFrame.innerHTML = createCanvasMarkup();
  const elements = getAppElements();
  installStageFitController(elements.canvasFrame, elements.stageStack, stageSize);
  return elements;
}

function getAppElements(): AppElements {
  return {
    canvasFrame: getElement<HTMLDivElement>("canvasFrame"),
    stageStack: getElement<HTMLDivElement>("stageStack"),
    pixiLayer: getElement<HTMLDivElement>("pixiLayer"),
    fabricLayer: getElement<HTMLCanvasElement>("fabricLayer"),
    bodyUploadInput: getElement<HTMLInputElement>("bodyUpload"),
    tattooUploadInput: getElement<HTMLInputElement>("tattooUpload"),
    bodyUploadStatus: getElement<HTMLDivElement>("bodyUploadStatus"),
    tattooUploadStatus: getElement<HTMLDivElement>("tattooUploadStatus"),
    editBodyButton: getElement<HTMLButtonElement>("editBody"),
    removeBodyButton: getElement<HTMLButtonElement>("removeBody"),
    editTattooButton: getElement<HTMLButtonElement>("editTattoo"),
    removeTattooButton: getElement<HTMLButtonElement>("removeTattoo"),
    debugMeshInput: getElement<HTMLInputElement>("debugMesh"),
    shadingGeometryAssistInput: getElement<HTMLInputElement>("shadingGeometryAssist"),
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
    tattooWarpMesh: null,
    transformRevision: 0,
    shadingGeometryAssistEnabled: false,
    bodySurfaceState: {
      texture: Texture.from(defaultBodyCanvas),
      sourceCanvas: defaultBodyCanvas,
      fileName: "default-placeholder",
      surfaceNormalTexture: createFlatSurfaceNormalTexture(stageSize),
      placementRect: { x: 0, y: 0, width: stageSize.width, height: stageSize.height },
      sourceSize: { width: stageSize.width, height: stageSize.height },
      mask: defaultMask,
      mesh: defaultMesh,
      pipelineParams: { ...defaultBodyMeshPipelineParams },
      analysisDebug: null,
      revision: 0,
    },
  };
}

export function createTransformSetter(
  state: AppState,
  elements: AppElements,
  pixi: PixiTattooRenderer,
  getFabric: () => FabricTattooController,
  scheduleLiveSurfaceRefresh: LiveSurfaceRefreshScheduler,
): SetTattooTransform {
  return (transform, source, phase = "commit") => {
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
    if (source === "fabric" && phase === "live") {
      scheduleLiveSurfaceRefresh.cancel();
      // WHY: Pixi 直接消费 warpMesh 顶点/UV，live 拖拽也必须先重建 TPS mesh，避免新 transform 搭配旧几何。
      // TRADE-OFF: 放弃旧的“先廉价渲染、稍后刷新”路径，拖拽时多做同步曲面计算，换取任意帧都不提交 stale mesh。
      refreshLocalSurfaceForTattooRender(state, elements, pixi);
      return;
    }
    scheduleLiveSurfaceRefresh.cancel();
    // WHY: 非 live 路径同样先刷新局部曲面与 TPS mesh，再把 tattoo 交给 Pixi，保证最终落点与几何一致。
    // TRADE-OFF: 提交时多一次同步曲面计算，但避免 shader/geometry 继续沿用旧 warpMesh。
    refreshLocalSurfaceForTattooRender(state, elements, pixi);
  };
}

function installTransformControls(
  state: AppState,
  elements: AppElements,
  pixi: PixiTattooRenderer,
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
  elements.shadingGeometryAssistInput.addEventListener("change", () => {
    state.shadingGeometryAssistEnabled = elements.shadingGeometryAssistInput.checked;
    // WHY: shading assist 会改变局部曲面和 TPS mesh，刷新后必须重新提交 tattoo 状态给 Pixi。
    // TRADE-OFF: 开关时多一次 tattoo state 提交，但避免 shader/geometry 继续使用旧 warpMesh。
    refreshLocalSurfaceForTattooRender(state, elements, pixi);
  });

  for (const input of [elements.paramX, elements.paramY, elements.paramScale, elements.paramRotation]) {
    input.addEventListener("input", applyPanelTransform);
  }
}

function renderBodySurface(state: AppState, pixi: PixiTattooRenderer): void {
  const body: BodySurfaceRenderState = {
    texture: state.bodySurfaceState.texture,
    surfaceNormalTexture: state.bodySurfaceState.surfaceNormalTexture,
    placementRect: state.bodySurfaceState.placementRect,
    mask: state.bodySurfaceState.mask,
    mesh: state.bodySurfaceState.mesh,
  };

  pixi.setBodySurface(body);
  pixi.setBodyAnalysisDebug(state.bodySurfaceState.analysisDebug);
}

function refreshLocalSurface(
  state: AppState,
  elements: SurfaceStatusElements,
  pixi: Pick<PixiTattooRenderer, "setSurfaceNormalTexture">,
): void {
  if (!state.tattooAsset) {
    state.tattooWarpMesh = null;
    replaceSurfaceNormalTexture(state, pixi, null);
    state.bodySurfaceState.analysisDebug = null;
    refreshSurfaceStatus(state, elements);
    return;
  }

  const tattooBounds = getTattooBounds(state.tattooAsset.size, state.tattooTransform);
  const localSurface = buildLocalMeshSurface({
    mask: state.bodySurfaceState.mask,
    mesh: state.bodySurfaceState.mesh,
    stageSize,
    placementRect: state.bodySurfaceState.placementRect,
    tattooBounds,
    shadingAssist: {
      enabled: state.shadingGeometryAssistEnabled,
      sourceCanvas: state.bodySurfaceState.sourceCanvas,
      maxAdjustmentRatio: 0.25,
    },
  });

  const nextSurfaceNormalTexture = localSurface.debug.source === "local-mesh"
    ? createSurfaceNormalTexture(localSurface.surfaceField)
    : null;
  replaceSurfaceNormalTexture(state, pixi, nextSurfaceNormalTexture);
  state.bodySurfaceState.analysisDebug = localSurface.debug;
  state.tattooWarpMesh = buildTattooWarpMesh({
    tattooSize: state.tattooAsset.size,
    transform: state.tattooTransform,
    surface: localSurface.debug.source === "local-mesh" ? localSurface.debug : null,
    bodyMesh: state.bodySurfaceState.mesh,
  });
  refreshSurfaceStatus(state, elements);
}

function installDebugAndResetControls(
  elements: AppElements,
  pixi: PixiTattooRenderer,
  fabric: FabricTattooController,
  setTransform: SetTattooTransform,
): void {
  elements.debugMeshInput.addEventListener("change", () => {
    // WHY: 显示开关可能在 body mesh 刚替换后触发，主动重绘可避免只改 visible 却沿用旧 Graphics 路径。
    // TRADE-OFF: 多一次轻量线框生成，但让 Show body mesh 与当前 body 状态严格同步。
    pixi.setSkinDebugMesh(null);
    pixi.setDebugMeshVisible(elements.debugMeshInput.checked);
  });
  elements.resetButton.addEventListener("click", () => {
    setTransform({ ...initialTransform }, "panel");
    fabric.render();
  });
}

function renderTattoo(state: AppState, pixi: Pick<PixiTattooRenderer, "clearTattoo" | "setTattoo">): void {
  const tattooState = createTattooRenderState(state);
  if (!tattooState) {
    pixi.clearTattoo();
    return;
  }

  pixi.setTattoo(tattooState);
}

export function createTattooRenderState(
  state: TattooRenderStateInput,
): PixiTattooState | null {
  if (!state.tattooAsset) {
    return null;
  }

  return {
    texture: state.tattooAsset.texture,
    tattooSize: state.tattooAsset.size,
    transform: state.tattooTransform,
    warpMesh: state.tattooWarpMesh,
  };
}

export function refreshTattooWarpAndRenderTattoo(
  refreshTattooWarp: () => void,
  renderCurrentTattoo: () => void,
): void {
  refreshTattooWarp();
  renderCurrentTattoo();
}

export function refreshLocalSurfaceForTattooRender(
  state: AppState,
  elements: SurfaceStatusElements,
  pixi: TattooSurfaceRefreshRenderer,
): void {
  refreshTattooWarpAndRenderTattoo(
    () => refreshLocalSurface(state, elements, pixi),
    () => renderTattoo(state, pixi),
  );
}

function getTattooBounds(size: Size, transform: TattooTransform): Rect {
  const width = size.width * transform.scale;
  const height = size.height * transform.scale;
  return {
    x: transform.x - width / 2,
    y: transform.y - height / 2,
    width,
    height,
  };
}

function refreshSurfaceStatus(state: AppState, elements: SurfaceStatusElements): void {
  const debug = state.bodySurfaceState.analysisDebug;
  if (!debug) {
    return;
  }
  elements.statusLabel.textContent = `${formatLocalSurfaceStatus(debug)}${formatTpsWarpStatusSuffix(state.tattooWarpMesh)}`;
}

export function formatTpsWarpStatusSuffix(mesh: TattooWarpMeshData | null): string {
  if (!mesh) {
    return " / TPS warp unavailable";
  }

  return ` / TPS warp ${Math.round(mesh.stats.maxDisplacementPx)}px`;
}

function formatLocalSurfaceStatus(debug: BodySurfaceAnalysisDebugState): string {
  if (debug.source === "insufficient-mesh") {
    return "Surface: insufficient local mesh / warp disabled";
  }

  const shading = debug.shading?.used
    ? " / shading used"
    : debug.shading?.enabled
      ? ` / shading ${debug.shading.reason}`
      : " / shading off";
  return `Surface: local mesh / ${debug.proxy ?? "proxy"} / warp ${describeWarp(debug.normalStats?.meanNormalXY ?? 0)}${shading}`;
}

function resetBodySurface(state: AppState, pixi: PixiTattooRenderer): void {
  const defaultBodyCanvas = createDefaultBodyCanvas();
  const previousNormalTexture = state.bodySurfaceState.surfaceNormalTexture;
  if (previousNormalTexture) {
    // WHY: Remove body 会立即回到默认曲面，先解除旧 normal 绑定可避免销毁后仍被 shader 采样。
    // TRADE-OFF: 保留 body texture 生命周期给 Pixi 管理，当前只主动处理最容易悬挂引用的 normal texture。
    pixi.setSurfaceNormalTexture(null);
    previousNormalTexture.destroy(true);
  }
  state.bodySurfaceState = initializeAppState(defaultBodyCanvas).bodySurfaceState;
}

function describeWarp(meanNormalXY: number): "weak" | "medium" | "strong" {
  if (meanNormalXY >= 0.34) {
    return "strong";
  }
  if (meanNormalXY >= 0.14) {
    return "medium";
  }
  return "weak";
}

function syncPanelFromTransform(state: AppState, elements: AppElements): void {
  elements.transformPanel.hidden = state.tattooAsset === null;
  elements.transformPanel.setAttribute("aria-hidden", String(state.tattooAsset === null));
  elements.editTattooButton.disabled = state.tattooAsset === null;
  elements.removeTattooButton.disabled = state.tattooAsset === null;
  elements.paramX.value = String(Math.round(state.tattooTransform.x));
  elements.paramY.value = String(Math.round(state.tattooTransform.y));
  elements.paramScale.value = state.tattooTransform.scale.toFixed(2);
  elements.paramRotation.value = String(Math.round(radiansToDegrees(state.tattooTransform.rotation)));
  elements.paramOpacity.value = state.tattooTransform.opacity.toFixed(2);
  elements.opacityInput.value = state.tattooTransform.opacity.toFixed(2);
}

function replaceSurfaceNormalTexture(
  state: AppState,
  pixi: Pick<PixiTattooRenderer, "setSurfaceNormalTexture">,
  nextTexture: Texture | null,
): void {
  const previousTexture = state.bodySurfaceState.surfaceNormalTexture;
  state.bodySurfaceState.surfaceNormalTexture = nextTexture;
  replaceTextureBindingBeforeDestroy(previousTexture, nextTexture, (texture) => pixi.setSurfaceNormalTexture(texture));
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

function createFullImageMask(width: number, height: number): SkinMask {
  return {
    width,
    height,
    probabilities: new Float32Array(width * height).fill(1),
  };
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
