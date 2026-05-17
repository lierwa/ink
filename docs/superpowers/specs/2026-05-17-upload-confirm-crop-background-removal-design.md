# Upload Confirm Crop Background Removal Design

Date: 2026-05-17

## Goal

Add a post-upload confirmation workflow so an uploaded tattoo image is processed, previewed, cropped, and explicitly confirmed before it replaces the current tattoo on the sphere.

The workflow must improve background removal for tattoo flash images while preserving the current sphere projection architecture:

- Tattoo projection quality remains per-pixel in the Pixi shader.
- Surface grid density is a debug and boundary precision control, not a tattoo quality control.
- Upload failures, stale async requests, or Cancel actions must not change the current tattoo.

## Product Decisions

The approved decisions are:

- Use a `Confirm Tattoo Effect` modal after upload.
- Run background removal before crop preview.
- Default crop box covers the full processed image.
- Crop box is a free rectangle, not locked to square.
- Include processing mode controls inside the modal.
- Accept `@imgly/background-removal` as the local AI background removal dependency, including its AGPL-3.0 license implications.
- Keep the current per-pixel sphere projection model. Mesh density must not be used to make tattoo fitting better or worse.

## User Flow

```text
User selects image file
  -> App starts local image processing
  -> App runs AI background removal by default
  -> App opens Confirm Tattoo Effect modal
  -> User previews transparent result on checkerboard
  -> User freely adjusts crop rectangle
  -> User optionally switches processing mode
  -> User clicks Add or Cancel
```

`Cancel` closes the modal and leaves the current tattoo unchanged.

`Add` exports the cropped transparent result and then replaces the active tattoo through the existing Pixi/Fabric flow.

## Confirmation Modal

The modal follows the structure of the reference screenshot:

- Title: `Confirm Tattoo Effect`
- Subtitle: `Drag crop box to select area`
- Central checkerboard preview for transparency
- Free rectangular crop box with drag and resize handles
- Live crop size label, for example `448 x 448`
- Preview zoom controls: `100%`, `75%`, `50%`
- Processing mode controls:
  - `AI Remove Background`
  - `Line Art Cleanup`
  - `Original`
- Footer buttons:
  - `Cancel`
  - `Add`

Preview zoom only changes modal display scale. It must not change the exported pixel dimensions or final texture scale.

The crop rectangle starts at the processed image bounds. Users can shrink, move, or resize it freely as a rectangle.

## Image Processing Modes

### AI Remove Background

Default mode.

Use `@imgly/background-removal` in the browser. It must run locally and must not upload the image to a service. The app should show a loading state during the first model load and during processing.

If AI processing fails, the modal should show a clear error and allow the user to switch to `Line Art Cleanup` or `Original`. It must not clear or replace the current tattoo.

### Line Art Cleanup

Fallback and optional mode for tattoo flash artwork.

This mode improves the existing white-background removal behavior. It should preserve black and gray linework while removing paper-like backgrounds, including near-white, light gray, and antialiased edge pixels.

The goal is not general object segmentation. It is a fast local cleanup path for line art.

### Original

This mode preserves the uploaded pixels and only allows cropping. It is useful when the uploaded image already has transparency or when automatic cleanup removes too much detail.

## Crop Export

When the user clicks `Add`, the app exports the selected crop rectangle into a new transparent canvas:

- The output canvas dimensions match the crop rectangle in source pixels.
- Alpha is preserved.
- Transparent pixels remain transparent.
- The export is passed into the current tattoo replacement pipeline.

The app should continue to normalize very large images to a reasonable max content size, but crop export must be based on the processed preview image shown in the modal.

## App State And Async Safety

The existing upload safety rules remain required:

- Current tattoo state changes only after the user clicks `Add`.
- Current tattoo state changes only after Fabric accepts the new control image.
- `Cancel` is a no-op for the current tattoo.
- Upload or processing failure is a no-op for the current tattoo.
- Stale async processing must not overwrite a newer upload, newer modal result, current status text, current Fabric image, or current Pixi texture.
- If the user changes transform while processing is pending, the confirmed tattoo must use the latest transform and must not snap back to an older transform.

