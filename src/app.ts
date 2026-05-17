import { Texture } from "pixi.js";
import { createFabricTattooController, type FabricTattooController } from "./editor/fabricController";
import { installCanvasViewportController } from "./editor/canvasViewportController";
import { radiansToDegrees, degreesToRadians } from "./editorTransform";
import { createPixiTattooRenderer, type PixiTattooRenderer } from "./render/pixiRenderer";
import { defaultTattooDataUrl, defaultTattooSize } from "./defaultTattoo";
import { createAppMarkup, createCanvasMarkup } from "./appMarkup";
import { isSameTattooTransform } from "./appUploadQueue";
import { installUploadWorkflow } from "./appUploadWorkflow";
import { normalizeMeshResolution } from "./domain/sphereMesh";
import { meshResolution, sphere, stageSize } from "./sphereConfig";
import type { Size, SphereMeshResolution, TattooTransform } from "./domain/types";

const initialTransform: TattooTransform = {
  x: sphere.cx,
  y: sphere.cy,
  scale: 0.42,
  rotation: -0.18,
  opacity: 0.84,
};

interface AppState {
  tattooTransform: TattooTransform;
  tattooSize: Size;
  tattooTexture: Texture;
  tattooDataUrl: string;
  transformRevision: number;
  meshResolution: SphereMeshResolution;
  removeWhiteUpload: boolean;
}

interface AppElements {
  viewportSurface: HTMLDivElement;
  stageStack: HTMLDivElement;
  pixiLayer: HTMLDivElement;
  fabricLayer: HTMLCanvasElement;
  uploadInput: HTMLInputElement;
  removeWhiteInput: HTMLInputElement;
  debugMeshInput: HTMLInputElement;
  opacityInput: HTMLInputElement;
  radialSegmentsInput: HTMLInputElement;
  angularSegmentsInput: HTMLInputElement;
  paramX: HTMLInputElement;
  paramY: HTMLInputElement;
  paramScale: HTMLInputElement;
  paramRotation: HTMLInputElement;
  paramOpacity: HTMLInputElement;
  resetButton: HTMLButtonElement;
  statusLabel: HTMLDivElement;
}

type SetTattooTransform = (transform: TattooTransform, source: "fabric" | "panel") => void;

