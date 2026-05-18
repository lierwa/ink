# Pose + Geometry Body Surface Design

Date: 2026-05-18

## Goal

Replace the current depth-first tattoo fitting route with a short-term browser-only body surface route:

- Do not ask users to specify body parts.
- Use local MediaPipe Pose to infer body structure when landmarks are available.
- Support cropped local body photos by falling back to mask/mesh geometry classification.
- Keep all inference on the frontend; do not require a server or GPU service.
- Treat ordinary depth estimation as optional support, not the primary fitting signal.
- Preserve the existing skin mask, skin mesh, Pixi renderer, and fallback behavior where possible.

## Decision Basis

Use mature open source and official model APIs:

- MediaPipe Pose Landmarker for body landmarks in browser images. The official task outputs image coordinates and 3D world landmarks, and provides Lite, Full, and Heavy model variants.
- MediaPipe Image Segmenter remains a valid skin/body mask source through `@mediapipe/tasks-vision`.
- Existing project geometry stack remains in place: `marchingsquares`, `simplify-js`, `poisson-disk-sampling`, `cdt2d`, and Pixi mesh rendering.

WHY: Tattoo fitting needs body structure and local surface coordinates. Pose landmarks provide stable anatomical anchors without the hardware cost of DensePose/SMPL, while existing mesh geometry provides a useful fallback for cropped images where landmarks are incomplete.

TRADE-OFF: MediaPipe Pose does not output real DensePose IUV coordinates. This design produces local surface coordinates from primitives, so it improves short-term fitting but remains an approximation until a DensePose/IUV adapter is added later.

## Confirmed Scope

In scope:

- Local `public/models` model loading strategy.
- One-shot body photo processing on upload/apply.
- Pose-driven body region classification.
- Geometry-driven fallback classification for cropped photos.
- Surface primitive generation for local `surfaceU`, `surfaceV`, normal, and curvature.
- Renderer-compatible normal texture output.
- Conservative fallback to the current mask/distance surface path.

Out of scope:

- Backend inference service.
- DensePose/IUV integration.
- SMPL or SMPL-X mesh reconstruction.
- Per-frame video processing.
- Asking the user to manually label the body part.

## Current Repository Fit

The existing app already has the right lower layers:

- `src/domain/skinMeshPipeline.ts` builds a mixed-density skin mesh from a mask.
- `src/domain/surfaceField.ts` builds a normal texture from mask distance and optional depth.
- `src/render/pixiRenderer.ts` renders tattoo projection through mesh UVs and a surface normal texture.
- `src/app.ts` applies body uploads and currently calls depth estimation before surface field generation.

The short-term change should insert a body surface semantics layer between skin mesh generation and surface normal texture generation.

Current route:

```text
upload image
-> skin mask
-> skin mesh
-> depth estimate
-> mask/depth surface normal texture
-> Pixi shader warp
```

Target route:

```text
upload image
-> local MediaPipe Pose
-> skin mask
-> skin mesh
-> body region classification
-> surface primitive fit
-> primitive surface field
-> Pixi shader warp
```

Depth remains available only as a low-weight detail signal or legacy fallback.

## Proposed Modules

### `src/domain/bodyPose.ts`

Responsibilities:

- Wrap MediaPipe Pose Landmarker lifecycle.
- Load local model assets from `public/models`.
- Normalize landmarks into project-owned data contracts.
- Keep UI and DOM concerns out of the domain API.

Output:

```ts
BodyPoseEstimate {
  landmarks: BodyPoseLandmark[];
  worldLandmarks?: BodyPoseWorldLandmark[];
  confidence: number;
  source: "mediapipe";
}
```

Model defaults:

```text
public/models/pose_landmarker_lite.task
public/models/tasks-vision/wasm/
```

WHY: Pose Lite is the conservative default because this workflow needs coarse anatomical anchors, not high-frequency motion tracking.

TRADE-OFF: Lite may be less accurate than Full/Heavy on hard poses, but it lowers frontend cold start, memory pressure, and upload-time latency.

### `src/domain/bodyRegionClassifier.ts`

Responsibilities:

- Classify the current skin region using pose landmarks when available.
- Fall back to geometry-only classification for cropped images.
- Return a confidence score and the data source used.

Pose-driven candidates:

- `leftUpperArm`: left shoulder to left elbow
- `leftForearm`: left elbow to left wrist
- `rightUpperArm`: right shoulder to right elbow
- `rightForearm`: right elbow to right wrist
- `leftTorso`: left shoulder to left hip
- `rightTorso`: right shoulder to right hip
- `shoulderChest`: shoulder line and upper torso band

