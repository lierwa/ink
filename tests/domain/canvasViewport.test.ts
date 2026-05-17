import { describe, expect, test } from "vitest";
import {
  clampViewportScale,
  isInteractiveTarget,
  panViewport,
  zoomViewportAtPoint,
} from "../../src/domain/canvasViewport";
import type { CanvasViewport } from "../../src/domain/types";

describe("canvas viewport math", () => {
  test("clamps zoom scale to the supported range", () => {
    expect(clampViewportScale(0.05)).toBe(0.25);
    expect(clampViewportScale(1.5)).toBe(1.5);
    expect(clampViewportScale(8)).toBe(4);
  });

  test("pans by screen-space delta", () => {
    const viewport: CanvasViewport = { x: 10, y: 20, scale: 1.5 };

    expect(panViewport(viewport, { x: 4, y: -8 })).toEqual({
      x: 14,
      y: 12,
      scale: 1.5,
    });
  });

  test("zooms around the pointer while keeping the stage point under the cursor fixed", () => {
    const viewport: CanvasViewport = { x: 100, y: 50, scale: 1 };
    const next = zoomViewportAtPoint(viewport, { x: 300, y: 250 }, 2);

    expect(next).toEqual({
      x: -100,
      y: -150,
      scale: 2,
    });
  });
});

describe("canvas viewport interaction targets", () => {
  test("treats nested form controls and editable nodes as interactive targets", () => {
    expect(isInteractiveTarget(createClosestTarget({ controlSelector: "button" }))).toBe(true);
    expect(isInteractiveTarget(createClosestTarget({ controlSelector: "input" }))).toBe(true);
    expect(isInteractiveTarget(createClosestTarget({ controlSelector: "textarea" }))).toBe(true);
    expect(isInteractiveTarget(createClosestTarget({ controlSelector: "select" }))).toBe(true);
    expect(isInteractiveTarget(createClosestTarget({ contentEditable: "true" }))).toBe(true);
    expect(isInteractiveTarget(createClosestTarget({ contentEditable: "" }))).toBe(true);
    expect(isInteractiveTarget(createClosestTarget({ contentEditable: "plaintext-only" }))).toBe(true);
    expect(isInteractiveTarget(createClosestTarget({ contentEditable: "false" }))).toBe(false);
    expect(isInteractiveTarget(createClosestTarget({ controlSelector: "canvas" }))).toBe(false);
    expect(isInteractiveTarget({} as EventTarget)).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });
});

function createClosestTarget(options: {
  controlSelector?: string;
  contentEditable?: string;
}): EventTarget {
  return {
    closest(selector: string): Element | null {
      if (options.controlSelector && selector.includes(options.controlSelector)) {
        return {} as Element;
      }

      if (options.contentEditable !== undefined && selector === "[contenteditable]") {
        return {
          getAttribute(attribute: string): string | null {
            return attribute === "contenteditable" ? options.contentEditable ?? null : null;
          },
        } as Element;
      }

      return null;
    },
  } as unknown as EventTarget;
}
