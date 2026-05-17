import { isInteractiveTarget, panViewport, zoomViewportAtPoint } from "../domain/canvasViewport";
import type { CanvasViewport } from "../domain/types";

type ViewportPanMode = "space" | "middle";

interface ViewportPanStart {
  pointerId: number;
  x: number;
  y: number;
  mode: ViewportPanMode;
}

export interface CanvasViewportControllerInput {
  viewportSurface: HTMLDivElement;
  stageStack: HTMLDivElement;
}

interface CanvasViewportControllerState {
  viewport: CanvasViewport;
  isSpacePressed: boolean;
  panStart: ViewportPanStart | null;
}

export function installCanvasViewportController(input: CanvasViewportControllerInput): void {
  const { viewportSurface, stageStack } = input;
  const state: CanvasViewportControllerState = {
    viewport: { x: 0, y: 0, scale: 1 },
    isSpacePressed: false,
    panStart: null,
  };

  installWheelZoom(viewportSurface, stageStack, state);
  installKeyboardPan(viewportSurface, state);
  installPointerPan(viewportSurface, stageStack, state);
  applyViewport(stageStack, state.viewport);
}

function installWheelZoom(
  viewportSurface: HTMLDivElement,
  stageStack: HTMLDivElement,
  state: CanvasViewportControllerState,
): void {
  viewportSurface.addEventListener("wheel", (event) => {
    event.preventDefault();

    const stageRect = stageStack.getBoundingClientRect();
    const zoomFactor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
    // WHY: 使用舞台布局原点作为坐标基准，避免 CSS transform 后的 rect 偏移破坏指针定点缩放。
    state.viewport = zoomViewportAtPoint(
      state.viewport,
      {
        x: event.clientX - stageRect.left + state.viewport.x,
        y: event.clientY - stageRect.top + state.viewport.y,
      },
      state.viewport.scale * zoomFactor,
    );
    applyViewport(stageStack, state.viewport);
  }, { passive: false });
  window.addEventListener("blur", () => clearPanMode(viewportSurface, state));
}

function installKeyboardPan(
  viewportSurface: HTMLDivElement,
  state: CanvasViewportControllerState,
): void {
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat || isInteractiveTarget(event.target)) {
      return;
    }

    event.preventDefault();
    state.isSpacePressed = true;
    viewportSurface.classList.add("is-panning-enabled");
  });

  window.addEventListener("keyup", (event) => {
    if (event.code !== "Space") {
      return;
    }

    if (state.panStart?.mode === "space") {
      clearPanMode(viewportSurface, state);
      return;
    }

    state.isSpacePressed = false;
    viewportSurface.classList.remove("is-panning-enabled");
  });
}

function installPointerPan(
  viewportSurface: HTMLDivElement,
  stageStack: HTMLDivElement,
  state: CanvasViewportControllerState,
): void {
  const onViewportPointerDown = (event: PointerEvent): void => {
    const isMiddleButton = event.button === 1;
    const isSpaceLeftDrag = state.isSpacePressed && event.button === 0;

    if (!isMiddleButton && !isSpaceLeftDrag) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    state.panStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mode: isSpaceLeftDrag ? "space" : "middle",
    };
    viewportSurface.setPointerCapture(event.pointerId);
    viewportSurface.classList.add("is-panning");
  };

  viewportSurface.addEventListener("pointerdown", onViewportPointerDown, { capture: true });

  viewportSurface.addEventListener("pointermove", (event) => {
    if (!state.panStart || state.panStart.pointerId !== event.pointerId) {
      return;
    }

    state.viewport = panViewport(state.viewport, {
      x: event.clientX - state.panStart.x,
      y: event.clientY - state.panStart.y,
    });
    state.panStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      mode: state.panStart.mode,
    };
    applyViewport(stageStack, state.viewport);
  });

  const stopPan = (event: PointerEvent): void => {
    if (!state.panStart || state.panStart.pointerId !== event.pointerId) {
      return;
    }

    state.panStart = null;
    viewportSurface.classList.remove("is-panning");
    if (viewportSurface.hasPointerCapture(event.pointerId)) {
      viewportSurface.releasePointerCapture(event.pointerId);
    }
  };

  viewportSurface.addEventListener("pointerup", stopPan);
  viewportSurface.addEventListener("pointercancel", (event) => {
    if (!state.panStart || state.panStart.pointerId !== event.pointerId) {
      return;
    }

    clearPanMode(viewportSurface, state, false);
  });
}

function applyViewport(stageStack: HTMLDivElement, viewport: CanvasViewport): void {
  // WHY: 视口变换只包裹舞台栈，保留 Fabric 自己的对象拖拽事件；取舍是平移/缩放不进入 Fabric viewportTransform。
  stageStack.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
}

function clearPanMode(
  viewportSurface: HTMLDivElement,
  state: CanvasViewportControllerState,
  releasePointerCapture = true,
): void {
  if (releasePointerCapture && state.panStart && viewportSurface.hasPointerCapture(state.panStart.pointerId)) {
    viewportSurface.releasePointerCapture(state.panStart.pointerId);
  }

  state.isSpacePressed = false;
  state.panStart = null;
  viewportSurface.classList.remove("is-panning-enabled", "is-panning");
}