Scoring:

```text
score =
  mask/body-part capsule overlap
  + principal-axis alignment
  + proximity to relevant landmarks
  + landmark visibility
  - ambiguity penalty
```

Output:

```ts
BodyRegionClassification {
  region: "upperArm" | "forearm" | "torso" | "shoulderChest" | "limbLike" | "generic";
  side?: "left" | "right";
  source: "pose" | "geometry" | "generic";
  confidence: number;
  axis: SurfaceAxis;
  landmarksUsed: string[];
}
```

### `src/domain/bodyGeometryClassifier.ts`

Responsibilities:

- Classify cropped or partial images when Pose is missing or incomplete.
- Use only mask, mesh, and contour-derived measurements.

Geometry signals:

- Principal axis and eigenvalue ratio.
- Mask aspect ratio.
- Width profile along the principal axis.
- Boundary parallelism.
- Boundary curvature concentration.
- Convexity/area ratio.

Classification rules:

- `limbLike`: clear long axis, high aspect ratio, smooth width profile, roughly parallel sides.
- `torso`: wide region, weak single axis, low edge wrap requirement.
- `shoulderChest`: asymmetric curvature concentration and broad-to-narrow transition.
- `generic`: insufficient confidence for a stronger primitive.

WHY: Cropped arm or shoulder photos may not contain enough landmarks for Pose. Geometry fallback keeps the product useful without pretending to know a precise anatomical label.

TRADE-OFF: Geometry fallback infers surface type, not true body part identity. Therefore it must output lower confidence and use conservative warp limits.

### `src/domain/bodySurfacePrimitive.ts`

Responsibilities:

- Convert classification into a local surface descriptor.
- Generate local `surfaceU`, `surfaceV`, normal, and curvature fields.
- Avoid dependence on depth model semantics.

Descriptor:

```ts
BodySurfaceDescriptor {
  model: "cylinder" | "capsule" | "ellipsoid" | "blendedEllipsoid" | "generic";
  source: "pose" | "geometry" | "generic";
  confidence: number;
  axis: SurfaceAxis;
  curvature: {
    alongAxis: number;
    acrossAxis: number;
    edgeWrap: number;
  };
  handedness?: "left" | "right";
}
```

Primitive mapping:

- `upperArm` / `forearm` / `limbLike` -> cylinder or capsule.
- `torso` -> broad ellipsoid or curved plane.
- `shoulderChest` -> blended ellipsoid.
- `generic` -> improved distance-field surface with strict warp limits.

### `src/domain/bodySurfacePipeline.ts`

Responsibilities:

- Orchestrate pose estimation, classification, primitive fitting, and fallback.
- Return renderer-facing surface data and a summary for status/debug UI.

Pipeline:

```text
pose estimate
-> pose-driven region classification
-> geometry fallback if pose confidence is low
-> primitive descriptor
-> primitive normal texture and optional mesh UVs
-> legacy fallback if primitive generation fails
```

Output:

```ts
BodySurfaceBuildResult {
  surfaceField: SurfaceFieldData;
  mesh: SkinMeshData;
  summary: BodySurfaceSummary;
}

BodySurfaceSummary {
  region: string;
  source: "pose" | "geometry" | "generic" | "legacy";
  confidence: number;
  warning?: string;
}
```

## Data Flow

1. User uploads body photo.
2. App resizes processing image to the existing skin mesh long-edge budget.
3. Pose service loads local Pose Lite model and runs once for the image.
4. Existing skin segmentation/fallback creates `SkinMask`.
5. Existing skin mesh pipeline creates `SkinMeshData`.
6. Region classifier tries pose-driven classification.
7. If pose is missing or ambiguous, geometry classifier estimates a surface type.
8. Primitive builder creates a surface descriptor.
9. Surface field builder emits a normal texture compatible with the current renderer.
10. App stores `BodySurfaceSummary` and renders status.
11. Tattoo transform edits remain realtime and never re-run MediaPipe.

## Renderer Strategy

Phase 1 keeps renderer contracts stable:

- Continue emitting `SurfaceFieldData.normalRgba`.
- Continue creating `surfaceNormalTexture` with `createSurfaceNormalTexture`.
- Continue using existing `uSurfaceNormalTex` shader path.
- Optionally update `SkinMeshData.uvs` with primitive-local surface UVs when valid.

Phase 2 can add an optional parameter texture:

