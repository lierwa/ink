# Local Surface Warp And Editor Flow Design

Date: 2026-05-19

## Goal

Replace the current local normal-offset tattoo fitting path with a more credible 2D-to-2.5D surface workflow, while fixing the editor asset flow so uploaded body and tattoo images can be edited, replaced, or removed without re-upload workarounds.

The design keeps the browser-only constraint and avoids heavy 3D reconstruction. It combines mature image deformation methods with mask-derived geometric proxies:

- Use mask boundary, distance field, local axis, and local width as the primary surface signal.
- Use TPS, MLS, or mesh warp as the tattoo deformation execution layer.
- Add an optional `shading geometry assist` switch that lets skin-region low-frequency shading influence curvature judgment only.
- Do not use skin shading for tattoo color blending in this phase.

## Decision Basis

This design follows established open source and computer vision practice:

- TPS / MLS / mesh warp are mature 2D image deformation techniques for smooth local remapping.
- Distance transforms and medial-axis-style local width estimates are standard binary-shape tools used to infer local structure from masks.
- Intrinsic-image and shape-from-shading research treats single-image shading as under-constrained, so shading is used only as a bounded auxiliary vote.

WHY: The current mesh is generated from a 2D skin mask, so mesh density mostly reflects sampling policy and boundary refinement, not real body curvature.

TRADE-OFF: A proxy-surface route will not recover true muscle or anatomical relief, but it gives controllable edge-turn and curved-surface behavior without requiring DensePose, SMPL, or a large model runtime.

## Non-Goals

- No tattoo color/light blending or skin-tone compositing.
- No DensePose, SMPL, or backend inference service.
- No attempt to identify muscles or fine anatomical bumps.
- No full rewrite of the upload modals beyond what is needed for edit, replace, and remove flows.
- No reliance on mesh density as the main curvature source.

## Current Problem

The current route builds a `localMeshSurface` normal texture and the shader offsets tattoo sampling by surface normal XY. Increasing fit strength mainly amplifies screen-space sampling offset, so the tattoo can appear narrower or shifted rather than mapped around a curved body surface.

The page flow also has asset lifecycle gaps:

- Uploaded tattoo images cannot be reopened for crop/mode adjustment.
- Removing a tattoo is not exposed as a first-class action.
- Selecting the same file may not reopen processing because file input `change` can be skipped.
- Body mesh parameters can only be adjusted during the upload modal flow, not from the current body asset.

## Proposed Architecture

Use three separate layers.

### 1. Asset Lifecycle Layer

Store enough source state to reopen editing modals without requiring the user to select files again.

Tattoo state:

```ts
interface TattooAssetState {
  texture: Texture;
  size: Size;
  dataUrl: string;
  sourceCanvas: HTMLCanvasElement;
  fileName: string;
  selectedMode: "original" | "line-art";
  cropRect: CropRect;
}
```

Body state:

```ts
interface BodySurfaceState {
  texture: Texture;
  sourceCanvas: HTMLCanvasElement;
  fileName: string;
  surfaceNormalTexture: Texture | null;
  placementRect: Rect;
  sourceSize: Size;
  mask: SkinMask;
  mesh: SkinMeshData;
  pipelineParams: BodyMeshPipelineParams;
  analysisDebug: BodySurfaceAnalysisDebugState | null;
  revision: number;
}
```

Required actions:

- Body: upload or replace, edit mesh, remove, show mesh.
- Tattoo: upload or replace, edit crop, remove.
- Surface: fit strength, shading geometry assist, debug/status.
- Transform: opacity, x, y, scale, rotation, reset transform.

WHY: Keeping source canvases and crop/parameter state makes editing reversible and avoids the current same-file re-upload workaround.

TRADE-OFF: State holds more canvas memory, but this is bounded to the active body and tattoo assets and avoids user-visible workflow friction.

### 2. Local Surface Descriptor Layer

Add a domain module that resolves a local proxy surface from current body data and tattoo placement.

```ts
interface LocalSurfaceDescriptorInput {
  mask: SkinMask;
  mesh: SkinMeshData;
  placementRect: Rect;
  tattooBounds: Rect;
  stageSize: Size;
  shadingAssist?: ShadingGeometryAssistInput;
}

interface LocalSurfaceDescriptor {
  source: "geometry" | "geometry-shading" | "insufficient";
  proxy: "ellipticalCylinder" | "ellipsoidPatch" | "curvedPlane" | "genericEdgeTurn";
  axis: SurfaceAxis;
  localBounds: Rect;
  localWidth: number;
  edgeTurn: number;
  curvature: {
    acrossAxis: number;
    alongAxis: number;
  };
  confidence: number;
  shading?: ShadingGeometryAssistDebug;
}
```

Processing steps:

1. Collect a tattoo-local mask/mesh patch.
2. Build or sample a local distance field inside the skin mask.
3. Estimate local axis and width from mask geometry and nearby mesh points.
4. Classify the proxy surface:
   - narrow local region -> `ellipticalCylinder`
   - broad smooth region -> `ellipsoidPatch` or `curvedPlane`
   - low-confidence region near boundary -> `genericEdgeTurn`
5. Compute bounded curvature and edge-turn strength.
6. Apply optional shading assist only if enabled and confident.

WHY: Distance-to-boundary and local width are stable geometric signals for edge turning and cylinder-like behavior, unlike mesh density.

TRADE-OFF: Local proxy classification is approximate, but it is deterministic, debuggable, and suitable for single-image browser editing.

### 3. Warp Execution Layer

Move the primary deformation from normal-offset sampling toward surface-coordinate remapping.

Execution options:

