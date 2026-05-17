import { describe, expect, test } from "vitest";
import {
  fabricStateToTattooTransform,
  type FabricEditorState,
} from "../../src/editorTransform";

describe("fabricStateToTattooTransform", () => {
  test("converts Fabric position, average scale, degrees, and opacity to the Pixi tattoo transform", () => {
    const state: FabricEditorState = {
      left: 420,
      top: 260,
      width: 320,
      height: 180,
      scaleX: 0.5,
      scaleY: 0.75,
      angle: 30,
      opacity: 0.68,
    };

    const transform = fabricStateToTattooTransform(state);

    expect(transform.x).toBe(420);
    expect(transform.y).toBe(260);
    expect(transform.scale).toBeCloseTo(0.625);
    expect(transform.rotation).toBeCloseTo(Math.PI / 6);
    expect(transform.opacity).toBeCloseTo(0.68);
  });

  test("uses safe defaults when Fabric fields are omitted", () => {
    const transform = fabricStateToTattooTransform({
      left: undefined,
      top: undefined,
      width: 320,
      height: 180,
      scaleX: undefined,
      scaleY: undefined,
      angle: undefined,
      opacity: undefined,
    });

    expect(transform).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
    });
  });
});