```text
surfaceParamTexture:
  R = curvature across axis
  G = curvature along axis
  B = edge wrap
  A = confidence
```

Phase 2 is intentionally not required for the first implementation plan.

## Fallback Rules

Fallback order is deterministic:

1. Pose classification confidence `>= 0.65`
   - Use pose-driven primitive.
2. Pose is unavailable or ambiguous, geometry confidence `>= 0.45`
   - Use geometry-driven conservative primitive.
3. Geometry confidence `< 0.45`
   - Use generic primitive with strict warp limit.
4. Primitive surface generation throws or outputs invalid values
   - Use existing mask/distance `surfaceField` path.
5. Skin mesh generation fails
   - Keep existing rectangle/full-image fallback.

No fallback may silently overwrite the current state without an explicit `BodySurfaceSummary`.

## Model Asset Strategy

Use local project assets by default:

```text
public/models/pose_landmarker_lite.task
public/models/selfie_multiclass_256x256.tflite
public/models/tasks-vision/wasm/
```

The current repository only contains depth ONNX files under `public/models`, so the implementation plan must include localizing MediaPipe model and wasm assets or adding clear setup checks.

No CDN fallback is part of the confirmed short-term scope.

## Frontend Hardware Cost

Upload/apply cost:

- One MediaPipe Pose inference.
- One skin segmentation or fallback mask extraction.
- One skin mesh build.
- One primitive surface field build.

Realtime editing cost:

- No model inference.
- No remeshing.
- Pixi/Fabric transform updates only.

Main-thread risk:

- MediaPipe Web `detect()` style calls are synchronous and can block the UI thread.
- First implementation should encapsulate Pose behind a service boundary.
- Worker migration should be possible without changing classifier or surface primitive contracts.

## Error Handling

Errors should be reported in terms useful for debugging:

- Missing pose model asset.
- Pose model load failure.
- Pose detected no usable landmarks.
- Pose classification ambiguous.
- Geometry fallback confidence too low.
- Primitive surface invalid.
- Legacy fallback used.

The user-facing status text should remain concise:

```text
applied body surface: forearm / pose / 82%
applied body surface: limb-like / geometry / 58%
applied body surface: generic fallback
```

## Testing Strategy

All tests stay under package-level `tests/`.

Recommended tests:

- `tests/domain/bodyRegionClassifier.test.ts`
  - Mock landmarks and masks for upper arm, forearm, torso, and ambiguity.
- `tests/domain/bodyGeometryClassifier.test.ts`
  - Limb-like, torso-like, shoulder-like, and generic mask shapes.
- `tests/domain/bodySurfacePrimitive.test.ts`
  - Cylinder, capsule, ellipsoid, and generic descriptors produce finite normals and bounded curvature.
- `tests/domain/bodySurfacePipeline.test.ts`
  - Pose success, Pose failure, geometry fallback, and legacy fallback paths.
- `tests/render/pixiRenderer.test.ts`
  - Existing mesh UV and normal texture contracts remain valid.

Tests must not load real MediaPipe models. Use injected adapters and deterministic mock pose estimates.

## Acceptance Criteria

- Uploading a complete or half-body image automatically chooses a plausible pose-driven surface region.
- Uploading a cropped limb/shoulder/torso image still produces a geometry-driven surface when Pose is incomplete.
- Users are never asked to manually specify the body part.
- Dragging, scaling, or rotating the tattoo does not rerun MediaPipe.
- The app works without a backend or GPU inference server.
- Missing local model assets produce an actionable error or controlled fallback.
- The existing legacy surface path remains available as a final fallback.
- Verification commands pass after implementation: `bun run test`, `bun run typecheck`, `bun run build`.

## Implementation Notes For Later Plan

Suggested implementation sequence:

1. Add type contracts for pose, classification, descriptor, and summary.
2. Add classifier tests using mock landmarks and masks.
3. Implement pose-driven classification.
4. Add geometry fallback classifier.
5. Implement primitive descriptor and normal generation.
6. Integrate the pipeline into `applyBodySurfaceResult`.
7. Localize model asset configuration and setup checks.
8. Add status summary and verification.

## Spec Self-Review

- Placeholder scan: no unresolved placeholders are present.
- Consistency check: module contracts align with the target data flow and current renderer contract.
- Scope check: this is one frontend subsystem and does not include DensePose, SMPL, or backend inference.
- Ambiguity check: user body-part input is explicitly out of scope; local MediaPipe model loading is the confirmed resource strategy.
