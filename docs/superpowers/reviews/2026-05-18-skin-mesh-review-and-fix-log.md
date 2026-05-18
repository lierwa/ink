# Skin Mesh Review And Fix Log

Date: 2026-05-18
Scope: same demo page flow (`upload modal edit -> Apply -> preview replace`), no new page.

## Review Checklist (One-Pass)

1. 坐标系一致性（图片像素坐标 vs 舞台坐标）
2. 上传并发时序（旧请求完成覆盖新请求）
3. fallback 清理（mesh 失败后残留旧线框）
4. domain 边界纯度（browser API 不应混入 domain pipeline）
5. 行为回归（Apply / default / debug mesh 切换）

## Fix Records

### R1 坐标系一致性
- Issue:
  - skin mesh 由图像像素坐标生成，直接绘制到 Pixi 舞台会偏移/缩放错误。
- Fix:
  - 新增 `mapSkinMeshToSphereStage`，将 skin mesh 映射到球体包围盒坐标后再传给渲染器。
- Files:
  - `src/app.ts`
  - `tests/app.test.ts`

### R2 上传并发时序
- Issue:
  - `applySkinMeshPreview` 异步完成后缺少再次校验，旧请求可能回写状态。
- Fix:
  - 在 mesh 预览调用后与状态写入前增加 `isCurrentRequest(requestId)` 二次门控。
- Files:
  - `src/appUploadWorkflow.ts`
  - `tests/appUploadQueue.test.ts`

### R3 fallback 清理
- Issue:
  - mesh 生成失败时只改状态文案，可能保留旧 skin debug mesh。
- Fix:
  - 失败分支显式调用 `applySkinMeshPreview(null)` 清空 debug mesh，再写 fallback 状态。
- Files:
  - `src/appUploadWorkflow.ts`
  - `tests/appUploadQueue.test.ts`

### R4 domain 边界纯度
- Issue:
  - `createSkinMaskFromCanvasAlpha` 位于 `domain/skinMeshPipeline.ts`，引入 `HTMLCanvasElement/getContext` 浏览器依赖。
- Fix:
  - 拆分到 adapter：`src/image/skinMaskAdapter.ts`
  - `domain/skinMeshPipeline.ts` 保留纯 `SkinMask -> SkinMeshData` 逻辑。
- Files:
  - `src/image/skinMaskAdapter.ts`
  - `src/domain/skinMeshPipeline.ts`
  - `src/app.ts`
  - `tests/image/skinMaskAdapter.test.ts`

### R5 文案与交互一致性
- Issue:
  - modal 操作语义不统一。
- Fix:
  - 按流程统一为 `Apply`，相关测试同步。
- Files:
  - `src/editor/uploadConfirmModal.ts`
  - `tests/editor/uploadConfirmModal.test.ts`

## Verification Records

- `bun run test`
  - Result: pass (`91 passed`)
- `bun run typecheck`
  - Result: pass
- `bun run build`
  - Result: pass

## Residual Note

- 目前 skin mask 来源仍为 alpha 启发式 adapter（稳定、同步、无需额外模型加载）。
- domain 输入契约已固定为 `SkinMask`，后续可替换为 MediaPipe segmentation adapter，而不改 domain 管线。
