import type { CanvasViewport, Point } from "./types";

export const minViewportScale = 0.25;
export const maxViewportScale = 4;

export function clampViewportScale(scale: number): number {
  return Math.min(Math.max(scale, minViewportScale), maxViewportScale);
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
