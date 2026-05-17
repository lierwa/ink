import type { TattooTransform } from "./domain/types";

export interface FabricEditorState {
  left: number | undefined;
  top: number | undefined;
  width: number | undefined;
  height: number | undefined;
  scaleX: number | undefined;
  scaleY: number | undefined;
  angle: number | undefined;
  opacity: number | undefined;
}

export function fabricStateToTattooTransform(state: FabricEditorState): TattooTransform {
  const scaleX = state.scaleX ?? 1;
  const scaleY = state.scaleY ?? 1;

  return {
    x: state.left ?? 0,
    y: state.top ?? 0,
    scale: (scaleX + scaleY) / 2,
    rotation: degreesToRadians(state.angle ?? 0),
    opacity: state.opacity ?? 1,
  };
}

export function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}