- Mesh warp: subdivide tattoo area and update UV/vertex mapping from the descriptor.
- MLS: use descriptor-derived control lines or points for local smooth deformation.
- TPS: use sparse control points for smooth global deformation inside the tattoo area.

Recommended first implementation:

```text
descriptor -> warp grid controls -> Pixi mesh UV remap
```

The fit strength slider should scale proxy-surface curvature and warp controls, not only multiply a normal XY pixel offset.

WHY: A UV/mesh remap can create a visible “turn around surface” effect; a normal-offset texture lookup mainly shifts or narrows the source sample.

TRADE-OFF: Mesh/UV remap introduces more renderer state and tests, but it aligns the implementation with mature 2D warp practice.

## Shading Geometry Assist

Add a UI switch named `光影曲面辅助` or `Shading geometry assist`.

Rules:

- Off by default if no body image is available.
- It only affects `LocalSurfaceDescriptor`.
- It never changes tattoo color, alpha, blend mode, or skin-light compositing.
- It is bounded to a small curvature adjustment, initially no more than 20% to 30%.
- It is ignored when confidence is low or when it strongly conflicts with geometry.

Processing:

```text
body source image + skin mask
-> low-frequency luminance field
-> local shading gradient
-> confidence from smoothness and contrast
-> agreement with geometry cross-axis
-> bounded curvature adjustment
```

Debug output:

```ts
interface ShadingGeometryAssistDebug {
  enabled: boolean;
  used: boolean;
  confidence: number;
  agreement: number;
  appliedStrength: number;
  reason?: "disabled" | "low-confidence" | "geometry-conflict" | "used";
}
```

WHY: Skin shading often hints at 3D orientation, but single-image shading is ambiguous because luminance also includes albedo, shadows, skin texture, camera processing, and existing marks.

TRADE-OFF: Treating shading as a weak vote prevents dramatic false curvature while still allowing the editor to validate whether shading improves edge and surface judgment.

## Editor Flow

Right panel grouping:

```text
Body
- Upload / Replace
- Edit mesh
- Remove
- Show body mesh

Tattoo
- Upload / Replace
- Edit crop
- Remove

Surface
- Fit strength
- 光影曲面辅助
- Debug status

Transform
- Opacity
- X / Y / Scale / Rotation
- Reset transform
```

State rules:

- Without tattoo: hide transform and surface controls that require a tattoo.
- With tattoo: `Edit crop` reopens the existing source canvas and restores previous crop/mode.
- `Remove tattoo` clears Fabric object, Pixi tattoo texture, local surface state, and transform panel.
- Choosing the same tattoo file after a previous upload must still reopen processing by clearing the file input value after handling.
- Body replacement keeps the current tattoo asset but recenters the tattoo to the new body placement by default.
- `Edit mesh` reopens the body modal from the stored body source canvas and current mesh params.
- `Remove body` returns to the default placeholder body and clears real skin mesh/debug state.
- Tattoo transform, fit strength, shading assist, body mesh edits, and tattoo crop edits trigger local surface recomputation.

## Error Handling

Body:

- Body upload cancel keeps the existing body.
- Mesh rebuild failure keeps the previous body and reports the modal error.
- Remove body returns to the default placeholder.
- Mesh failure may degrade only to a low-confidence `genericEdgeTurn` descriptor derived from the mask and distance field; status must show `mesh fallback`.

Tattoo:

- Tattoo upload cancel keeps the existing tattoo.
- Edit crop cancel keeps the previous tattoo.
- Remove tattoo fully clears tattoo render and editor controls.
- Near-transparent line-art output may still fall back to original.

Surface:

- Insufficient local mask/mesh patch returns `source: "insufficient"` and disables warp.
- Low-confidence shading returns geometry-only descriptor and debug reason `low-confidence`.
- Geometry conflict returns geometry-only or reduced shading strength and debug reason `geometry-conflict`.
- Fit strength remains clamped and cannot produce unbounded displacement or UV folding.

## Testing Strategy

All tests stay under the package-level `tests/` directory.

Domain tests:

- `tests/domain/localSurfaceDescriptor.test.ts`
  - narrow local masks produce `ellipticalCylinder`.
  - broad local masks produce `curvedPlane` or `ellipsoidPatch`.
  - edge regions produce stronger `edgeTurn`.
  - insufficient patches disable warp.
- `tests/domain/shadingGeometryAssist.test.ts`
  - disabled assist returns no curvature change.
  - low-confidence shading is ignored.
  - geometry-aligned shading applies bounded adjustment.
  - conflicting shading cannot reverse the geometry axis.

Workflow tests:

- Tattoo upload, edit crop, replace, remove.
- Same tattoo file can be selected again after processing.
- Body upload, edit mesh, replace, remove.
- Shading assist toggle triggers local surface recomputation.

Renderer tests:

- Fit strength affects warp controls, not only normal-offset shader scaling.
- Warp controls are clamped to prevent folding or extreme displacement.
- Debug state includes proxy type, shading status, confidence, and applied strength.

## Acceptance Criteria

- Uploaded tattoo can be edited without re-uploading the file.
- Uploaded tattoo can be removed cleanly.
- The same tattoo file can be selected again and still open the processing flow.
- Uploaded body mesh can be edited without re-uploading the body file.
- Body can be removed back to the placeholder state.
- Shading geometry assist can be toggled from the editor and never changes tattoo color blending.
- With assist disabled, local surface behavior is deterministic from mask/distance/axis geometry.
- With assist enabled, shading only changes curvature when confidence and geometry agreement are sufficient.
- Near body boundaries, tattoo deformation shows visible edge-turn behavior.
- Away from boundaries, tattoo shape remains comparatively stable.
- Increasing fit strength creates more curved-surface remap, not merely a narrower tattoo.
