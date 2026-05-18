# Mesh Local Surface Without Pose - 1 Hour Execution Plan

> **Execution mode:** inline execution only. No subagents, no per-step review loop. Keep this within one focused hour unless a compile blocker appears.

**Goal:** Delete Pose/MediaPipe, use tattoo-local skin mesh as the only warp basis, and make the tattoo upload modal compact.

**Time budget:** 60 minutes max.

---

## 0-10 min: Remove Pose Path

- [ ] Remove `@mediapipe/tasks-vision` from dependencies and lockfiles.
- [ ] Delete Pose assets:
  - `public/models/pose_landmarker_lite.task`
  - `public/models/tasks-vision/`
- [ ] Delete Pose source/test files:
  - `src/domain/bodyPose.ts`
  - `tests/domain/bodyPose.test.ts`
- [ ] Remove imports/usages of:
  - `estimateBodyPose`
  - `mapBodyPoseToPlacementRect`
  - `poseStatus`
  - `poseLandmarkCount`
  - `poseWarning`
  - `landmarks`

Acceptance:
- `rg "mediapipe|bodyPose|poseStatus|poseLandmark|landmarks|pose missing" src tests public package.json` shows no active runtime path.

---

## 10-30 min: Replace Surface Source With Tattoo-Local Mesh

- [ ] Add `src/domain/localMeshSurface.ts`.
- [ ] Input: `mask`, `mesh`, `placementRect`, `stageSize`, `tattooBounds`.
- [ ] Output: `surfaceField` and mesh-only debug state:

```ts
export interface BodySurfaceAnalysisDebugState {
  source: "local-mesh" | "insufficient-mesh";
  confidence: number;
  axis?: SurfaceAxis;
  patchBounds?: Rect;
  normalStats?: SurfaceFieldData["normalStats"];
  warning?: string;
}
```

- [ ] Extract mesh vertices around the tattoo bounds.
- [ ] Build local bounds and local axis from that patch.
- [ ] Generate normal texture only inside tattoo bounds and skin mask.
- [ ] If the local patch has too few vertices, return flat/disabled normal field with `source: "insufficient-mesh"`.

Core comment required in `localMeshSurface.ts`:

```ts
// WHY: 当前 mesh 来自 2D 皮肤 mask，不是真实 3D 人体。
// TRADE-OFF: 这里把 tattoo 附近的局部 mesh 密度/边界距离当作曲面代理，
// 避免 Pose 语义区域把臀部贴图错误套用到上臂轴线上。
```

Acceptance:
- Moving tattoo changes `analysisDebug.patchBounds`.
- Hip/butt tattoo no longer uses upper-arm axis.

---

## 30-42 min: Wire App and Debug Overlay

- [ ] Stop building global body surface during body upload.
- [ ] Store only body `mask`, `mesh`, `placementRect`, and image texture.
- [ ] Recompute local mesh surface after tattoo upload and after tattoo transform changes.
- [ ] Update renderer debug overlay:
  - draw local patch bounds;
  - draw local axis;
  - remove green Pose skeleton/dots entirely.
- [ ] Status text examples:
  - `Surface: local mesh / warp weak`
  - `Surface: local mesh / warp medium`
  - `Surface: local mesh / warp strong`
  - `Surface: insufficient local mesh / warp disabled`

Acceptance:
- No status includes `pose`, `landmarks`, `upperArm`, `forearm`, or `generic`.
- Body Analysis shows only current local mesh surface.

---

## 42-52 min: Compact Tattoo Upload Modal

- [ ] Keep Cropper.js, but shrink the modal preview:

```css
.upload-confirm-preview {
  display: grid;
  place-items: center;
  width: min(82vw, 720px);
  height: min(68vh, 520px);
  overflow: hidden;
}
```

- [ ] Make handles small point handles, not thick bars:

```css
.upload-confirm-preview cropper-handle[data-cropper-handle] {
  width: 10px;
  height: 10px;
  border: 1px solid #14171d;
  border-radius: 2px;
  background: #fff;
}
```

- [ ] Keep export from current crop selection in source pixels.
- [ ] Keep line-art transparent result fallback to original.

Acceptance:
- Tattoo upload modal is compact and centered.
- No internal X/Y scrollbars.
- Handles are small and readable.

---

## 52-60 min: Focused Verification

Run only targeted checks first:

```bash
bun run test tests/domain/localMeshSurface.test.ts tests/render/pixiRenderer.test.ts tests/editor/uploadConfirmModal.test.ts tests/styles.test.ts
```

Then run build if time remains:

```bash
bun run build
```

Manual check:
- Upload side body image.
- Upload tattoo.
- Move tattoo between arm and hip/butt.
- Confirm Body Analysis follows tattoo-local mesh patch.
- Confirm tattoo modal is compact.

Stop rule:
- If full deletion causes unrelated test fallout, fix compile/runtime blockers only. Do not expand scope into a second architecture pass.
