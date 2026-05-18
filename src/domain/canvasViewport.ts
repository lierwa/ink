import type { CanvasViewport, Point } from "./types";

export const minViewportScale = 0.25;
export const maxViewportScale = 4;

export function clampViewportScale(scale: number): number {
  return Math.min(Math.max(scale, minViewportScale), maxViewportScale);
}

export function fitAspectRect(containerSize: { width: number; height: number }, aspectSize: { width: number; height: number }): {
  width: number;
  height: number;
} {
  if (containerSize.width <= 0 || containerSize.height <= 0 || aspectSize.width <= 0 || aspectSize.height <= 0) {
    return { width: Math.max(0, aspectSize.width), height: Math.max(0, aspectSize.height) };
  }

  const scale = Math.min(containerSize.width / aspectSize.width, containerSize.height / aspectSize.height);
  return {
    width: aspectSize.width * scale,
    height: aspectSize.height * scale,
  };
}

export function panViewport(viewport: CanvasViewport, delta: Point): CanvasViewport {
  return {
    x: viewport.x + delta.x,
    y: viewport.y + delta.y,
    scale: viewport.scale,
  };
}

export function zoomViewportAtPoint(
  viewport: CanvasViewport,
  point: Point,
  nextScale: number,
): CanvasViewport {
  const scale = clampViewportScale(nextScale);
  const stageX = (point.x - viewport.x) / viewport.scale;
  const stageY = (point.y - viewport.y) / viewport.scale;

  return {
    x: point.x - stageX * scale,
    y: point.y - stageY * scale,
    scale,
  };
}

const formControlSelector = "input, textarea, select, button";

export function isInteractiveTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => Element | null } | null;
  const editable = element?.closest?.("[contenteditable]");

  if (element?.closest?.(formControlSelector)) {
    return true;
  }

  if (!editable) {
    return false;
  }

  return editable.getAttribute("contenteditable")?.toLowerCase() !== "false";
}
