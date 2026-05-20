# Visible Tattoo Warp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tattoo curvature visibly driven by body local surface while keeping tattoo's own regular TPS mesh as the render geometry.

**Architecture:** Body mesh provides local surface descriptors; tattoo owns a regular UV grid that TPS bends. Warp strength is app state controlled by a slider and shading assist remains a weak curvature multiplier only.

**Tech Stack:** TypeScript, PixiJS MeshGeometry, Thin Plate Spline transformer, Vitest.

---

### Task 1: Make regular TPS tattoo grid the primary mesh

**Files:**
- Modify: `src/domain/tattooWarpMesh.ts`
- Test: `tests/domain/tattooWarpMesh.test.ts`

- [ ] Add failing tests asserting bodyMesh input still returns regular grid vertex count and that `warpStrength` changes displacement.
- [ ] Run `rtk npm test -- tests/domain/tattooWarpMesh.test.ts` and confirm the new test fails.
- [ ] Add `warpStrength?: number` to `TattooWarpMeshInput`, clamp it to `0..2`, scale TPS amplitudes with it, and remove body patch priority from the main return path.
- [ ] Re-run `rtk npm test -- tests/domain/tattooWarpMesh.test.ts`.

### Task 2: Add app state and UI slider

**Files:**
- Modify: `src/appMarkup.ts`
- Modify: `src/app.ts`
- Test: `tests/app.test.ts`

- [ ] Add failing markup test for `#warpStrength` and value label.
- [ ] Add failing integration test that changing warp strength increases generated displacement.
- [ ] Run `rtk npm test -- tests/app.test.ts` and confirm the new tests fail.
- [ ] Add `warpStrength` to app state, app elements, sync, and transform controls.
- [ ] Pass `warpStrength` into `buildTattooWarpMesh`.
- [ ] Re-run `rtk npm test -- tests/app.test.ts`.

### Task 3: Verify renderer and full build

**Files:**
- Verify: `tests/render/pixiRenderer.test.ts`
- Verify: `tests/domain/localMeshSurface.test.ts`
- Verify: `src/render/pixiRenderer.ts`

- [ ] Run `rtk npm test -- tests/render/pixiRenderer.test.ts tests/domain/tattooWarpMesh.test.ts tests/domain/localMeshSurface.test.ts tests/app.test.ts`.
- [ ] Run `rtk npm run typecheck`.
- [ ] Run `rtk npm run build`.
