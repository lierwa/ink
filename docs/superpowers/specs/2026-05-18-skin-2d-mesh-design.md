# Skin 2D Mesh Design

Date: 2026-05-18

## Goal

Implement robust 2D mesh generation for skin regions in a single uploaded image, fully in-browser, with automatic skin segmentation and mixed-density triangulation:

- Interior triangles should be roughly uniform.
- Boundary triangles should be denser to preserve contour detail.
- The pipeline must be real-time enough for interactive editing in the current Pixi/Fabric app.

## Confirmed Scope

Approved constraints from brainstorming:

- Runtime target: frontend real-time workflow.
- Input mode: single image upload (not per-frame video).
- Skin region source: automatic segmentation.
- Mesh style: mixed density (interior more uniform + boundary adaptive refinement).

## Open Source First Decisions

Use mature libraries for each specialized capability:

- Segmentation: `@mediapipe/tasks-vision` (Image Segmenter)
- Contour extraction: `marchingsquares` (or OpenCV.js as heavier alternative)
- Polyline simplification: `simplify-js`
- Interior sampling: `poisson-disk-sampling`
- Constrained triangulation: `cdt2d`
- Rendering: existing `pixi.js` mesh path

WHY: Each step maps to a well-understood problem with established ecosystem solutions; this avoids self-building fragile geometry/CV infrastructure.

TRADE-OFF: Introducing multiple focused dependencies increases integration work, but substantially reduces algorithmic risk and long-term maintenance burden versus custom implementations.

## Proposed Architecture

Add a dedicated 2D skin-mesh domain pipeline parallel to the existing sphere mesh domain:

1. `ImageSegmenter`: run skin segmentation and output probability/class map.
2. `MaskPostProcess`: threshold + morphology + connected-component cleanup.
3. `ContourExtractor`: extract major contour loops and resample adaptively by curvature.
4. `InteriorSampler`: generate Poisson points with boundary-band densification.
5. `ConstrainedTriangulator`: run CDT with contour edges as hard constraints.
6. `MeshOptimizer`: light local quality cleanup while keeping boundary vertices fixed.
7. `RendererAdapter`: emit buffers consumable by existing Pixi renderer.

## Module Design (Repository-Aligned)

### `src/domain/skinSegmentation.ts`

Responsibilities:

- Encapsulate MediaPipe model lifecycle and inference API.
- Expose deterministic `segmentSkin(image)` contract.

Output:

- `SkinMask { width, height, probs }`

### `src/domain/skinMaskProcess.ts`

Responsibilities:

- Convert `SkinMask` to binary mask.
- Apply morphological open/close and remove tiny isolated regions.

Output:

- `BinaryMask { width, height, data }`

### `src/domain/skinContour.ts`

Responsibilities:

- Extract outer/inner loops from binary mask.
- Simplify loop points and perform curvature-aware resampling.

Output:

- `ContourSet` (`ContourLoop[]`, each loop marks hole/non-hole)

### `src/domain/skinSampling.ts`

Responsibilities:

- Poisson sample interior with radius `r_inner`.
- Add denser sampling in boundary band (`w_band`, `r_band`).

Output:

- `SamplePoint[]`

### `src/domain/skinMesh.ts`

Responsibilities:

- Build constrained edges from contour loops.
- Run CDT, filter invalid faces, apply optional light smoothing/collapse.

Output:

- `SkinMeshData { positions, indices, boundaryFlags? }`

### `src/render/pixiRenderer.ts` (incremental update)

Responsibilities:

- Reuse mesh upload/render path for skin mesh.
- Support debug wireframe mode for QA and parameter tuning.

## Data Contracts

Add and reuse concise types in `src/domain/types.ts`:

- `SkinMask { width: number; height: number; probs: Float32Array }`
- `BinaryMask { width: number; height: number; data: Uint8Array }`
- `ContourLoop { points: Point[]; isHole: boolean }`
- `SkinMeshResolution { innerRadius: number; boundaryBandWidth: number; boundaryRadius: number }`
- `SkinMeshData { positions: Float32Array; indices: Uint32Array; boundaryFlags?: Uint8Array }`

Single orchestration entry:

- `buildSkinMeshFromImage(input): Promise<SkinMeshData>`

Pipeline order is fixed:

`segment -> postProcess -> extractContour -> sampleInterior -> triangulateCDT -> optimize`

## Detailed Data Flow

1. Resize upload to working resolution (recommended long edge: `1024`).
2. Run segmentation and obtain skin probability map.
3. Apply post-processing to produce stable binary skin mask.
4. Extract dominant skin contour loops and resample adaptively.
5. Generate mixed-density sample points (interior + boundary band).
6. Run constrained triangulation.
7. Apply lightweight optimization (1-2 rounds max).
8. Emit typed arrays and render.

## Failure Handling and Fallbacks

Mandatory fallbacks:

- Segmentation returns empty/invalid mask:
  - switch to manual region selection mode and prompt user.
- Contour has too few valid points:
  - block meshing and show actionable error.
- CDT fails due to degeneracy/self-intersection:
  - retry once with looser simplification;
  - then degrade to Earcut fallback mesh as last resort.
- Runtime exceeds budget:
  - auto-increase `r_inner`, reduce boundary density, and regenerate.

No failure path may silently overwrite current editing state.

## Initial Parameter Baseline

Use these as default tuning values:

- `maskThreshold = 0.55`
- `contourSimplifyEps = 1.2px`
- `boundaryStepMin = 3px`
- `boundaryStepMax = 10px`
- `r_inner = 14px`
- `w_band = 24px`
- `r_band = 8px`
- quality target: minimum triangle angle around `24°`

## Performance Budget

Target for 1024-long-edge working image on typical desktop:

- Segmentation: `20~45ms`
- Post-process + contour: `5~15ms`
- Sampling + CDT + optimize: `10~35ms`
- End-to-end target: `40~95ms`

This is sufficient for single-image interactive tuning workflow.

## Validation Metrics

Mesh quality acceptance indicators:

- Boundary Hausdorff error under `2px` at working resolution.
- Boundary-band triangle area around `0.4~0.6` of interior average.
- No degenerate triangles below minimum area threshold.
- All triangle centroids remain inside binary mask domain.

## Testing Strategy

All tests stay in package-level `tests/` hierarchy:

- `tests/domain/skinMaskProcess.test.ts`
  - threshold/morphology/component filtering determinism
- `tests/domain/skinContour.test.ts`
  - non-self-intersection + curvature-density behavior
- `tests/domain/skinSampling.test.ts`
  - minimum distance and boundary density assertions
- `tests/domain/skinMesh.test.ts`
  - in-mask faces, non-degenerate triangles, boundary constraints
- `tests/render/pixiRenderer.test.ts`
  - buffer size/reference validity, no out-of-range index usage

## Incremental Delivery Plan

Milestone sequence:

1. Types + mask post-process + tests
2. Contour extraction/resampling + tests + wireframe preview
3. Interior sampling + tests
4. CDT integration + mesh validity tests
5. Renderer integration and tuning controls
6. Fallback and performance adaptation hardening

## Non-Goals

- No per-frame video meshing in this phase.
- No backend inference dependency in this phase.
- No custom in-house triangulation engine.
- No replacement of existing sphere projection pipeline.

## Acceptance Criteria

- Uploading a portrait-like image automatically generates skin mesh within budget.
- Mesh visually preserves neck/shoulder contour with denser boundary detail.
- Interior triangles are relatively uniform without visible clumping.
- Failure scenarios present deterministic fallback behavior.
- Tests pass: `bun run test`, `bun run typecheck`, `bun run build`.