The modal maintains its own draft state. Only `Add` commits draft state into `AppState`.

## Sphere Mesh And Projection Semantics

The current projection model is retained:

- The sphere mesh defines the visible surface domain.
- The shader computes tattoo UV per pixel from the sphere point and current tattoo transform.
- Tattoo fitting quality does not depend on mesh density.

This is intentional. The product goal is a smooth tattoo preview that follows the sphere surface, not a low-poly deformation preview.

Mesh controls should be renamed or clarified so users do not expect them to affect tattoo fitting quality:

- Group label: `Surface Grid`
- Inputs:
  - `Radial Lines`
  - `Angular Lines`
- Helper text:
  - `Tattoo projection is calculated per pixel. Grid density affects debug lines and surface boundary precision.`

The debug mesh overlay remains useful for inspecting the surface and future non-sphere object meshes.

## Architecture

Add focused modules instead of expanding `app.ts`.

Proposed modules:

- `src/image/backgroundRemoval.ts`
  - Wraps `@imgly/background-removal`.
  - Converts input canvas/blob to a transparent canvas result.
  - Provides explicit error reporting.

- `src/image/lineArtCleanup.ts`
  - Contains improved white/paper background cleanup.
  - Pure image-data operations where practical.

- `src/editor/uploadConfirmModal.ts`
  - Owns modal DOM, preview canvas, crop interactions, processing mode selection, and Add/Cancel.
  - Returns a confirmed cropped canvas or `null`.

- `src/image/cropCanvas.ts`
  - Pure crop/export helper for canvas regions.

- `src/app.ts`
  - Orchestrates upload selection.
  - Opens modal.
  - Commits confirmed cropped canvas through the existing replacement flow.

Existing modules remain responsible for their current jobs:

- `src/render/pixiRenderer.ts` continues to render sphere projection.
- `src/editor/fabricController.ts` continues to provide transform controls.
- `src/domain/sphereMesh.ts` continues to own surface mesh generation.
- `src/domain/tattooProjection.ts` continues to own projection math parity with the shader.

## Error Handling

The modal should handle these states:

- Loading AI model
- Processing image
- Processing failed
- Processing succeeded
- Crop export failed

Failure behavior:

- Show status in the modal.
- Keep the current canvas tattoo unchanged.
- Allow switching to another processing mode where possible.
- Allow Cancel at all times.

## Testing

Add or update tests under `tests/`.

Required coverage:

- Crop export returns the expected dimensions.
- Crop export preserves alpha.
- `Cancel` does not commit a new tattoo.
- `Add` commits only the cropped canvas.
- Processing failure does not clear current tattoo state.
- Stale processing results cannot overwrite newer upload state.
- Line art cleanup preserves semi-transparent and dark line pixels.
- Surface grid labels and behavior do not imply tattoo projection quality control.
- Existing sphere mesh, projection, image processing, Fabric transform, and renderer tests continue to pass.

AI model behavior itself should be wrapped behind an interface so unit tests can mock success and failure without loading the model.

## Non-Goals

- Do not replace the per-pixel projection shader with per-vertex deformation.
- Do not make mesh density control tattoo fitting quality.
- Do not add server-side upload or processing.
- Do not require a square crop.
- Do not commit uploaded images before the user clicks `Add`.

## Acceptance Criteria

- Uploading the skull/rose reference image produces a transparent preview without the black square artifact.
- The modal resembles the provided reference workflow closely enough: checkerboard preview, crop box, size label, zoom choices, Cancel/Add.
- The user can freely crop a rectangle before adding the tattoo.
- The current tattoo remains unchanged until `Add`.
- `Cancel`, failed processing, and stale async work leave the current tattoo unchanged.
- Mesh controls are clearly described as surface/debug controls, not tattoo fitting controls.
- Changing mesh density does not materially change tattoo projection quality.
- `bun run test`, `bun run typecheck`, and `bun run build` pass after implementation.
