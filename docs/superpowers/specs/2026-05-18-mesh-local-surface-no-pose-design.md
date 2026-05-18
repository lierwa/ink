# Mesh Local Surface Without Pose Design

## Scope

Remove the MediaPipe Pose path completely and make tattoo deformation depend only on the skin mask, skin mesh, and the tattoo's current local position. Also restore the tattoo upload confirmation modal to a compact cropper UI.

## Decisions

- Delete Pose runtime code and assets: no `@mediapipe/tasks-vision`, no pose model files, no Pose landmarks, no green skeleton overlay.
- Treat the mesh as the primary surface signal. The current mesh is built from skin mask contours plus Poisson interior samples, so it is not true 3D curvature. The first mesh-first version will derive a local 2.5D surface from tattoo-local mask/mesh features: local bounds, boundary distance, local axis, and triangle scale.
- Recompute the active surface from the tattoo position instead of assigning one global surface at body upload time.
- Body Analysis will show only the active mesh-local surface used by the tattoo warp. It will not show Pose status or landmarks.
- The tattoo crop modal will remain backed by Cropper.js 2.x, but visually behave like a compact simple crop dialog with small handles and no giant editor area.

## Architecture

Body upload stores `mask`, `mesh`, `placementRect`, and image texture. Tattoo movement calls a mesh-local surface resolver that extracts a local patch around the tattoo bounding box and produces a `SurfaceFieldData` normal texture. Pixi samples that normal texture for warp. If the local patch is insufficient, the app reports `insufficient local mesh` and disables warp for that tattoo position; it does not switch to Pose, semantic regions, or any hidden alternate path.

## User-Facing Result

- Status examples:
  - `Surface: local mesh / curved / warp medium`
  - `Surface: local mesh / edge turn strong / warp strong`
  - `Surface: insufficient local mesh / warp disabled`
- Body Analysis overlay shows the current tattoo's local mesh patch, local axis, and warp strength heat/hint.
- Tattoo crop modal is compact, image-centered, and uses small corner/edge handles.
