# Sphere Mesh Architecture Rewrite

Goal: replace the old tattoo-image mesh with a sphere-owned mesh. The tattoo is now only a sampled texture projected onto stable sphere geometry.

Architecture:
- Pixi owns rendering and draws a sphere-domain mesh generated from the ball geometry.
- The fragment shader inverse-maps each sphere point through the current tattoo transform and samples the tattoo texture only inside `[0, 1]` UV bounds.
- Fabric owns only the invisible selectable control image and emits transform changes.
- Image processing remains responsible for upload decode, alpha-aware white removal, transparent crop, and size normalization.
- Tests live under `tests/`.

Implementation checklist:
- [x] Add shared domain types.
- [x] Centralize tests under `tests/`.
- [x] Replace image-domain geometry with `buildSphereMesh`.
- [x] Add pure tattoo inverse projection math.
- [x] Move Pixi setup into `src/render/pixiRenderer.ts`.
- [x] Move Fabric setup into `src/editor/fabricController.ts`.
- [x] Move image processing into `src/image/imageProcessing.ts`.
- [x] Rebuild app orchestration in `src/app.ts`.
- [x] Keep `src/main.ts` as a thin Vite entrypoint.
- [x] Delete old `src/geometry.ts`.