export async function startApp(): Promise<void> {
  const elements = initializeAppShell();
  const defaultCanvas = await createDefaultTattooCanvas();
  const defaultDataUrl = defaultCanvas.toDataURL("image/png");
  const state = initializeAppState(defaultCanvas, defaultDataUrl, elements.removeWhiteInput);
  const pixi = await createPixiTattooRenderer({
    mount: elements.pixiLayer,
    stageSize,
    sphere,
    mesh: state.meshResolution,
  });
  let fabric: FabricTattooController;
  const setTransform = createTransformSetter(state, elements, pixi, () => fabric);

  fabric = await createFabricTattooController({
    canvas: elements.fabricLayer,
    stageSize,
    initialTransform,
    initialImageDataUrl: defaultDataUrl,
    onTransformChange(transform) {
      setTransform(transform, "fabric");
    },
  });

  renderTattoo(state, pixi);
  syncPanelFromTransform(state, elements);
  syncMeshResolutionInputs(state, elements);
  installCanvasViewportController({
    viewportSurface: elements.viewportSurface,
    stageStack: elements.stageStack,
  });
  installTransformControls(state, elements, setTransform);
  installMeshResolutionControls(state, elements, pixi);
  installUploadWorkflow({
    state,
    elements,
    fabric,
    pixi,
    initialTransform,
    renderTattoo: () => renderTattoo(state, pixi),
    syncPanelFromTransform: () => syncPanelFromTransform(state, elements),
    createDefaultTattooCanvas,
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
  getElement<HTMLDivElement>("canvasFrame").innerHTML = createCanvasMarkup();
  return getAppElements();
}

function getAppElements(): AppElements {
  return {
    viewportSurface: getElement<HTMLDivElement>("viewportSurface"),
    stageStack: getElement<HTMLDivElement>("stageStack"),
    pixiLayer: getElement<HTMLDivElement>("pixiLayer"),
    fabricLayer: getElement<HTMLCanvasElement>("fabricLayer"),
    uploadInput: getElement<HTMLInputElement>("tattooUpload"),
    removeWhiteInput: getElement<HTMLInputElement>("removeWhite"),
    debugMeshInput: getElement<HTMLInputElement>("debugMesh"),
    opacityInput: getElement<HTMLInputElement>("opacity"),
    radialSegmentsInput: getElement<HTMLInputElement>("radialSegments"),
    angularSegmentsInput: getElement<HTMLInputElement>("angularSegments"),
    paramX: getElement<HTMLInputElement>("paramX"),
    paramY: getElement<HTMLInputElement>("paramY"),
    paramScale: getElement<HTMLInputElement>("paramScale"),
    paramRotation: getElement<HTMLInputElement>("paramRotation"),
    paramOpacity: getElement<HTMLInputElement>("paramOpacity"),
    resetButton: getElement<HTMLButtonElement>("reset"),
    statusLabel: getElement<HTMLDivElement>("status"),
  };
}

function initializeAppState(
  defaultCanvas: HTMLCanvasElement,
  defaultDataUrl: string,
  removeWhiteInput: HTMLInputElement,
): AppState {
  return {
    tattooTransform: { ...initialTransform },
    tattooSize: {
      width: defaultCanvas.width,
      height: defaultCanvas.height,
    },
    tattooTexture: Texture.from(defaultCanvas),
    tattooDataUrl: defaultDataUrl,
    transformRevision: 0,
    meshResolution: { ...meshResolution },
    removeWhiteUpload: removeWhiteInput.checked,
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

    if (source === "panel") {
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

function installMeshResolutionControls(
  state: AppState,
  elements: AppElements,
  pixi: PixiTattooRenderer,
): void {
  const setMeshResolution = (resolution: SphereMeshResolution): void => {
    const nextResolution = normalizeMeshResolution(resolution);

    if (isSameMeshResolution(state.meshResolution, nextResolution)) {
      syncMeshResolutionInputs(state, elements);
      return;
    }

    state.meshResolution = nextResolution;

    // WHY: 网格密度属于 Pixi 渲染器的成熟边界；这里只同步状态与表单，取舍是避免在 App 层复制网格生成逻辑。
    pixi.setMeshResolution(state.meshResolution);
    syncMeshResolutionInputs(state, elements);
  };
  const applyMeshResolution = (): void => {
    const radialSegments = parseMeshSegmentDraft(elements.radialSegmentsInput.value);
    const angularSegments = parseMeshSegmentDraft(elements.angularSegmentsInput.value);

    if (radialSegments === null || angularSegments === null) {
      syncMeshResolutionInputs(state, elements);
      return;
    }

    setMeshResolution({ radialSegments, angularSegments });
  };
  const commitMeshResolutionOnEnter = (event: KeyboardEvent): void => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    applyMeshResolution();
  };

  for (const input of [elements.radialSegmentsInput, elements.angularSegmentsInput]) {
    input.addEventListener("change", applyMeshResolution);
    input.addEventListener("keydown", commitMeshResolutionOnEnter);
  }
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
  pixi.setTattoo({
    texture: state.tattooTexture,
    tattooSize: state.tattooSize,
    transform: state.tattooTransform,
  });
}

function syncPanelFromTransform(state: AppState, elements: AppElements): void {
  elements.paramX.value = String(Math.round(state.tattooTransform.x));
  elements.paramY.value = String(Math.round(state.tattooTransform.y));
  elements.paramScale.value = state.tattooTransform.scale.toFixed(2);
  elements.paramRotation.value = String(Math.round(radiansToDegrees(state.tattooTransform.rotation)));
  elements.paramOpacity.value = state.tattooTransform.opacity.toFixed(2);
  elements.opacityInput.value = state.tattooTransform.opacity.toFixed(2);
}

function syncMeshResolutionInputs(state: AppState, elements: AppElements): void {
  elements.radialSegmentsInput.value = String(state.meshResolution.radialSegments);
  elements.angularSegmentsInput.value = String(state.meshResolution.angularSegments);
}

async function createDefaultTattooCanvas(): Promise<HTMLCanvasElement> {
  const image = await loadImage(defaultTattooDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = defaultTattooSize.width;
  canvas.height = defaultTattooSize.height;
  const context = requiredContext(canvas);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the default tattoo image."));
    image.src = source;
  });
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

function parseMeshSegmentDraft(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSameMeshResolution(first: SphereMeshResolution, second: SphereMeshResolution): boolean {
  return (
    first.radialSegments === second.radialSegments &&
    first.angularSegments === second.angularSegments
  );
}
