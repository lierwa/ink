import { Canvas as FabricCanvas, Control, FabricImage } from "fabric";
import {
  fabricStateToTattooTransform,
  radiansToDegrees,
} from "../editorTransform";
import type { Size, TattooTransform } from "../domain/types";

const editorImageOpacity = 0.001;

export interface FabricControllerInput {
  canvas: HTMLCanvasElement;
  stageSize: Size;
  initialTransform: TattooTransform;
  initialImageDataUrl: string;
  onTransformChange(transform: TattooTransform): void;
}

export interface FabricTattooController {
  setImage(
    dataUrl: string,
    transform: TattooTransform,
    shouldCommit?: () => boolean,
    getCommitTransform?: () => TattooTransform,
  ): Promise<boolean>;
  setTransform(transform: TattooTransform): void;
  getTransform(): TattooTransform;
  render(): void;
  dispose(): void;
}

interface FabricTattooControllerState {
  fabricTattoo: FabricImage | null;
  currentOpacity: number;
}

export async function createFabricTattooController(
  input: FabricControllerInput,
): Promise<FabricTattooController> {
  const fabricCanvas = createFabricCanvas(input);
  const state: FabricTattooControllerState = {
    fabricTattoo: null,
    currentOpacity: input.initialTransform.opacity,
  };

  function readTransform(): TattooTransform {
    return readTattooTransform(state, input.initialTransform);
  }

  function emitTransformChange(): void {
    if (!state.fabricTattoo) {
      return;
    }

    state.fabricTattoo.set("opacity", editorImageOpacity);
    input.onTransformChange(readTransform());
    fabricCanvas.requestRenderAll();
  }

  async function setImage(
    dataUrl: string,
    transform: TattooTransform,
    shouldCommit: () => boolean = alwaysCommit,
    getCommitTransform?: () => TattooTransform,
  ): Promise<boolean> {
    const next = await createTattooImage(dataUrl, transform, (opacity) => {
      state.currentOpacity = opacity;
      emitTransformChange();
      return true;
    });

    if (!shouldCommit()) {
      return false;
    }

    const commitTransform = getCommitTransform?.() ?? transform;
    applyTattooTransform(next, commitTransform);
    state.currentOpacity = commitTransform.opacity;
    replaceTattooImage(fabricCanvas, state, next);
    return true;
  }

  function setTransform(transform: TattooTransform): void {
    if (!state.fabricTattoo) {
      return;
    }

    state.currentOpacity = transform.opacity;
    applyTattooTransform(state.fabricTattoo, transform);
    fabricCanvas.setActiveObject(state.fabricTattoo);
    fabricCanvas.requestRenderAll();
  }

  installTransformListeners(fabricCanvas, emitTransformChange);
  await setImage(input.initialImageDataUrl, input.initialTransform);

  return {
    setImage,
    setTransform,
    getTransform: readTransform,
    render() {
      if (state.fabricTattoo) {
        state.fabricTattoo.set("opacity", editorImageOpacity);
      }
      fabricCanvas.requestRenderAll();
    },
    dispose() {
      fabricCanvas.dispose();
    },
  };
}

function createFabricCanvas(input: FabricControllerInput): FabricCanvas {
  return new FabricCanvas(input.canvas, {
    width: input.stageSize.width,
    height: input.stageSize.height,
    selection: false,
    preserveObjectStacking: true,
  });
}

function readTattooTransform(
  state: FabricTattooControllerState,
  fallbackTransform: TattooTransform,
): TattooTransform {
  if (!state.fabricTattoo) {
    return { ...fallbackTransform, opacity: state.currentOpacity };
  }

  return {
    ...fabricStateToTattooTransform({
      left: state.fabricTattoo.left,
      top: state.fabricTattoo.top,
      width: state.fabricTattoo.width,
      height: state.fabricTattoo.height,
      scaleX: state.fabricTattoo.scaleX,
      scaleY: state.fabricTattoo.scaleY,
      angle: state.fabricTattoo.angle,
      opacity: state.currentOpacity,
    }),
    opacity: state.currentOpacity,
  };
}

async function createTattooImage(
  dataUrl: string,
  transform: TattooTransform,
  onOpacityChange: (opacity: number) => boolean,
): Promise<FabricImage> {
  const image = await FabricImage.fromURL(dataUrl);
  applyTattooImageDefaults(image);
  applyTattooTransform(image, transform);
  installOpacityControl(image, onOpacityChange);
  return image;
}

function applyTattooImageDefaults(image: FabricImage): void {
  image.set({
    originX: "center",
    originY: "center",
    borderColor: "#d96b52",
    cornerColor: "#d96b52",
    cornerStrokeColor: "#1b2021",
    cornerStyle: "circle",
    transparentCorners: false,
    centeredRotation: true,
    centeredScaling: true,
    lockSkewingX: true,
    lockSkewingY: true,
    selectable: true,
    evented: true,
  });
  image.setControlsVisibility({ mt: false, mr: false, mb: false, ml: false });
}

function applyTattooTransform(image: FabricImage, transform: TattooTransform): void {
  image.set({
    left: transform.x,
    top: transform.y,
    scaleX: transform.scale,
    scaleY: transform.scale,
    angle: radiansToDegrees(transform.rotation),
    opacity: editorImageOpacity,
  });
  image.setCoords();
}

function replaceTattooImage(
  fabricCanvas: FabricCanvas,
  state: FabricTattooControllerState,
  next: FabricImage,
): void {
  const previous = state.fabricTattoo;

  if (previous) {
    fabricCanvas.remove(previous);
  }

  state.fabricTattoo = next;
  fabricCanvas.add(next);
  fabricCanvas.setActiveObject(next);
  fabricCanvas.requestRenderAll();
}

function installTransformListeners(
  fabricCanvas: FabricCanvas,
  emitTransformChange: () => void,
): void {
  fabricCanvas.on("object:moving", emitTransformChange);
  fabricCanvas.on("object:scaling", emitTransformChange);
  fabricCanvas.on("object:rotating", emitTransformChange);
  fabricCanvas.on("object:modified", emitTransformChange);
  fabricCanvas.on("mouse:down", emitTransformChange);
  fabricCanvas.on("mouse:up", emitTransformChange);
}

function installOpacityControl(
  target: FabricImage,
  onOpacityChange: (opacity: number) => boolean,
): void {
  target.controls.opacity = new Control({
    x: 0.5,
    y: -0.5,
    offsetX: 34,
    offsetY: -34,
    cursorStyle: "ew-resize",
    actionName: "opacity",
    actionHandler: (_eventData, transformData, x) => {
      const left = transformData.target.left ?? 0;
      const opacity = clamp(0.25 + ((x - (left - 120)) / 240) * 0.75, 0.25, 1);
      return onOpacityChange(opacity);
    },
    render: (ctx, left, top) => {
      ctx.save();
      ctx.fillStyle = "#d96b52";
      ctx.strokeStyle = "#1b2021";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(left, top, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#1b2021";
      ctx.font = "700 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("%", left, top + 0.5);
      ctx.restore();
    },
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function alwaysCommit(): boolean {
  return true;
}
