import { Graphics } from "pixi.js";
import { buildSphereWireframeSegments, type SphereMeshData } from "../domain/sphereMesh";
import type { BodySurfaceAnalysisDebugState, SkinMeshData } from "../domain/types";

export function createSkinWireframeSegments(mesh: SkinMeshData): Float32Array {
  const segments: number[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < mesh.indices.length; i += 3) {
    pushMeshEdge(segments, seen, mesh.positions, mesh.indices[i], mesh.indices[i + 1]);
    pushMeshEdge(segments, seen, mesh.positions, mesh.indices[i + 1], mesh.indices[i + 2]);
    pushMeshEdge(segments, seen, mesh.positions, mesh.indices[i + 2], mesh.indices[i]);
  }

  return new Float32Array(segments);
}

export function createBodyAnalysisDebugSegments(state: BodySurfaceAnalysisDebugState): Float32Array {
  const output: number[] = [];

  if (state.axis) {
    output.push(
      state.axis.origin.x,
      state.axis.origin.y,
      state.axis.origin.x + state.axis.direction.x * state.axis.length,
      state.axis.origin.y + state.axis.direction.y * state.axis.length,
    );
  }

  return new Float32Array(output);
}

export function drawActiveDebugMesh(graphics: Graphics, mesh: SkinMeshData | null): void {
  graphics.clear();
  if (!mesh) {
    return;
  }

  const segments = createSkinWireframeSegments(mesh);

  for (let i = 0; i < segments.length; i += 4) {
    graphics.moveTo(segments[i], segments[i + 1]);
    graphics.lineTo(segments[i + 2], segments[i + 3]);
  }

  graphics.stroke({ color: 0x834336, width: 1, alpha: 0.7 });
}

export function drawBodyAnalysisDebug(graphics: Graphics, state: BodySurfaceAnalysisDebugState | null): void {
  graphics.clear();
  if (!state) {
    return;
  }

  if (state.patchBounds) {
    graphics.rect(state.patchBounds.x, state.patchBounds.y, state.patchBounds.width, state.patchBounds.height);
    graphics.stroke({ color: state.source === "local-mesh" ? 0x2f80ed : 0xd56a4f, width: 1, alpha: 0.8 });
  }

  const segments = createBodyAnalysisDebugSegments(state);
  for (let i = 0; i < segments.length; i += 4) {
    graphics.moveTo(segments[i], segments[i + 1]);
    graphics.lineTo(segments[i + 2], segments[i + 3]);
  }
  if (segments.length > 0) {
    graphics.stroke({ color: state.source === "local-mesh" ? 0x2f80ed : 0xd56a4f, width: 2, alpha: 0.9 });
  }
}

export function createSphereWireframeSegments(mesh: SphereMeshData): Float32Array {
  return buildSphereWireframeSegments(mesh);
}

function pushMeshEdge(
  output: number[],
  seen: Set<string>,
  positions: Float32Array,
  first: number,
  second: number,
): void {
  const a = Math.min(first, second);
  const b = Math.max(first, second);
  const key = `${a}:${b}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);

  output.push(
    positions[a * 2],
    positions[a * 2 + 1],
    positions[b * 2],
    positions[b * 2 + 1],
  );
}
