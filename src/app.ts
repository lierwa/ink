import { Texture } from "pixi.js";
import { createFabricTattooController, type FabricTattooController } from "./editor/fabricController";
import { installStageFitController } from "./editor/stageFitController";
import { radiansToDegrees, degreesToRadians } from "./editorTransform";
import {
  createPixiTattooRenderer,
  type BodySurfaceRenderState,
  type PixiTattooRenderer,
} from "./render/pixiRenderer";
import { createAppMarkup, createCanvasMarkup, defaultSurfaceFitStrength } from "./appMarkup";
import { isSameTattooTransform } from "./appUploadQueue";
import { installUploadWorkflow } from "./appUploadWorkflow";
import { installBodyUploadWorkflow } from "./appBodyUploadWorkflow";
import {
  createLiveSurfaceRefreshScheduler,
  formatSurfaceFitStrength,
  replaceTextureBindingBeforeDestroy,
  type LiveSurfaceRefreshScheduler,
} from "./appSurfaceRuntime";
import {
  defaultBodyMeshPipelineParams,
} from "./domain/skinMeshPipeline";
import { buildLocalMeshSurface } from "./domain/localMeshSurface";
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
}

interface AppState {
  tattooTransform: TattooTransform;
  tattooAsset: TattooAssetState | null;
  transformRevision: number;
  surfaceFitStrength: number;
  bodySurfaceState: BodySurfaceState;
}

interface AppElements {
  canvasFrame: HTMLDivElement;
  stageStack: HTMLDivElement;
  pixiLayer: HTMLDivElement;
  fabricLayer: HTMLCanvasElement;
  bodyUploadInput: HTMLInputElement;
  tattooUploadInput: HTMLInputElement;
  debugMeshInput: HTMLInputElement;
  opacityInput: HTMLInputElement;
  surfaceFitInput: HTMLInputElement;
  surfaceFitOutput: HTMLOutputElement;
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
  const forceRefreshLocalSurface = (): void => refreshLocalSurface(state, elements, pixi);
  const scheduleLiveSurfaceRefresh = createLiveSurfaceRefreshScheduler(forceRefreshLocalSurface);

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
      forceRefreshLocalSurface();
      renderTattoo(state, pixi);
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
      statusLabel: elements.statusLabel,
    },
    fabric,
    initialTransform,
    renderTattoo: () => {
      forceRefreshLocalSurface();
      renderTattoo(state, pixi);
    },
    syncPanelFromTransform: () => syncPanelFromTransform(state, elements),
  });
  installBodyUploadWorkflow({
    state,
    elements: {
      bodyUploadInput: elements.bodyUploadInput,
      statusLabel: elements.statusLabel,
    },
    pixi,
    initialTransform,
    setTransform,
    renderBodySurface: () => {
      scheduleLiveSurfaceRefresh.cancel();
      renderBodySurface(state, pixi);
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

  root.innerHTML = createAppMarkup(initialTransform, defaultSurfaceFitStrength);
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
    debugMeshInput: getElement<HTMLInputElement>("debugMesh"),
    opacityInput: getElement<HTMLInputElement>("opacity"),
    surfaceFitInput: getElement<HTMLInputElement>("surfaceFitStrength"),
    surfaceFitOutput: getElement<HTMLOutputElement>("surfaceFitStrengthValue"),
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
    surfaceFitStrength: defaultSurfaceFitStrength,
    bodySurfaceState: {
      texture: Texture.from(defaultBodyCanvas),
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

function createTransformSetter(
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
    renderTattoo(state, pixi);
    if (source === "fabric" && phase === "live") {
      if (state.tattooAsset) {
        scheduleLiveSurfaceRefresh.schedule();
      }
      return;
    }
    scheduleLiveSurfaceRefresh.cancel();
    refreshLocalSurface(state, elements, pixi);
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
  elements.surfaceFitInput.addEventListener("input", () => {
    const strength = clamp(Number(elements.surfaceFitInput.value), 0, 5);
    state.surfaceFitStrength = strength;
    elements.surfaceFitOutput.textContent = formatSurfaceFitStrength(strength);
    pixi.setSurfaceIntensity(strength);
    refreshSurfaceStatus(state, elements);
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
    mesh: state.bodySurfaceState.mesh,
  };

  pixi.setBodySurface(body);
  pixi.setBodyAnalysisDebug(state.bodySurfaceState.analysisDebug);
}

function refreshLocalSurface(state: AppState, elements: AppElements, pixi: PixiTattooRenderer): void {
  if (!state.tattooAsset) {
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
  });

  const nextSurfaceNormalTexture = localSurface.debug.source === "local-mesh"
    ? createSurfaceNormalTexture(localSurface.surfaceField)
    : null;
  replaceSurfaceNormalTexture(state, pixi, nextSurfaceNormalTexture);
  state.bodySurfaceState.analysisDebug = localSurface.debug;
  refreshSurfaceStatus(state, elements);
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

function refreshSurfaceStatus(state: AppState, elements: AppElements): void {
  const debug = state.bodySurfaceState.analysisDebug;
  if (!debug) {
    return;
  }
  elements.statusLabel.textContent = formatLocalSurfaceStatus(debug, state.surfaceFitStrength);
}

function formatLocalSurfaceStatus(debug: BodySurfaceAnalysisDebugState, fitStrength: number): string {
  if (debug.source === "insufficient-mesh") {
    return `Surface: insufficient local mesh / warp disabled / fit ${formatSurfaceFitStrength(fitStrength)}`;
  }

  return `Surface: local mesh / warp ${describeWarp(debug.normalStats?.meanNormalXY ?? 0)} / fit ${formatSurfaceFitStrength(fitStrength)}`;
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
  elements.paramX.value = String(Math.round(state.tattooTransform.x));
  elements.paramY.value = String(Math.round(state.tattooTransform.y));
  elements.paramScale.value = state.tattooTransform.scale.toFixed(2);
  elements.paramRotation.value = String(Math.round(radiansToDegrees(state.tattooTransform.rotation)));
  elements.paramOpacity.value = state.tattooTransform.opacity.toFixed(2);
  elements.opacityInput.value = state.tattooTransform.opacity.toFixed(2);
  elements.surfaceFitInput.value = state.surfaceFitStrength.toFixed(2);
  elements.surfaceFitOutput.textContent = formatSurfaceFitStrength(state.surfaceFitStrength);
}

function replaceSurfaceNormalTexture(
  state: AppState,
  pixi: PixiTattooRenderer,
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

